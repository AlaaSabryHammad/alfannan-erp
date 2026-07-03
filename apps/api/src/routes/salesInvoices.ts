import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { JournalSource } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { reverseJournalEntryBySource, ACCT } from '../lib/ledger';
import { getSalesInvoiceSettlement } from '../lib/settlement';
import { createSalesInvoiceInTx, SALES_INVOICE_USER_ERRORS } from '../lib/salesInvoiceService';
import { parseDateRange } from '../lib/dateRange';

const router = Router();
router.use(requireAuth);

const invoiceItemSchema = z.object({
  productId: z.number().int().positive(),
  qty: z.number().positive(),
  unitPrice: z.number().positive(),
});

const createInvoiceSchema = z.object({
  customerId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  discount: z.number().nonnegative().optional().default(0),
  tax: z.number().nonnegative().optional().default(0),
  paidStatus: z.enum(['PAID', 'UNPAID', 'PARTIAL']).optional().default('PAID'),
  paymentMethod: z.enum(['CASH', 'CARD', 'CREDIT']).optional().default('CASH'),
  couponCode: z.string().optional().nullable(),
  redeemPoints: z.number().nonnegative().optional().default(0),
  items: z.array(invoiceItemSchema).min(1),
});

// GET /api/sales-invoices
router.get('/', requirePermission('sales.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const paidStatus = req.query.paidStatus as string | undefined;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { refNo: { contains: search } },
        { customer: { nameAr: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (paidStatus) where.paidStatus = paidStatus;
    if (req.query.branchId) where.branchId = parseInt(req.query.branchId as string);

    const dateRange = parseDateRange(
      req.query.from as string | undefined,
      req.query.to   as string | undefined,
    );
    if (dateRange) where.date = dateRange;

    const [data, total] = await Promise.all([
      prisma.salesInvoice.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { date: 'desc' },
        include: {
          customer: { select: { id: true, nameAr: true, company: true } },
          cashier: { select: { id: true, name: true } },
          warehouse: { select: { id: true, nameAr: true } },
          branch: { select: { id: true, nameAr: true } },
          items: { include: { product: { select: { id: true, nameAr: true, sku: true } } } },
        },
      }),
      prisma.salesInvoice.count({ where }),
    ]);

    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/sales-invoices/:id
router.get('/:id', requirePermission('sales.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const [invoice, settlement] = await Promise.all([
      prisma.salesInvoice.findUniqueOrThrow({
        where: { id },
        include: {
          customer: true,
          cashier: { select: { id: true, name: true } },
          warehouse: true,
          items: { include: { product: { include: { unit: true } } } },
        },
      }),
      getSalesInvoiceSettlement(prisma, id),
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

// POST /api/sales-invoices
router.post('/', requirePermission('sales.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createInvoiceSchema.parse(req.body);
    const cashierId = req.user!.userId;

    const invoice = await prisma.$transaction(async (tx) =>
      createSalesInvoiceInTx(tx, { ...body, cashierId }),
    );

    const full = await prisma.salesInvoice.findUniqueOrThrow({
      where: { id: invoice.id },
      include: {
        customer: true,
        cashier: { select: { id: true, name: true } },
        warehouse: true,
        items: { include: { product: { include: { unit: true } } } },
      },
    });

    res.status(201).json(full);
  } catch (err: any) {
    if (typeof err?.message === 'string' && SALES_INVOICE_USER_ERRORS.some((m) => err.message.includes(m))) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// DELETE /api/sales-invoices/:id — hard delete (items cascade via schema onDelete: Cascade)
router.delete('/:id', requirePermission('sales.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);

    const invoice = await prisma.salesInvoice.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });

    // Vouchers linked to this invoice already moved treasury money and the
    // customer balance; deleting the invoice underneath them would orphan the
    // vouchers (FK is SET NULL) and double-reverse the customer balance.
    const [linkedVouchers, linkedReturns] = await Promise.all([
      prisma.voucher.count({ where: { salesInvoiceId: id } }),
      prisma.salesReturn.count({ where: { salesInvoiceId: id } }),
    ]);
    if (linkedVouchers > 0) {
      res.status(400).json({ error: 'لا يمكن حذف الفاتورة: توجد سندات قبض/خصم مرتبطة بها — احذف السندات أولاً' });
      return;
    }
    if (linkedReturns > 0) {
      res.status(400).json({ error: 'لا يمكن حذف الفاتورة: توجد مرتجعات مرتبطة بها — احذف المرتجعات أولاً' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Did creation raise the customer balance? The creation-time journal entry
      // is the reliable record — it debits AR (3000) exactly when the balance was
      // raised. paidStatus can't be trusted here: vouchers recompute it later.
      // Must be read BEFORE reverseJournalEntryBySource deletes the entry.
      const creationEntry = await tx.journalEntry.findFirst({
        where: { sourceType: JournalSource.SALES_INVOICE, sourceId: id },
        include: { lines: { include: { account: { select: { code: true } } } } },
      });
      const raisedBalance = creationEntry
        ? creationEntry.lines.some((l) => l.account.code === ACCT.AR && Number(l.debit) > 0)
        : invoice.paymentMethod === 'CREDIT' || invoice.paidStatus !== 'PAID';

      // Reverse ledger entry first
      await reverseJournalEntryBySource(tx, JournalSource.SALES_INVOICE, id);

      // Reverse stock that was decremented on creation & write IN movements back.
      for (const item of invoice.items) {
        const balance = await tx.stockBalance.upsert({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: invoice.warehouseId } },
          update: { quantity: { increment: item.qty } },
          create: { productId: item.productId, warehouseId: invoice.warehouseId, quantity: item.qty },
        });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            warehouseId: invoice.warehouseId,
            type: 'IN',
            quantity: Number(item.qty),
            balanceAfter: Number(balance.quantity),
            refType: 'INVOICE',
            refId: invoice.id,
            reason: `حذف فاتورة بيع ${invoice.refNo}`,
            createdById: req.user!.userId,
          },
        });
      }

      // Reverse customer balance if it was raised as credit on creation
      if (raisedBalance) {
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: { currentBalance: { decrement: invoice.total } },
        });
      }

      // Reverse loyalty points earned/redeemed by this invoice, and the coupon usage
      const pointsEarned = Number(invoice.pointsEarned);
      const pointsRedeemed = Number(invoice.pointsRedeemed);
      if (pointsEarned !== 0 || pointsRedeemed !== 0) {
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: { loyaltyPoints: { increment: pointsRedeemed - pointsEarned } },
        });
      }
      if (invoice.couponId) {
        await tx.coupon.update({ where: { id: invoice.couponId }, data: { usedCount: { decrement: 1 } } });
      }
      await tx.loyaltyTransaction.deleteMany({ where: { salesInvoiceId: id } });

      // Then delete the invoice
      await tx.salesInvoice.delete({ where: { id } });
    });
    res.json({ success: true });
  } catch (err: any) {
    if (err?.code === 'P2003' || err?.code === 'P2014') {
      res.status(400).json({ error: 'لا يمكن الحذف لارتباطه بسجلات أخرى' });
      return;
    }
    next(err);
  }
});

export default router;
