/**
 * مرتجعات المبيعات — Sales Returns (إشعار دائن)
 *
 * A return document is the accounting-correct way to undo part (or all) of a
 * posted sale: it restores the stock, reverses revenue/VAT/COGS in the ledger,
 * and refunds the customer either in cash or against their balance — while the
 * original invoice stays untouched as a permanent record.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma, JournalSource, AccountType } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { parseDateRange } from '../lib/dateRange';
import { postJournalEntry, reverseJournalEntryBySource, ACCT } from '../lib/ledger';
import { recomputeSalesInvoiceStatus } from '../lib/settlement';

const router = Router();
router.use(requireAuth);

const round2 = (n: number) => Math.round(n * 100) / 100;

const createReturnSchema = z.object({
  salesInvoiceId: z.number().int().positive(),
  refundMethod: z.enum(['CASH', 'BALANCE']).optional().default('BALANCE'),
  date: z.string().optional(),
  reason: z.string().optional().nullable(),
  items: z.array(z.object({
    productId: z.number().int().positive(),
    qty: z.number().positive(),
  })).min(1),
});

async function generateReturnNo(tx: Prisma.TransactionClient, date: Date): Promise<string> {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `SR-${y}${m}${d}-`;
  const last = await tx.salesReturn.findFirst({
    where: { refNo: { startsWith: prefix } },
    orderBy: { refNo: 'desc' },
    select: { refNo: true },
  });
  const lastSeq = last ? parseInt(last.refNo.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

async function getOrCreateSalesReturnsAccount(tx: Prisma.TransactionClient) {
  const existing = await tx.account.findUnique({ where: { code: ACCT.SALES_RETURNS } });
  if (existing) return existing;
  return tx.account.create({
    data: { code: ACCT.SALES_RETURNS, nameAr: 'مردودات المبيعات', type: AccountType.REVENUE },
  });
}

/**
 * Per-product invoiced quantity and average unit price for an invoice
 * (a product may appear on more than one line), minus what previous returns
 * already took back.
 */
async function getReturnableMap(tx: Prisma.TransactionClient, salesInvoiceId: number) {
  const [invoiceItems, returnedItems] = await Promise.all([
    tx.salesInvoiceItem.findMany({ where: { invoiceId: salesInvoiceId } }),
    tx.salesReturnItem.findMany({ where: { return: { salesInvoiceId } } }),
  ]);

  const map = new Map<number, { invoicedQty: number; returnedQty: number; unitPrice: number }>();
  for (const it of invoiceItems) {
    const prev = map.get(it.productId) ?? { invoicedQty: 0, returnedQty: 0, unitPrice: 0 };
    const invoicedQty = prev.invoicedQty + Number(it.qty);
    // weighted average price across the invoice's lines for this product
    const totalValue = prev.unitPrice * prev.invoicedQty + Number(it.lineTotal);
    map.set(it.productId, { invoicedQty, returnedQty: prev.returnedQty, unitPrice: totalValue / invoicedQty });
  }
  for (const r of returnedItems) {
    const entry = map.get(r.productId);
    if (entry) entry.returnedQty += Number(r.qty);
  }
  return map;
}

const returnInclude = {
  customer: { select: { id: true, nameAr: true } },
  warehouse: { select: { id: true, nameAr: true } },
  salesInvoice: { select: { id: true, refNo: true } },
  items: { include: { product: { select: { id: true, nameAr: true, sku: true, unit: { select: { nameAr: true } } } } } },
};

// GET /api/sales-returns
router.get('/', requirePermission('sales.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { refNo: { contains: search } },
        { salesInvoice: { refNo: { contains: search } } },
        { customer: { nameAr: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const dateRange = parseDateRange(req.query.from as string | undefined, req.query.to as string | undefined);
    if (dateRange) where.date = dateRange;

    const [data, total] = await Promise.all([
      prisma.salesReturn.findMany({ where, skip, take: pageSize, orderBy: { id: 'desc' }, include: returnInclude }),
      prisma.salesReturn.count({ where }),
    ]);
    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/sales-returns/invoice/:invoiceId — what can still be returned (for the create form)
router.get('/invoice/:invoiceId', requirePermission('sales.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoiceId = parseInt(req.params.invoiceId);
    const invoice = await prisma.salesInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { customer: { select: { id: true, nameAr: true } } },
    });
    const map = await prisma.$transaction((tx) => getReturnableMap(tx, invoiceId));
    const productIds = [...map.keys()];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, nameAr: true, sku: true, unit: { select: { nameAr: true } } },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));
    const lines = productIds.map((productId) => {
      const e = map.get(productId)!;
      return {
        productId,
        product: productMap.get(productId) ?? null,
        invoicedQty: e.invoicedQty,
        returnedQty: e.returnedQty,
        returnableQty: round2(e.invoicedQty - e.returnedQty),
        unitPrice: round2(e.unitPrice),
      };
    });
    res.json({
      invoice: {
        id: invoice.id,
        refNo: invoice.refNo,
        customer: invoice.customer,
        subtotal: invoice.subtotal,
        discount: invoice.discount,
        tax: invoice.tax,
        total: invoice.total,
        paymentMethod: invoice.paymentMethod,
      },
      lines,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/sales-returns/:id
router.get('/:id', requirePermission('sales.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ret = await prisma.salesReturn.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: returnInclude,
    });
    res.json(ret);
  } catch (err) {
    next(err);
  }
});

// POST /api/sales-returns
router.post('/', requirePermission('sales.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createReturnSchema.parse(req.body);
    const userId = req.user!.userId;
    const retDate = body.date ? new Date(body.date) : new Date();

    const created = await prisma.$transaction(async (tx) => {
      const invoice = await tx.salesInvoice.findUniqueOrThrow({ where: { id: body.salesInvoiceId } });
      const returnable = await getReturnableMap(tx, body.salesInvoiceId);

      // Validate quantities and price the returned lines from the original invoice
      let subtotal = 0;
      const lines: Array<{ productId: number; qty: number; unitPrice: number; lineTotal: number }> = [];
      for (const item of body.items) {
        const entry = returnable.get(item.productId);
        if (!entry) {
          throw new Error(`المنتج رقم ${item.productId} غير موجود في الفاتورة الأصلية`);
        }
        const remaining = round2(entry.invoicedQty - entry.returnedQty);
        if (item.qty > remaining + 0.0001) {
          throw new Error(`كمية المرتجع للمنتج رقم ${item.productId} (${item.qty}) تتجاوز المتبقي القابل للإرجاع (${remaining})`);
        }
        const lineTotal = round2(item.qty * entry.unitPrice);
        subtotal = round2(subtotal + lineTotal);
        lines.push({ productId: item.productId, qty: item.qty, unitPrice: round2(entry.unitPrice), lineTotal });
      }

      // The return takes its share of the invoice's discount and tax proportionally
      const invSubtotal = Number(invoice.subtotal);
      const ratio = invSubtotal > 0 ? subtotal / invSubtotal : 0;
      const discount = round2(Number(invoice.discount) * ratio);
      const tax = round2(Number(invoice.tax) * ratio);
      const total = round2(subtotal - discount + tax);

      const refNo = await generateReturnNo(tx, retDate);

      const ret = await tx.salesReturn.create({
        data: {
          refNo,
          salesInvoiceId: invoice.id,
          customerId: invoice.customerId,
          warehouseId: invoice.warehouseId,
          date: retDate,
          subtotal: new Prisma.Decimal(subtotal),
          discount: new Prisma.Decimal(discount),
          tax: new Prisma.Decimal(tax),
          total: new Prisma.Decimal(total),
          refundMethod: body.refundMethod,
          reason: body.reason ?? null,
          createdById: userId,
          items: { create: lines },
        },
      });

      // Restock the returned goods (IN movements)
      const productMap = await tx.product.findMany({
        where: { id: { in: lines.map((l) => l.productId) } },
        select: { id: true, costPrice: true },
      }).then((rows) => new Map(rows.map((r) => [r.id, r])));

      for (const line of lines) {
        const balance = await tx.stockBalance.upsert({
          where: { productId_warehouseId: { productId: line.productId, warehouseId: invoice.warehouseId } },
          update: { quantity: { increment: line.qty } },
          create: { productId: line.productId, warehouseId: invoice.warehouseId, quantity: line.qty },
        });
        await tx.stockMovement.create({
          data: {
            productId: line.productId,
            warehouseId: invoice.warehouseId,
            type: 'IN',
            quantity: line.qty,
            balanceAfter: Number(balance.quantity),
            refType: 'SALES_RETURN',
            refId: ret.id,
            reason: `مرتجع بيع ${refNo} — فاتورة ${invoice.refNo}`,
            createdById: userId,
          },
        });
      }

      // ── Ledger ────────────────────────────────────────────────────────────────
      // Dr 4200 sales-returns (net of discount) + Dr 2100 output VAT share
      // Cr cash (refund paid out) or AR (customer owes less)
      await getOrCreateSalesReturnsAccount(tx);
      const creditAccountCode = body.refundMethod === 'CASH' ? ACCT.CASH : ACCT.AR;
      const ledgerLines = [
        { accountCode: ACCT.SALES_RETURNS, debit: round2(subtotal - discount), credit: 0, description: `مرتجع مبيعات ${refNo}` },
      ];
      if (tax > 0) {
        ledgerLines.push({ accountCode: ACCT.OUTPUT_VAT, debit: tax, credit: 0, description: `عكس ضريبة ${refNo}` });
      }
      ledgerLines.push({ accountCode: creditAccountCode, debit: 0, credit: total, description: `ردّ قيمة مرتجع ${refNo}` });

      // Reverse COGS for the restocked goods: Dr inventory / Cr COGS
      const cogs = round2(lines.reduce((s, l) => {
        const prod = productMap.get(l.productId);
        return s + (prod ? Number(prod.costPrice) * l.qty : 0);
      }, 0));
      if (cogs > 0) {
        ledgerLines.push({ accountCode: ACCT.INVENTORY, debit: cogs, credit: 0, description: `إعادة مخزون ${refNo}` });
        ledgerLines.push({ accountCode: ACCT.COGS, debit: 0, credit: cogs, description: `عكس تكلفة بضاعة ${refNo}` });
      }

      await postJournalEntry(tx, {
        date: retDate,
        description: `مرتجع بيع ${refNo} — فاتورة ${invoice.refNo}`,
        sourceType: JournalSource.SALES_RETURN,
        sourceId: ret.id,
        createdById: userId,
        lines: ledgerLines,
      });

      // BALANCE refund lowers what the customer owes
      if (body.refundMethod === 'BALANCE') {
        await tx.customer.update({
          where: { id: invoice.customerId },
          data: { currentBalance: { decrement: new Prisma.Decimal(total) } },
        });
      }

      // A BALANCE return settles part of the invoice — re-derive its paid status
      await recomputeSalesInvoiceStatus(tx, invoice.id);

      return ret;
    });

    const full = await prisma.salesReturn.findUniqueOrThrow({ where: { id: created.id }, include: returnInclude });
    res.status(201).json(full);
  } catch (err: any) {
    if (typeof err?.message === 'string' && (
      err.message.includes('تتجاوز المتبقي') ||
      err.message.includes('غير موجود في الفاتورة')
    )) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// DELETE /api/sales-returns/:id — full reversal (stock back out, ledger reversed, balance restored)
router.delete('/:id', requirePermission('sales.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user!.userId;

    const ret = await prisma.salesReturn.findUniqueOrThrow({ where: { id }, include: { items: true } });

    await prisma.$transaction(async (tx) => {
      // Take the restocked goods back out — refuse if they were already consumed
      for (const item of ret.items) {
        const balance = await tx.stockBalance.upsert({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: ret.warehouseId } },
          update: { quantity: { decrement: item.qty } },
          create: { productId: item.productId, warehouseId: ret.warehouseId, quantity: new Prisma.Decimal(item.qty).negated() },
        });
        if (Number(balance.quantity) < 0) {
          throw new Error(`لا يمكن حذف المرتجع: كمية المنتج رقم ${item.productId} تم استخدامها بالفعل من المخزون`);
        }
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            warehouseId: ret.warehouseId,
            type: 'OUT',
            quantity: Number(item.qty),
            balanceAfter: Number(balance.quantity),
            refType: 'SALES_RETURN',
            refId: ret.id,
            reason: `حذف مرتجع بيع ${ret.refNo}`,
            createdById: userId,
          },
        });
      }

      await reverseJournalEntryBySource(tx, JournalSource.SALES_RETURN, id);

      if (ret.refundMethod === 'BALANCE') {
        await tx.customer.update({
          where: { id: ret.customerId },
          data: { currentBalance: { increment: ret.total } },
        });
      }

      await tx.salesReturn.delete({ where: { id } });
      await recomputeSalesInvoiceStatus(tx, ret.salesInvoiceId);
    });

    res.json({ success: true });
  } catch (err: any) {
    if (typeof err?.message === 'string' && err.message.includes('لا يمكن حذف المرتجع')) {
      res.status(400).json({ error: err.message });
      return;
    }
    if (err?.code === 'P2003' || err?.code === 'P2014') {
      res.status(400).json({ error: 'لا يمكن الحذف لارتباطه بسجلات أخرى' });
      return;
    }
    next(err);
  }
});

export default router;
