/**
 * عروض الأسعار — Quotations
 *
 * Pre-invoice documents with no stock or ledger effect. Lifecycle:
 * DRAFT → SENT → ACCEPTED → CONVERTED (إلى أمر بيع) or REJECTED.
 * Editable only while DRAFT/SENT; deletable unless CONVERTED.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma, QuotationStatus } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { parseDateRange } from '../lib/dateRange';

const router = Router();
router.use(requireAuth);

const round2 = (n: number) => Math.round(n * 100) / 100;

const itemSchema = z.object({
  productId: z.number().int().positive(),
  qty: z.number().positive(),
  unitPrice: z.number().positive(),
});

const quotationSchema = z.object({
  customerId: z.number().int().positive(),
  validUntil: z.string().optional().nullable(),
  discount: z.number().nonnegative().optional().default(0),
  tax: z.number().nonnegative().optional().default(0),
  notes: z.string().optional().nullable(),
  branchId: z.number().int().positive().optional().nullable(), // فرع العمل الحالي (من محدد الفرع في الأعلى)
  items: z.array(itemSchema).min(1),
});

async function generateRefNo(tx: Prisma.TransactionClient, date: Date): Promise<string> {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `QT-${y}${m}${d}-`;
  const last = await tx.quotation.findFirst({
    where: { refNo: { startsWith: prefix } },
    orderBy: { refNo: 'desc' },
    select: { refNo: true },
  });
  const lastSeq = last ? parseInt(last.refNo.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

function computeTotals(items: Array<{ qty: number; unitPrice: number }>, discount: number, tax: number) {
  const subtotal = round2(items.reduce((s, i) => s + i.qty * i.unitPrice, 0));
  const total = round2(subtotal - discount + tax);
  if (total < 0) throw new Error('الخصم يتجاوز إجمالي العرض');
  return { subtotal, total };
}

const quotationInclude = {
  customer: { select: { id: true, nameAr: true } },
  branch: { select: { id: true, nameAr: true } },
  salesOrder: { select: { id: true, orderNo: true } },
  items: { include: { product: { select: { id: true, nameAr: true, sku: true, unit: { select: { nameAr: true } } } } } },
};

// GET /api/quotations
router.get('/', requirePermission('quotations.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { refNo: { contains: search } },
        { customer: { nameAr: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (req.query.status) where.status = req.query.status as QuotationStatus;
    if (req.query.branchId) where.branchId = parseInt(req.query.branchId as string);
    const dateRange = parseDateRange(req.query.from as string | undefined, req.query.to as string | undefined);
    if (dateRange) where.date = dateRange;

    const [data, total] = await Promise.all([
      prisma.quotation.findMany({ where, skip, take: pageSize, orderBy: { id: 'desc' }, include: quotationInclude }),
      prisma.quotation.count({ where }),
    ]);
    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/quotations/:id
router.get('/:id', requirePermission('quotations.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = await prisma.quotation.findUniqueOrThrow({ where: { id: parseInt(req.params.id) }, include: quotationInclude });
    res.json(q);
  } catch (err) {
    next(err);
  }
});

// POST /api/quotations
router.post('/', requirePermission('quotations.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = quotationSchema.parse(req.body);
    const userId = req.user!.userId;

    const created = await prisma.$transaction(async (tx) => {
      const { subtotal, total } = computeTotals(body.items, body.discount ?? 0, body.tax ?? 0);
      const creator = await tx.user.findUnique({ where: { id: userId }, select: { branchId: true } });
      const refNo = await generateRefNo(tx, new Date());
      return tx.quotation.create({
        data: {
          refNo,
          customerId: body.customerId,
          branchId: body.branchId ?? creator?.branchId ?? null,
          validUntil: body.validUntil ? new Date(body.validUntil) : null,
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
        include: quotationInclude,
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

// PUT /api/quotations/:id — editable while DRAFT/SENT
router.put('/:id', requirePermission('quotations.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const body = quotationSchema.parse(req.body);

    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.quotation.findUniqueOrThrow({ where: { id } });
      if (existing.status !== 'DRAFT' && existing.status !== 'SENT') {
        throw new Error('لا يمكن تعديل عرض سعر بعد قبوله أو رفضه أو تحويله');
      }
      const { subtotal, total } = computeTotals(body.items, body.discount ?? 0, body.tax ?? 0);
      await tx.quotationItem.deleteMany({ where: { quotationId: id } });
      return tx.quotation.update({
        where: { id },
        data: {
          customerId: body.customerId,
          validUntil: body.validUntil ? new Date(body.validUntil) : null,
          subtotal,
          discount: body.discount ?? 0,
          tax: body.tax ?? 0,
          total,
          notes: body.notes ?? null,
          items: {
            create: body.items.map((i) => ({
              productId: i.productId,
              qty: i.qty,
              unitPrice: i.unitPrice,
              lineTotal: round2(i.qty * i.unitPrice),
            })),
          },
        },
        include: quotationInclude,
      });
    });
    res.json(updated);
  } catch (err: any) {
    if (typeof err?.message === 'string' && (err.message.includes('لا يمكن تعديل') || err.message.includes('الخصم يتجاوز'))) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// POST /api/quotations/:id/status — SENT / ACCEPTED / REJECTED transitions
const statusSchema = z.object({ status: z.enum(['SENT', 'ACCEPTED', 'REJECTED']) });

router.post('/:id/status', requirePermission('quotations.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const { status } = statusSchema.parse(req.body);

    const existing = await prisma.quotation.findUniqueOrThrow({ where: { id } });
    if (existing.status === 'CONVERTED') {
      res.status(400).json({ error: 'عرض السعر محوّل إلى أمر بيع بالفعل' });
      return;
    }
    const updated = await prisma.quotation.update({ where: { id }, data: { status }, include: quotationInclude });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// POST /api/quotations/:id/convert — إلى أمر بيع
const convertSchema = z.object({
  warehouseId: z.number().int().positive(),
  deliveryDate: z.string().optional().nullable(),
});

router.post('/:id/convert', requirePermission('quotations.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const body = convertSchema.parse(req.body);
    const userId = req.user!.userId;

    const order = await prisma.$transaction(async (tx) => {
      // Claim atomically: only one concurrent convert wins
      const claimed = await tx.quotation.updateMany({
        where: { id, status: { in: ['DRAFT', 'SENT', 'ACCEPTED'] } },
        data: { status: 'CONVERTED' },
      });
      if (claimed.count === 0) {
        throw new Error('عرض السعر محوّل أو مرفوض بالفعل');
      }
      const q = await tx.quotation.findUniqueOrThrow({ where: { id }, include: { items: true } });

      const warehouse = await tx.warehouse.findUniqueOrThrow({
        where: { id: body.warehouseId },
        select: { branchId: true },
      });

      const date = new Date();
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
      const orderNo = `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;

      return tx.salesOrder.create({
        data: {
          orderNo,
          customerId: q.customerId,
          warehouseId: body.warehouseId,
          branchId: warehouse.branchId,
          quotationId: q.id,
          deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : null,
          subtotal: q.subtotal,
          discount: q.discount,
          tax: q.tax,
          total: q.total,
          notes: q.notes,
          createdById: userId,
          items: {
            create: q.items.map((i) => ({
              productId: i.productId,
              qty: i.qty,
              unitPrice: i.unitPrice,
              lineTotal: i.lineTotal,
            })),
          },
        },
      });
    });
    res.status(201).json(order);
  } catch (err: any) {
    if (err?.message?.includes('محوّل أو مرفوض')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// DELETE /api/quotations/:id — unless converted
router.delete('/:id', requirePermission('quotations.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const existing = await prisma.quotation.findUniqueOrThrow({ where: { id } });
    if (existing.status === 'CONVERTED') {
      res.status(400).json({ error: 'لا يمكن حذف عرض سعر محوّل إلى أمر بيع — احذف أمر البيع أولاً' });
      return;
    }
    await prisma.quotation.delete({ where: { id } });
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
