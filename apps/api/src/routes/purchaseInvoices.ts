import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { JournalSource } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { postJournalEntry, reverseJournalEntryBySource, ACCT } from '../lib/ledger';
import { parseDateRange } from '../lib/dateRange';

const router = Router();
router.use(requireAuth);

const purchaseItemSchema = z.object({
  productId: z.number().int().positive(),
  qty: z.number().positive(),
  unitCost: z.number().positive(),
});

const createPurchaseSchema = z.object({
  supplierId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  date: z.string().optional(),
  discount: z.number().nonnegative().optional().default(0),
  tax: z.number().nonnegative().optional().default(0),
  paymentStatus: z.enum(['PAID', 'UNPAID', 'PARTIAL']).optional().default('UNPAID'),
  receiveStatus: z.enum(['RECEIVED', 'PENDING']).optional().default('PENDING'),
  notes: z.string().optional().nullable(),
  items: z.array(purchaseItemSchema).min(1),
});

function generatePoNo(): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const seq = String((Date.now() % 1000) * 10 + Math.floor(Math.random() * 10)).padStart(4, '0');
  return `PO-${y}${m}${d}-${seq}`;
}

// GET /api/purchase-invoices
router.get('/', requirePermission('purchases.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const paymentStatus = req.query.paymentStatus as string | undefined;
    const receiveStatus = req.query.receiveStatus as string | undefined;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { refNo: { contains: search } },
        { supplier: { nameAr: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (receiveStatus) where.receiveStatus = receiveStatus;

    const dateRange = parseDateRange(
      req.query.from as string | undefined,
      req.query.to   as string | undefined,
    );
    if (dateRange) where.date = dateRange;

    const [data, total] = await Promise.all([
      prisma.purchaseInvoice.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { date: 'desc' },
        include: {
          supplier: { select: { id: true, nameAr: true, company: true } },
          warehouse: { select: { id: true, nameAr: true } },
          items: { include: { product: { select: { id: true, nameAr: true, sku: true } } } },
        },
      }),
      prisma.purchaseInvoice.count({ where }),
    ]);

    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/purchase-invoices/:id
router.get('/:id', requirePermission('purchases.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const [invoice, paidAgg] = await Promise.all([
      prisma.purchaseInvoice.findUniqueOrThrow({
        where: { id },
        include: {
          supplier: true,
          warehouse: true,
          items: { include: { product: { include: { unit: true } } } },
        },
      }),
      prisma.voucher.aggregate({ where: { purchaseInvoiceId: id }, _sum: { totalAmount: true } }),
    ]);
    const paidAmount = Number(paidAgg._sum.totalAmount ?? 0);
    res.json({ ...invoice, paidAmount, remainingAmount: Number(invoice.total) - paidAmount });
  } catch (err) {
    next(err);
  }
});

// POST /api/purchase-invoices
router.post('/', requirePermission('purchases.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createPurchaseSchema.parse(req.body);
    const userId = req.user!.userId;

    const invoice = await prisma.$transaction(async (tx) => {
      const subtotal = body.items.reduce((s, item) => s + item.qty * item.unitCost, 0);
      const total = subtotal - (body.discount ?? 0) + (body.tax ?? 0);
      const refNo = generatePoNo();

      const inv = await tx.purchaseInvoice.create({
        data: {
          refNo,
          supplierId: body.supplierId,
          warehouseId: body.warehouseId,
          date: body.date ? new Date(body.date) : new Date(),
          subtotal,
          discount: body.discount ?? 0,
          tax: body.tax ?? 0,
          total,
          paymentStatus: body.paymentStatus ?? 'UNPAID',
          receiveStatus: body.receiveStatus ?? 'PENDING',
          notes: body.notes,
          items: {
            create: body.items.map(item => ({
              productId: item.productId,
              qty: item.qty,
              unitCost: item.unitCost,
              lineTotal: item.qty * item.unitCost,
            })),
          },
        },
        include: { items: true },
      });

      // If RECEIVED → increment stock atomically & write IN movements
      if (body.receiveStatus === 'RECEIVED') {
        for (const item of body.items) {
          const balance = await tx.stockBalance.upsert({
            where: { productId_warehouseId: { productId: item.productId, warehouseId: body.warehouseId } },
            update: { quantity: { increment: item.qty } },
            create: { productId: item.productId, warehouseId: body.warehouseId, quantity: item.qty },
          });

          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              warehouseId: body.warehouseId,
              type: 'IN',
              quantity: item.qty,
              balanceAfter: Number(balance.quantity),
              refType: 'PURCHASE',
              refId: inv.id,
              reason: `فاتورة شراء ${refNo}`,
              createdById: userId,
            },
          });
        }
      }

      // Increment supplier balance only if this invoice actually creates a payable
      // (matches the sales-invoice side, which only touches customer balance for
      // CREDIT/unpaid invoices — an invoice paid in full at creation owes nothing).
      if (body.paymentStatus !== 'PAID') {
        await tx.supplier.update({
          where: { id: body.supplierId },
          data: { currentBalance: { increment: total } },
        });
      }

      // ── Ledger posting (only when RECEIVED) ──────────────────────────────────
      if (body.receiveStatus === 'RECEIVED') {
        const creditAccountCode =
          body.paymentStatus === 'PAID' ? ACCT.CASH : ACCT.AP;

        const taxAmount = Number(body.tax ?? 0);
        const inventoryAmount = subtotal;

        const ledgerLines = [
          // Dr: 1200 inventory = subtotal
          { accountCode: ACCT.INVENTORY, debit: inventoryAmount, credit: 0, description: `مخزون ${refNo}` },
          // Cr: cash or AP = total
          { accountCode: creditAccountCode, debit: 0, credit: total, description: `مشتريات ${refNo}` },
        ];

        // Dr: 1300 input VAT = tax (only if tax > 0)
        if (taxAmount > 0) {
          ledgerLines.push({ accountCode: ACCT.INPUT_VAT, debit: taxAmount, credit: 0, description: `ضريبة شراء ${refNo}` });
        }

        await postJournalEntry(tx, {
          date: body.date ? new Date(body.date) : new Date(),
          description: `فاتورة شراء ${refNo}`,
          sourceType: JournalSource.PURCHASE_INVOICE,
          sourceId: inv.id,
          createdById: userId,
          lines: ledgerLines,
        });
      }

      return inv;
    });

    const full = await prisma.purchaseInvoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: {
        supplier: true,
        warehouse: true,
        items: { include: { product: { include: { unit: true } } } },
      },
    });

    res.status(201).json(full);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/purchase-invoices/:id
router.delete('/:id', requirePermission('purchases.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);

    const invoice = await prisma.purchaseInvoice.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });

    // Vouchers linked to this invoice already moved treasury money and the
    // supplier balance; deleting the invoice underneath them would orphan the
    // vouchers (FK is SET NULL) and double-reverse the supplier balance.
    const linkedVouchers = await prisma.voucher.count({ where: { purchaseInvoiceId: id } });
    if (linkedVouchers > 0) {
      res.status(400).json({ error: 'لا يمكن حذف الفاتورة: توجد سندات صرف/خصم مرتبطة بها — احذف السندات أولاً' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Did creation raise the supplier balance? For RECEIVED invoices the
      // creation-time journal entry is the reliable record — it credits AP
      // (2000) exactly when the balance was raised. paymentStatus can't be
      // trusted here: vouchers recompute it later. Non-received invoices have
      // no journal entry, so fall back to the status check.
      const creationEntry = await tx.journalEntry.findFirst({
        where: { sourceType: JournalSource.PURCHASE_INVOICE, sourceId: id },
        include: { lines: { include: { account: { select: { code: true } } } } },
      });
      const raisedBalance = creationEntry
        ? creationEntry.lines.some((l) => l.account.code === ACCT.AP && Number(l.credit) > 0)
        : invoice.paymentStatus !== 'PAID';

      // Reverse ledger entry if one exists
      await reverseJournalEntryBySource(tx, JournalSource.PURCHASE_INVOICE, id);

      // Reverse stock that was incremented on creation (only if it was RECEIVED).
      // If the stock was already consumed elsewhere (sold/transferred), refuse the
      // delete rather than silently corrupting the balance into a fake negative.
      if (invoice.receiveStatus === 'RECEIVED') {
        for (const item of invoice.items) {
          const balance = await tx.stockBalance.upsert({
            where: { productId_warehouseId: { productId: item.productId, warehouseId: invoice.warehouseId } },
            update: { quantity: { decrement: item.qty } },
            create: { productId: item.productId, warehouseId: invoice.warehouseId, quantity: -item.qty },
          });
          if (Number(balance.quantity) < 0) {
            throw new Error(`لا يمكن حذف الفاتورة: كمية المنتج رقم ${item.productId} تم استخدامها بالفعل من المخزون`);
          }
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              warehouseId: invoice.warehouseId,
              type: 'OUT',
              quantity: Number(item.qty),
              balanceAfter: Number(balance.quantity),
              refType: 'PURCHASE',
              refId: invoice.id,
              reason: `حذف فاتورة شراء ${invoice.refNo}`,
              createdById: req.user!.userId,
            },
          });
        }
      }

      // Reverse supplier balance raised on creation (only if it was actually raised)
      if (raisedBalance) {
        await tx.supplier.update({
          where: { id: invoice.supplierId },
          data: { currentBalance: { decrement: invoice.total } },
        });
      }

      // Then delete the invoice
      await tx.purchaseInvoice.delete({ where: { id } });
    });
    res.json({ success: true });
  } catch (err: any) {
    if (err?.code === 'P2003' || err?.code === 'P2014') {
      res.status(400).json({ error: 'لا يمكن الحذف لارتباطه بسجلات أخرى' });
      return;
    }
    if (err?.message?.includes('لا يمكن حذف الفاتورة')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
