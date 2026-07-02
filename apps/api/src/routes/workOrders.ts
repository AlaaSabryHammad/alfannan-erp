/**
 * أوامر التصنيع — Work Orders
 *
 * A work order converts raw materials into a finished product according to its
 * Bill of Materials. Creating one just snapshots the recipe (DRAFT); posting it
 * atomically consumes the components' stock and produces the finished good's
 * stock, mirroring the stock-count post pattern (upsert + negative-balance guard
 * inside one transaction).
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';

const router = Router();
router.use(requireAuth);

const createWorkOrderSchema = z.object({
  bomId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  qty: z.number().positive(),
  date: z.string().optional(),
  notes: z.string().optional().nullable(),
});

async function generateOrderNo(): Promise<string> {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `WO-${y}${m}${d}-`;
  // max + 1 (not count + 1): draft orders are deletable, and a count-based
  // sequence would re-issue a number that still exists → unique-constraint failure.
  const last = await prisma.workOrder.findFirst({
    where: { orderNo: { startsWith: prefix } },
    orderBy: { orderNo: 'desc' },
    select: { orderNo: true },
  });
  const lastSeq = last ? parseInt(last.orderNo.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

const productSelect = { id: true, nameAr: true, sku: true, unit: { select: { nameAr: true } } };
const workOrderInclude = {
  product: { select: productSelect },
  warehouse: { select: { id: true, nameAr: true } },
  bom: { select: { id: true, notes: true } },
  lines: { include: { component: { select: productSelect } } },
};

// GET /api/work-orders
router.get('/', requirePermission('manufacturing.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const status = req.query.status as string | undefined;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      prisma.workOrder.findMany({ where, skip, take: pageSize, orderBy: { id: 'desc' }, include: workOrderInclude }),
      prisma.workOrder.count({ where }),
    ]);

    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/work-orders/:id
router.get('/:id', requirePermission('manufacturing.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workOrder = await prisma.workOrder.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: workOrderInclude,
    });
    res.json(workOrder);
  } catch (err) {
    next(err);
  }
});

// POST /api/work-orders — create as DRAFT, snapshotting the BOM's lines × qty
router.post('/', requirePermission('manufacturing.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createWorkOrderSchema.parse(req.body);
    const bom = await prisma.billOfMaterial.findUniqueOrThrow({ where: { id: body.bomId }, include: { lines: true } });

    if (bom.lines.length === 0) {
      res.status(400).json({ error: 'قائمة المكونات هذه لا تحتوي على أي مكوّنات' });
      return;
    }

    const orderNo = await generateOrderNo();
    const userId = req.user!.userId;

    const workOrder = await prisma.workOrder.create({
      data: {
        orderNo,
        bomId: bom.id,
        productId: bom.productId,
        warehouseId: body.warehouseId,
        qty: body.qty,
        date: body.date ? new Date(body.date) : new Date(),
        notes: body.notes ?? null,
        createdById: userId,
        lines: {
          create: bom.lines.map((l) => ({
            componentId: l.componentId,
            qtyPerUnit: l.qtyPerUnit,
            qtyRequired: Number(l.qtyPerUnit) * body.qty,
          })),
        },
      },
      include: workOrderInclude,
    });
    res.status(201).json(workOrder);
  } catch (err: any) {
    if (typeof err?.message === 'string' && err.message.includes('لا تحتوي')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// POST /api/work-orders/:id/post — consume components, produce the finished good
router.post('/:id/post', requirePermission('manufacturing.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user!.userId;

    const workOrder = await prisma.workOrder.findUniqueOrThrow({ where: { id }, include: { lines: true } });

    if (workOrder.status !== 'DRAFT') {
      res.status(400).json({ error: 'هذا أمر التصنيع مُرحَّل أو مُلغى مسبقاً' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Claim the order atomically first: the DRAFT check above ran outside the
      // transaction, so two concurrent posts could both pass it and consume the
      // components twice. updateMany with the status filter lets only one win.
      const claimed = await tx.workOrder.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'POSTED', postedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new Error('هذا أمر التصنيع مُرحَّل أو مُلغى مسبقاً');
      }

      for (const line of workOrder.lines) {
        const bal = await tx.stockBalance.upsert({
          where: { productId_warehouseId: { productId: line.componentId, warehouseId: workOrder.warehouseId } },
          update: { quantity: { decrement: line.qtyRequired } },
          create: { productId: line.componentId, warehouseId: workOrder.warehouseId, quantity: new Prisma.Decimal(line.qtyRequired).negated() },
        });
        if (Number(bal.quantity) < 0) {
          throw new Error(`الكمية غير متوفرة بالمخزون للمكوّن رقم ${line.componentId}`);
        }
        await tx.stockMovement.create({
          data: {
            productId: line.componentId,
            warehouseId: workOrder.warehouseId,
            type: 'OUT',
            quantity: line.qtyRequired,
            balanceAfter: bal.quantity,
            refType: 'WORK_ORDER',
            refId: workOrder.id,
            reason: `استهلاك مكوّن — أمر تصنيع ${workOrder.orderNo}`,
            createdById: userId,
          },
        });
      }

      const finishedBal = await tx.stockBalance.upsert({
        where: { productId_warehouseId: { productId: workOrder.productId, warehouseId: workOrder.warehouseId } },
        update: { quantity: { increment: workOrder.qty } },
        create: { productId: workOrder.productId, warehouseId: workOrder.warehouseId, quantity: workOrder.qty },
      });
      await tx.stockMovement.create({
        data: {
          productId: workOrder.productId,
          warehouseId: workOrder.warehouseId,
          type: 'IN',
          quantity: workOrder.qty,
          balanceAfter: finishedBal.quantity,
          refType: 'WORK_ORDER',
          refId: workOrder.id,
          reason: `إنتاج تام — أمر تصنيع ${workOrder.orderNo}`,
          createdById: userId,
        },
      });
    });

    const full = await prisma.workOrder.findUniqueOrThrow({ where: { id }, include: workOrderInclude });
    res.json(full);
  } catch (err: any) {
    if (typeof err?.message === 'string' && (err.message.includes('لا يمكن') || err.message.includes('مُرحَّل') || err.message.includes('غير متوفرة'))) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// DELETE /api/work-orders/:id — only DRAFT orders can be cancelled/removed
router.delete('/:id', requirePermission('manufacturing.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const workOrder = await prisma.workOrder.findUniqueOrThrow({ where: { id } });

    if (workOrder.status !== 'DRAFT') {
      res.status(400).json({ error: 'لا يمكن حذف أمر تصنيع مُرحَّل — أوامر التصنيع المرحّلة سجل دائم' });
      return;
    }

    await prisma.workOrder.delete({ where: { id } });
    res.json({ success: true });
  } catch (err: any) {
    if (typeof err?.message === 'string' && err.message.includes('لا يمكن حذف')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
