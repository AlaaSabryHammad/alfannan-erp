import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { JournalSource } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { postJournalEntry, reverseJournalEntryBySource, ACCT } from '../lib/ledger';
import { parseDateRange } from '../lib/dateRange';
import { validateCoupon, computeCouponDiscount } from './coupons';

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

function generateRefNo(): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  // Combine sub-second time with randomness so concurrent requests in the same
  // second don't collide on the same 4-digit sequence.
  const seq = String((Date.now() % 1000) * 10 + Math.floor(Math.random() * 10)).padStart(4, '0');
  return `INV-${y}${m}${d}-${seq}`;
}

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
    const [invoice, paidAgg] = await Promise.all([
      prisma.salesInvoice.findUniqueOrThrow({
        where: { id },
        include: {
          customer: true,
          cashier: { select: { id: true, name: true } },
          warehouse: true,
          items: { include: { product: { include: { unit: true } } } },
        },
      }),
      prisma.voucher.aggregate({ where: { salesInvoiceId: id }, _sum: { totalAmount: true } }),
    ]);
    const paidAmount = Number(paidAgg._sum.totalAmount ?? 0);
    res.json({ ...invoice, paidAmount, remainingAmount: Number(invoice.total) - paidAmount });
  } catch (err) {
    next(err);
  }
});

// POST /api/sales-invoices
router.post('/', requirePermission('sales.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createInvoiceSchema.parse(req.body);
    const cashierId = req.user!.userId;

    const invoice = await prisma.$transaction(async (tx) => {
      // Calculate totals
      const subtotal = body.items.reduce((s, item) => s + item.qty * item.unitPrice, 0);
      const refNo = generateRefNo();

      const customer = await tx.customer.findUniqueOrThrow({
        where: { id: body.customerId },
        select: { currentBalance: true, creditLimit: true, nameAr: true, loyaltyPoints: true },
      });

      // ── Coupon validation & discount ─────────────────────────────────────────
      let coupon: { id: number; usedCount: number } | null = null;
      let couponDiscount = 0;
      if (body.couponCode) {
        const found = await tx.coupon.findUnique({ where: { code: body.couponCode.trim().toUpperCase() } });
        const invalidReason = validateCoupon(found, subtotal);
        if (invalidReason) throw new Error(invalidReason);
        coupon = found!;
        couponDiscount = computeCouponDiscount(found!, subtotal);
      }

      // ── Loyalty points redemption ────────────────────────────────────────────
      const redeemPoints = body.redeemPoints ?? 0;
      let pointsValue = 0;
      if (redeemPoints > 0) {
        if (redeemPoints > Number(customer.loyaltyPoints)) {
          throw new Error(`نقاط الولاء غير كافية — الرصيد الحالي ${Number(customer.loyaltyPoints)} نقطة`);
        }
        const pointValueSetting = await tx.setting.findUnique({ where: { key: 'loyaltyPointValue' } });
        pointsValue = redeemPoints * parseFloat(pointValueSetting?.value ?? '0.05');
      }

      const finalDiscount = (body.discount ?? 0) + couponDiscount + pointsValue;
      const total = subtotal - finalDiscount + (body.tax ?? 0);
      if (total < 0) {
        throw new Error('قيمة الخصم الإجمالية (يدوي + كوبون + نقاط الولاء) تتجاوز إجمالي الفاتورة');
      }

      // Credit limit enforcement — only when this sale would actually raise the
      // receivable (credit or not fully paid) and the customer has a limit set
      // (creditLimit === 0 means "no limit configured yet", not "zero credit").
      const willRaiseBalance = body.paymentMethod === 'CREDIT' || body.paidStatus !== 'PAID';
      if (willRaiseBalance) {
        const creditLimit = Number(customer.creditLimit);
        if (creditLimit > 0) {
          const projectedBalance = Number(customer.currentBalance) + total;
          if (projectedBalance > creditLimit) {
            throw new Error(
              `تجاوز الحد الائتماني للعميل ${customer.nameAr}: الرصيد الحالي ${Number(customer.currentBalance).toFixed(2)} + هذه الفاتورة ${total.toFixed(2)} = ${projectedBalance.toFixed(2)}، ويتجاوز الحد المسموح ${creditLimit.toFixed(2)}`
            );
          }
        }
      }

      // ── Loyalty points earned on this sale ───────────────────────────────────
      const loyaltyEnabledSetting = await tx.setting.findUnique({ where: { key: 'loyaltyEnabled' } });
      const loyaltyEarnRateSetting = await tx.setting.findUnique({ where: { key: 'loyaltyEarnRate' } });
      const loyaltyEnabled = (loyaltyEnabledSetting?.value ?? 'true') === 'true';
      const pointsEarned = loyaltyEnabled ? Math.floor(total * parseFloat(loyaltyEarnRateSetting?.value ?? '0.1')) : 0;

      // Fetch products for costPrice
      const productIds = body.items.map(i => i.productId);
      const productMap = await tx.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, costPrice: true },
      }).then(rows => new Map(rows.map(r => [r.id, r])));

      // Create invoice
      const inv = await tx.salesInvoice.create({
        data: {
          refNo,
          customerId: body.customerId,
          warehouseId: body.warehouseId,
          cashierId,
          subtotal,
          discount: finalDiscount,
          tax: body.tax ?? 0,
          total,
          paidStatus: body.paidStatus ?? 'PAID',
          paymentMethod: body.paymentMethod ?? 'CASH',
          couponId: coupon?.id ?? null,
          pointsEarned,
          pointsRedeemed: redeemPoints,
          items: {
            create: body.items.map(item => ({
              productId: item.productId,
              qty: item.qty,
              unitPrice: item.unitPrice,
              lineTotal: item.qty * item.unitPrice,
            })),
          },
        },
        include: { items: true },
      });

      if (coupon) {
        await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
      }

      if (redeemPoints > 0) {
        await tx.loyaltyTransaction.create({
          data: { customerId: body.customerId, type: 'REDEEM', points: -redeemPoints, salesInvoiceId: inv.id, description: `استبدال نقاط — فاتورة ${refNo}` },
        });
      }
      if (pointsEarned > 0) {
        await tx.loyaltyTransaction.create({
          data: { customerId: body.customerId, type: 'EARN', points: pointsEarned, salesInvoiceId: inv.id, description: `نقاط مكتسبة — فاتورة ${refNo}` },
        });
      }
      if (pointsEarned !== redeemPoints) {
        await tx.customer.update({
          where: { id: body.customerId },
          data: { loyaltyPoints: { increment: pointsEarned - redeemPoints } },
        });
      }

      // Decrement stock atomically & write OUT movements.
      // Using {decrement} (not read-then-write) makes this safe under concurrent
      // requests for the same product/warehouse — Postgres serializes the row update.
      for (const item of body.items) {
        const balance = await tx.stockBalance.upsert({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: body.warehouseId } },
          update: { quantity: { decrement: item.qty } },
          create: { productId: item.productId, warehouseId: body.warehouseId, quantity: -item.qty },
        });
        const newQty = Number(balance.quantity);

        if (newQty < 0) {
          throw new Error(`الكمية غير متوفرة بالمخزون للمنتج رقم ${item.productId}`);
        }

        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            warehouseId: body.warehouseId,
            type: 'OUT',
            quantity: item.qty,
            balanceAfter: newQty,
            refType: 'INVOICE',
            refId: inv.id,
            reason: `فاتورة بيع ${refNo}`,
            createdById: cashierId,
          },
        });
      }

      // Update customer balance if credit
      if (willRaiseBalance) {
        await tx.customer.update({
          where: { id: body.customerId },
          data: { currentBalance: { increment: total } },
        });
      }

      // ── Ledger posting ───────────────────────────────────────────────────────
      // The debit side must mirror the customer-balance decision above: whenever
      // the sale raises a receivable (credit / not fully paid) the ledger debits
      // AR — otherwise GL and the customer subledger drift apart. Money only hits
      // cash/bank when the invoice is fully paid at creation; partial payments
      // arrive later as receipt vouchers (Dr treasury / Cr AR).
      const debitAccountCode =
        willRaiseBalance                ? ACCT.AR :
        body.paymentMethod === 'CARD'   ? ACCT.BANK :
        ACCT.CASH;

      // COGS = Σ product.costPrice × qty
      const cogs = body.items.reduce((sum, item) => {
        const prod = productMap.get(item.productId);
        return sum + (prod ? Number(prod.costPrice) * item.qty : 0);
      }, 0);

      const revenueAmount = subtotal - finalDiscount;
      const taxAmount = Number(body.tax ?? 0);

      const ledgerLines = [
        // Dr: cash/bank/AR = total
        { accountCode: debitAccountCode, debit: total, credit: 0, description: `مبيعات ${refNo}` },
        // Cr: 4000 revenue = subtotal - discount
        { accountCode: ACCT.REVENUE, debit: 0, credit: revenueAmount, description: `إيرادات ${refNo}` },
      ];

      // Cr: 2100 output VAT = tax (only if tax > 0)
      if (taxAmount > 0) {
        ledgerLines.push({ accountCode: ACCT.OUTPUT_VAT, debit: 0, credit: taxAmount, description: `ضريبة مبيعات ${refNo}` });
      }

      // Dr: 5000 COGS; Cr: 1200 inventory (only if cogs > 0)
      if (cogs > 0) {
        ledgerLines.push({ accountCode: ACCT.COGS,      debit: cogs, credit: 0,    description: `تكلفة بضاعة ${refNo}` });
        ledgerLines.push({ accountCode: ACCT.INVENTORY, debit: 0,    credit: cogs, description: `تخفيض مخزون ${refNo}` });
      }

      await postJournalEntry(tx, {
        date: new Date(),
        description: `فاتورة بيع ${refNo}`,
        sourceType: JournalSource.SALES_INVOICE,
        sourceId: inv.id,
        createdById: cashierId,
        lines: ledgerLines,
      });

      return inv;
    });

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
    if (typeof err?.message === 'string' && (
      err.message.includes('الكمية غير متوفرة بالمخزون') ||
      err.message.includes('تجاوز الحد الائتماني') ||
      err.message.includes('الكوبون') ||
      err.message.includes('نقاط الولاء') ||
      err.message.includes('قيمة الخصم الإجمالية')
    )) {
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
