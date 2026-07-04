import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { JournalSource } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { postJournalEntry, reverseJournalEntryBySource, ACCT } from '../lib/ledger';
import { applyMovingAverageCost, reverseMovingAverageCost } from '../lib/costing';
import { getPurchaseInvoiceSettlement } from '../lib/settlement';
import { createPurchaseInvoiceInTx } from '../lib/purchaseInvoiceService';
import { runWithRetry } from '../lib/retry';
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
    if (req.query.branchId) where.branchId = parseInt(req.query.branchId as string);

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
          branch: { select: { id: true, nameAr: true } },
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
    const [invoice, settlement] = await Promise.all([
      prisma.purchaseInvoice.findUniqueOrThrow({
        where: { id },
        include: {
          supplier: true,
          warehouse: true,
          items: { include: { product: { include: { unit: true } } } },
        },
      }),
      getPurchaseInvoiceSettlement(prisma, id),
    ]);
    res.json({
      ...invoice,
      paidAmount: settlement.paidAmount,
      returnedAmount: settlement.returnedAmount,
      remainingAmount: settlement.remaining,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/purchase-invoices
router.post('/', requirePermission('purchases.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createPurchaseSchema.parse(req.body);
    const userId = req.user!.userId;

    const invoice = await runWithRetry(() =>
      prisma.$transaction(async (tx) => createPurchaseInvoiceInTx(tx, { ...body, userId })),
    );

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

// POST /api/purchase-invoices/:id/receive — استلام بضاعة فاتورة معلّقة
// A PENDING invoice has no stock and no journal yet; receiving it later
// performs everything the create-as-RECEIVED path does, dated today.
router.post('/:id/receive', requirePermission('purchases.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user!.userId;
    const receiveDate = new Date();

    const invoice = await prisma.purchaseInvoice.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });

    await prisma.$transaction(async (tx) => {
      // Claim atomically: only one concurrent receive can win
      const claimed = await tx.purchaseInvoice.updateMany({
        where: { id, receiveStatus: 'PENDING' },
        data: { receiveStatus: 'RECEIVED' },
      });
      if (claimed.count === 0) {
        throw new Error('هذه الفاتورة مستلمة بالفعل');
      }

      const subtotal = Number(invoice.subtotal);
      const discount = Number(invoice.discount);
      const netFactor = subtotal > 0 ? (subtotal - discount) / subtotal : 1;

      for (const item of invoice.items) {
        const qty = Number(item.qty);
        // Re-average BEFORE incrementing the stock (reads on-hand qty)
        await applyMovingAverageCost(tx, item.productId, qty, Number(item.unitCost) * netFactor);

        const balance = await tx.stockBalance.upsert({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: invoice.warehouseId } },
          update: { quantity: { increment: qty } },
          create: { productId: item.productId, warehouseId: invoice.warehouseId, quantity: qty },
        });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            warehouseId: invoice.warehouseId,
            type: 'IN',
            quantity: qty,
            balanceAfter: Number(balance.quantity),
            refType: 'PURCHASE',
            refId: invoice.id,
            reason: `استلام بضاعة فاتورة شراء ${invoice.refNo}`,
            createdById: userId,
          },
        });
      }

      // Credit CASH only when the invoice was fully paid at creation and no
      // vouchers are involved (money left the treasury directly back then).
      // Any voucher-based payment flows through AP, so crediting AP here nets
      // out correctly against those voucher debits.
      const voucherCount = await tx.voucher.count({ where: { purchaseInvoiceId: id } });
      const creditAccountCode =
        invoice.paymentStatus === 'PAID' && voucherCount === 0 ? ACCT.CASH : ACCT.AP;

      const taxAmount = Number(invoice.tax);
      const ledgerLines = [
        { accountCode: ACCT.INVENTORY, debit: subtotal - discount, credit: 0, description: `مخزون ${invoice.refNo}` },
        { accountCode: creditAccountCode, debit: 0, credit: Number(invoice.total), description: `مشتريات ${invoice.refNo}` },
      ];
      if (taxAmount > 0) {
        ledgerLines.push({ accountCode: ACCT.INPUT_VAT, debit: taxAmount, credit: 0, description: `ضريبة شراء ${invoice.refNo}` });
      }

      await postJournalEntry(tx, {
        date: receiveDate,
        description: `استلام فاتورة شراء ${invoice.refNo}`,
        sourceType: JournalSource.PURCHASE_INVOICE,
        sourceId: invoice.id,
        createdById: userId,
        lines: ledgerLines,
      });
    });

    const full = await prisma.purchaseInvoice.findUniqueOrThrow({
      where: { id },
      include: {
        supplier: true,
        warehouse: true,
        items: { include: { product: { include: { unit: true } } } },
      },
    });
    res.json(full);
  } catch (err: any) {
    if (typeof err?.message === 'string' && err.message.includes('مستلمة بالفعل')) {
      res.status(400).json({ error: err.message });
      return;
    }
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
    const [linkedVouchers, linkedReturns] = await Promise.all([
      prisma.voucher.count({ where: { purchaseInvoiceId: id } }),
      prisma.purchaseReturn.count({ where: { purchaseInvoiceId: id } }),
    ]);
    if (linkedVouchers > 0) {
      res.status(400).json({ error: 'لا يمكن حذف الفاتورة: توجد سندات صرف/خصم مرتبطة بها — احذف السندات أولاً' });
      return;
    }
    if (linkedReturns > 0) {
      res.status(400).json({ error: 'لا يمكن حذف الفاتورة: توجد مرتجعات مرتبطة بها — احذف المرتجعات أولاً' });
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
        // net unit cost that was averaged in on receipt (after the invoice discount)
        const sub = Number(invoice.subtotal);
        const netFactor = sub > 0 ? (sub - Number(invoice.discount)) / sub : 1;
        for (const item of invoice.items) {
          // Undo this receipt's effect on the moving average BEFORE removing stock
          await reverseMovingAverageCost(tx, item.productId, Number(item.qty), Number(item.unitCost) * netFactor);

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
