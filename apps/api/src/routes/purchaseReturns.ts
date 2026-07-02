/**
 * مرتجعات المشتريات — Purchase Returns (إشعار مدين)
 *
 * Sends goods back to the supplier: removes them from stock, reverses the
 * inventory/input-VAT ledger effect, and either receives a cash refund or
 * lowers the supplier's balance — the original purchase invoice stays intact.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma, JournalSource } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { parseDateRange } from '../lib/dateRange';
import { postJournalEntry, reverseJournalEntryBySource, ACCT } from '../lib/ledger';

const router = Router();
router.use(requireAuth);

const round2 = (n: number) => Math.round(n * 100) / 100;

const createReturnSchema = z.object({
  purchaseInvoiceId: z.number().int().positive(),
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
  const prefix = `PRT-${y}${m}${d}-`;
  const last = await tx.purchaseReturn.findFirst({
    where: { refNo: { startsWith: prefix } },
    orderBy: { refNo: 'desc' },
    select: { refNo: true },
  });
  const lastSeq = last ? parseInt(last.refNo.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

/** Per-product received quantity and average unit cost, minus already-returned. */
async function getReturnableMap(tx: Prisma.TransactionClient, purchaseInvoiceId: number) {
  const [invoiceItems, returnedItems] = await Promise.all([
    tx.purchaseInvoiceItem.findMany({ where: { invoiceId: purchaseInvoiceId } }),
    tx.purchaseReturnItem.findMany({ where: { return: { purchaseInvoiceId } } }),
  ]);

  const map = new Map<number, { invoicedQty: number; returnedQty: number; unitCost: number }>();
  for (const it of invoiceItems) {
    const prev = map.get(it.productId) ?? { invoicedQty: 0, returnedQty: 0, unitCost: 0 };
    const invoicedQty = prev.invoicedQty + Number(it.qty);
    const totalValue = prev.unitCost * prev.invoicedQty + Number(it.lineTotal);
    map.set(it.productId, { invoicedQty, returnedQty: prev.returnedQty, unitCost: totalValue / invoicedQty });
  }
  for (const r of returnedItems) {
    const entry = map.get(r.productId);
    if (entry) entry.returnedQty += Number(r.qty);
  }
  return map;
}

const returnInclude = {
  supplier: { select: { id: true, nameAr: true } },
  warehouse: { select: { id: true, nameAr: true } },
  purchaseInvoice: { select: { id: true, refNo: true } },
  items: { include: { product: { select: { id: true, nameAr: true, sku: true, unit: { select: { nameAr: true } } } } } },
};

// GET /api/purchase-returns
router.get('/', requirePermission('purchases.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { refNo: { contains: search } },
        { purchaseInvoice: { refNo: { contains: search } } },
        { supplier: { nameAr: { contains: search, mode: 'insensitive' } } },
      ];
    }
    const dateRange = parseDateRange(req.query.from as string | undefined, req.query.to as string | undefined);
    if (dateRange) where.date = dateRange;

    const [data, total] = await Promise.all([
      prisma.purchaseReturn.findMany({ where, skip, take: pageSize, orderBy: { id: 'desc' }, include: returnInclude }),
      prisma.purchaseReturn.count({ where }),
    ]);
    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/purchase-returns/invoice/:invoiceId — what can still be returned
router.get('/invoice/:invoiceId', requirePermission('purchases.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const invoiceId = parseInt(req.params.invoiceId);
    const invoice = await prisma.purchaseInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { supplier: { select: { id: true, nameAr: true } } },
    });
    if (invoice.receiveStatus !== 'RECEIVED') {
      res.status(400).json({ error: 'لا يمكن عمل مرتجع لفاتورة لم تُستلم بضاعتها بعد' });
      return;
    }
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
        unitCost: round2(e.unitCost),
      };
    });
    res.json({
      invoice: {
        id: invoice.id,
        refNo: invoice.refNo,
        supplier: invoice.supplier,
        subtotal: invoice.subtotal,
        discount: invoice.discount,
        tax: invoice.tax,
        total: invoice.total,
      },
      lines,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/purchase-returns/:id
router.get('/:id', requirePermission('purchases.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ret = await prisma.purchaseReturn.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: returnInclude,
    });
    res.json(ret);
  } catch (err) {
    next(err);
  }
});

// POST /api/purchase-returns
router.post('/', requirePermission('purchases.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createReturnSchema.parse(req.body);
    const userId = req.user!.userId;
    const retDate = body.date ? new Date(body.date) : new Date();

    const created = await prisma.$transaction(async (tx) => {
      const invoice = await tx.purchaseInvoice.findUniqueOrThrow({ where: { id: body.purchaseInvoiceId } });
      if (invoice.receiveStatus !== 'RECEIVED') {
        throw new Error('لا يمكن عمل مرتجع لفاتورة لم تُستلم بضاعتها بعد');
      }
      const returnable = await getReturnableMap(tx, body.purchaseInvoiceId);

      let subtotal = 0;
      const lines: Array<{ productId: number; qty: number; unitCost: number; lineTotal: number }> = [];
      for (const item of body.items) {
        const entry = returnable.get(item.productId);
        if (!entry) {
          throw new Error(`المنتج رقم ${item.productId} غير موجود في الفاتورة الأصلية`);
        }
        const remaining = round2(entry.invoicedQty - entry.returnedQty);
        if (item.qty > remaining + 0.0001) {
          throw new Error(`كمية المرتجع للمنتج رقم ${item.productId} (${item.qty}) تتجاوز المتبقي القابل للإرجاع (${remaining})`);
        }
        const lineTotal = round2(item.qty * entry.unitCost);
        subtotal = round2(subtotal + lineTotal);
        lines.push({ productId: item.productId, qty: item.qty, unitCost: round2(entry.unitCost), lineTotal });
      }

      const invSubtotal = Number(invoice.subtotal);
      const ratio = invSubtotal > 0 ? subtotal / invSubtotal : 0;
      const discount = round2(Number(invoice.discount) * ratio);
      const tax = round2(Number(invoice.tax) * ratio);
      const total = round2(subtotal - discount + tax);

      const refNo = await generateReturnNo(tx, retDate);

      const ret = await tx.purchaseReturn.create({
        data: {
          refNo,
          purchaseInvoiceId: invoice.id,
          supplierId: invoice.supplierId,
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

      // Goods leave the warehouse (OUT movements) — refuse if already consumed
      for (const line of lines) {
        const balance = await tx.stockBalance.upsert({
          where: { productId_warehouseId: { productId: line.productId, warehouseId: invoice.warehouseId } },
          update: { quantity: { decrement: line.qty } },
          create: { productId: line.productId, warehouseId: invoice.warehouseId, quantity: -line.qty },
        });
        if (Number(balance.quantity) < 0) {
          throw new Error(`الكمية غير متوفرة بالمخزون للمنتج رقم ${line.productId}`);
        }
        await tx.stockMovement.create({
          data: {
            productId: line.productId,
            warehouseId: invoice.warehouseId,
            type: 'OUT',
            quantity: line.qty,
            balanceAfter: Number(balance.quantity),
            refType: 'PURCHASE_RETURN',
            refId: ret.id,
            reason: `مرتجع شراء ${refNo} — فاتورة ${invoice.refNo}`,
            createdById: userId,
          },
        });
      }

      // ── Ledger ────────────────────────────────────────────────────────────────
      // Dr cash (refund received) or AP (we owe the supplier less)
      // Cr 1200 inventory (net of discount) + Cr 1300 input VAT share
      const debitAccountCode = body.refundMethod === 'CASH' ? ACCT.CASH : ACCT.AP;
      const ledgerLines = [
        { accountCode: debitAccountCode, debit: total, credit: 0, description: `مرتجع مشتريات ${refNo}` },
        { accountCode: ACCT.INVENTORY, debit: 0, credit: round2(subtotal - discount), description: `إخراج مخزون ${refNo}` },
      ];
      if (tax > 0) {
        ledgerLines.push({ accountCode: ACCT.INPUT_VAT, debit: 0, credit: tax, description: `عكس ضريبة مدخلات ${refNo}` });
      }

      await postJournalEntry(tx, {
        date: retDate,
        description: `مرتجع شراء ${refNo} — فاتورة ${invoice.refNo}`,
        sourceType: JournalSource.PURCHASE_RETURN,
        sourceId: ret.id,
        createdById: userId,
        lines: ledgerLines,
      });

      // BALANCE refund lowers what we owe the supplier
      if (body.refundMethod === 'BALANCE') {
        await tx.supplier.update({
          where: { id: invoice.supplierId },
          data: { currentBalance: { decrement: new Prisma.Decimal(total) } },
        });
      }

      return ret;
    });

    const full = await prisma.purchaseReturn.findUniqueOrThrow({ where: { id: created.id }, include: returnInclude });
    res.status(201).json(full);
  } catch (err: any) {
    if (typeof err?.message === 'string' && (
      err.message.includes('تتجاوز المتبقي') ||
      err.message.includes('غير موجود في الفاتورة') ||
      err.message.includes('غير متوفرة بالمخزون') ||
      err.message.includes('لم تُستلم')
    )) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// DELETE /api/purchase-returns/:id — full reversal (stock back in, ledger reversed, balance restored)
router.delete('/:id', requirePermission('purchases.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user!.userId;

    const ret = await prisma.purchaseReturn.findUniqueOrThrow({ where: { id }, include: { items: true } });

    await prisma.$transaction(async (tx) => {
      for (const item of ret.items) {
        const balance = await tx.stockBalance.upsert({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: ret.warehouseId } },
          update: { quantity: { increment: item.qty } },
          create: { productId: item.productId, warehouseId: ret.warehouseId, quantity: item.qty },
        });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            warehouseId: ret.warehouseId,
            type: 'IN',
            quantity: Number(item.qty),
            balanceAfter: Number(balance.quantity),
            refType: 'PURCHASE_RETURN',
            refId: ret.id,
            reason: `حذف مرتجع شراء ${ret.refNo}`,
            createdById: userId,
          },
        });
      }

      await reverseJournalEntryBySource(tx, JournalSource.PURCHASE_RETURN, id);

      if (ret.refundMethod === 'BALANCE') {
        await tx.supplier.update({
          where: { id: ret.supplierId },
          data: { currentBalance: { increment: ret.total } },
        });
      }

      await tx.purchaseReturn.delete({ where: { id } });
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
