/**
 * أوامر البيع — Sales Orders
 *
 * PENDING orders reserve nothing (no stock/ledger effect). Fulfilling one
 * creates the real sales invoice atomically through the shared service —
 * stock, ledger, balances, loyalty all happen there — and links it back.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma, SalesOrderStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { parseDateRange } from '../lib/dateRange';
import { createSalesInvoiceInTx, SALES_INVOICE_USER_ERRORS } from '../lib/salesInvoiceService';
import { getReservedQty } from '../lib/reservation';

const router = Router();
router.use(requireAuth);

const round2 = (n: number) => Math.round(n * 100) / 100;

const itemSchema = z.object({
  productId: z.number().int().positive(),
  qty: z.number().positive(),
  unitPrice: z.number().positive(),
});

const orderSchema = z.object({
  customerId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  deliveryDate: z.string().optional().nullable(),
  discount: z.number().nonnegative().optional().default(0),
  tax: z.number().nonnegative().optional().default(0),
  notes: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1),
});

async function generateOrderNo(tx: Prisma.TransactionClient, date: Date): Promise<string> {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `SO-${y}${m}${d}-`;
  const last = await tx.salesOrder.findFirst({
    where: { orderNo: { startsWith: prefix } },
    orderBy: { orderNo: 'desc' },
    select: { orderNo: true },
  });
  const lastSeq = last ? parseInt(last.orderNo.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

const orderInclude = {
  customer: { select: { id: true, nameAr: true } },
  warehouse: { select: { id: true, nameAr: true } },
  branch: { select: { id: true, nameAr: true } },
  quotation: { select: { id: true, refNo: true } },
  invoice: { select: { id: true, refNo: true } },
  items: { include: { product: { select: { id: true, nameAr: true, sku: true, unit: { select: { nameAr: true } } } } } },
};

// GET /api/sales-orders
router.get('/', requirePermission('salesorders.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { orderNo: { contains: search } },
        { customer: { nameAr: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (req.query.status) where.status = req.query.status as SalesOrderStatus;
    if (req.query.branchId) where.branchId = parseInt(req.query.branchId as string);
    const dateRange = parseDateRange(req.query.from as string | undefined, req.query.to as string | undefined);
    if (dateRange) where.date = dateRange;

    const [data, total] = await Promise.all([
      prisma.salesOrder.findMany({ where, skip, take: pageSize, orderBy: { id: 'desc' }, include: orderInclude }),
      prisma.salesOrder.count({ where }),
    ]);
    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/sales-orders/:id
router.get('/:id', requirePermission('salesorders.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: parseInt(req.params.id) }, include: orderInclude });
    res.json(order);
  } catch (err) {
    next(err);
  }
});

// POST /api/sales-orders — manual order (without a quotation)
router.post('/', requirePermission('salesorders.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = orderSchema.parse(req.body);
    const userId = req.user!.userId;

    const created = await prisma.$transaction(async (tx) => {
      const subtotal = round2(body.items.reduce((s, i) => s + i.qty * i.unitPrice, 0));
      const total = round2(subtotal - (body.discount ?? 0) + (body.tax ?? 0));
      if (total < 0) throw new Error('الخصم يتجاوز إجمالي الأمر');
      const warehouse = await tx.warehouse.findUniqueOrThrow({
        where: { id: body.warehouseId },
        select: { branchId: true },
      });

      // The order reserves its quantities — it can only reserve what is
      // actually available: on-hand minus what other PENDING orders hold.
      for (const item of body.items) {
        const bal = await tx.stockBalance.findUnique({
          where: { productId_warehouseId: { productId: item.productId, warehouseId: body.warehouseId } },
        });
        const onHand = Number(bal?.quantity ?? 0);
        const reserved = await getReservedQty(tx, item.productId, body.warehouseId);
        if (item.qty > onHand - reserved + 0.0001) {
          throw new Error(
            `الكمية غير كافية للحجز — المنتج رقم ${item.productId}: المتاح ${Math.max(0, onHand - reserved)} (رصيد ${onHand} − محجوز ${reserved})`
          );
        }
      }

      const orderNo = await generateOrderNo(tx, new Date());
      return tx.salesOrder.create({
        data: {
          orderNo,
          customerId: body.customerId,
          warehouseId: body.warehouseId,
          branchId: warehouse.branchId,
          deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : null,
          subtotal,
          discount: body.discount ?? 0,
          tax: body.tax ?? 0,
          total,
          notes: body.notes ?? null,
          createdById: userId,
          items: {
            create: body.items.map((i) => ({
              productId: i.productId,
              qty: i.qty,
              unitPrice: i.unitPrice,
              lineTotal: round2(i.qty * i.unitPrice),
            })),
          },
        },
        include: orderInclude,
      });
    });
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.message?.includes('الخصم يتجاوز') || err?.message?.includes('غير كافية للحجز')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// POST /api/sales-orders/:id/fulfill — creates the sales invoice atomically
const fulfillSchema = z.object({
  paymentMethod: z.enum(['CASH', 'CARD', 'CREDIT']).optional().default('CASH'),
  paidStatus: z.enum(['PAID', 'UNPAID', 'PARTIAL']).optional().default('PAID'),
});

router.post('/:id/fulfill', requirePermission('salesorders.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const body = fulfillSchema.parse(req.body ?? {});
    const userId = req.user!.userId;

    const invoice = await prisma.$transaction(async (tx) => {
      // Claim atomically: only one concurrent fulfill can win
      const claimed = await tx.salesOrder.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'FULFILLED' },
      });
      if (claimed.count === 0) {
        throw new Error('أمر البيع مُنفَّذ أو ملغى بالفعل');
      }
      const order = await tx.salesOrder.findUniqueOrThrow({ where: { id }, include: { items: true } });

      const inv = await createSalesInvoiceInTx(tx, {
        customerId: order.customerId,
        warehouseId: order.warehouseId,
        discount: Number(order.discount),
        tax: Number(order.tax),
        paymentMethod: body.paymentMethod,
        paidStatus: body.paidStatus,
        items: order.items.map((i) => ({
          productId: i.productId,
          qty: Number(i.qty),
          unitPrice: Number(i.unitPrice),
        })),
        cashierId: userId,
        fulfillingSalesOrderId: order.id,
      });

      await tx.salesOrder.update({ where: { id }, data: { invoiceId: inv.id } });
      return inv;
    });

    const full = await prisma.salesOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
    res.json({ order: full, invoiceId: invoice.id, invoiceRefNo: invoice.refNo });
  } catch (err: any) {
    if (typeof err?.message === 'string' && (
      err.message.includes('مُنفَّذ أو ملغى') ||
      SALES_INVOICE_USER_ERRORS.some((m) => err.message.includes(m))
    )) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// POST /api/sales-orders/:id/cancel
router.post('/:id/cancel', requirePermission('salesorders.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const claimed = await prisma.salesOrder.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    if (claimed.count === 0) {
      res.status(400).json({ error: 'لا يمكن إلغاء أمر مُنفَّذ أو ملغى بالفعل' });
      return;
    }
    const full = await prisma.salesOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
    res.json(full);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/sales-orders/:id — only non-fulfilled; frees the quotation back to ACCEPTED
router.delete('/:id', requirePermission('salesorders.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.$transaction(async (tx) => {
      const order = await tx.salesOrder.findUniqueOrThrow({ where: { id } });
      if (order.status === 'FULFILLED') {
        throw new Error('لا يمكن حذف أمر بيع مُنفَّذ — الفاتورة الناتجة سجل دائم');
      }
      await tx.salesOrder.delete({ where: { id } });
      if (order.quotationId) {
        await tx.quotation.update({ where: { id: order.quotationId }, data: { status: 'ACCEPTED' } });
      }
    });
    res.json({ success: true });
  } catch (err: any) {
    if (err?.message?.includes('لا يمكن حذف')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
