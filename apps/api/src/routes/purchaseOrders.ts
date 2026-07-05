/**
 * أوامر الشراء — Purchase Orders
 *
 * PENDING orders have no stock/ledger effect. Converting one creates the real
 * purchase invoice atomically through the shared service and links it back.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { parseDateRange } from '../lib/dateRange';
import { createPurchaseInvoiceInTx } from '../lib/purchaseInvoiceService';

const router = Router();
router.use(requireAuth);

const round2 = (n: number) => Math.round(n * 100) / 100;

const itemSchema = z.object({
  productId: z.number().int().positive(),
  qty: z.number().positive(),
  unitCost: z.number().positive(),
});

const orderSchema = z.object({
  supplierId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  expectedDate: z.string().optional().nullable(),
  discount: z.number().nonnegative().optional().default(0),
  tax: z.number().nonnegative().optional().default(0),
  notes: z.string().optional().nullable(),
  items: z.array(itemSchema).min(1),
});

async function generateOrderNo(tx: Prisma.TransactionClient, date: Date): Promise<string> {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `POR-${y}${m}${d}-`;
  const last = await tx.purchaseOrder.findFirst({
    where: { orderNo: { startsWith: prefix } },
    orderBy: { orderNo: 'desc' },
    select: { orderNo: true },
  });
  const lastSeq = last ? parseInt(last.orderNo.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

const orderInclude = {
  supplier: { select: { id: true, nameAr: true } },
  warehouse: { select: { id: true, nameAr: true } },
  branch: { select: { id: true, nameAr: true } },
  invoice: { select: { id: true, refNo: true } },
  items: { include: { product: { select: { id: true, nameAr: true, sku: true, unit: { select: { nameAr: true } } } } } },
};

// GET /api/purchase-orders
router.get('/', requirePermission('purchaseorders.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { orderNo: { contains: search } },
        { supplier: { nameAr: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (req.query.status) where.status = req.query.status as PurchaseOrderStatus;
    if (req.query.branchId) where.branchId = parseInt(req.query.branchId as string);
    const dateRange = parseDateRange(req.query.from as string | undefined, req.query.to as string | undefined);
    if (dateRange) where.date = dateRange;

    const [data, total] = await Promise.all([
      prisma.purchaseOrder.findMany({ where, skip, take: pageSize, orderBy: { id: 'desc' }, include: orderInclude }),
      prisma.purchaseOrder.count({ where }),
    ]);
    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/purchase-orders/:id
router.get('/:id', requirePermission('purchaseorders.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const order = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: parseInt(req.params.id) }, include: orderInclude });
    res.json(order);
  } catch (err) {
    next(err);
  }
});

// POST /api/purchase-orders
router.post('/', requirePermission('purchaseorders.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = orderSchema.parse(req.body);
    const userId = req.user!.userId;

    const created = await prisma.$transaction(async (tx) => {
      const subtotal = round2(body.items.reduce((s, i) => s + i.qty * i.unitCost, 0));
      const total = round2(subtotal - (body.discount ?? 0) + (body.tax ?? 0));
      if (total < 0) throw new Error('الخصم يتجاوز إجمالي الأمر');
      const warehouse = await tx.warehouse.findUniqueOrThrow({
        where: { id: body.warehouseId },
        select: { branchId: true },
      });
      const orderNo = await generateOrderNo(tx, new Date());
      return tx.purchaseOrder.create({
        data: {
          orderNo,
          supplierId: body.supplierId,
          warehouseId: body.warehouseId,
          branchId: warehouse.branchId,
          expectedDate: body.expectedDate ? new Date(body.expectedDate) : null,
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
              unitCost: i.unitCost,
              lineTotal: round2(i.qty * i.unitCost),
            })),
          },
        },
        include: orderInclude,
      });
    });
    res.status(201).json(created);
  } catch (err: any) {
    if (err?.message?.includes('الخصم يتجاوز')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// POST /api/purchase-orders/:id/convert — creates the purchase invoice atomically
const convertSchema = z.object({
  receiveStatus: z.enum(['RECEIVED', 'PENDING']).optional().default('PENDING'),
  paymentStatus: z.enum(['PAID', 'UNPAID', 'PARTIAL']).optional().default('UNPAID'),
});

router.post('/:id/convert', requirePermission('purchaseorders.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const body = convertSchema.parse(req.body ?? {});
    const userId = req.user!.userId;

    const invoice = await prisma.$transaction(async (tx) => {
      // Claim atomically: only one concurrent convert can win
      const claimed = await tx.purchaseOrder.updateMany({
        where: { id, status: 'PENDING' },
        data: { status: 'CONVERTED' },
      });
      if (claimed.count === 0) {
        throw new Error('أمر الشراء محوّل أو ملغى بالفعل');
      }
      const order = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: { items: true } });

      const inv = await createPurchaseInvoiceInTx(tx, {
        supplierId: order.supplierId,
        warehouseId: order.warehouseId,
        discount: Number(order.discount),
        tax: Number(order.tax),
        paymentStatus: body.paymentStatus,
        receiveStatus: body.receiveStatus,
        notes: order.notes,
        items: order.items.map((i) => ({
          productId: i.productId,
          qty: Number(i.qty),
          unitCost: Number(i.unitCost),
        })),
        userId,
      });

      await tx.purchaseOrder.update({ where: { id }, data: { invoiceId: inv.id } });
      return inv;
    });

    const full = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
    res.json({ order: full, invoiceId: invoice.id, invoiceRefNo: invoice.refNo });
  } catch (err: any) {
    if (err?.message?.includes('محوّل أو ملغى')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// POST /api/purchase-orders/:id/cancel
router.post('/:id/cancel', requirePermission('purchaseorders.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const claimed = await prisma.purchaseOrder.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'CANCELLED' },
    });
    if (claimed.count === 0) {
      res.status(400).json({ error: 'لا يمكن إلغاء أمر محوّل أو ملغى بالفعل' });
      return;
    }
    const full = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: orderInclude });
    res.json(full);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/purchase-orders/:id — only non-converted
router.delete('/:id', requirePermission('purchaseorders.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const order = await prisma.purchaseOrder.findUniqueOrThrow({ where: { id } });
    if (order.status === 'CONVERTED') {
      res.status(400).json({ error: 'لا يمكن حذف أمر شراء محوّل — الفاتورة الناتجة سجل دائم' });
      return;
    }
    await prisma.purchaseOrder.delete({ where: { id } });
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
