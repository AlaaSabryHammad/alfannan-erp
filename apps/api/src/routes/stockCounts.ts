/**
 * Stock counts — الجرد المخزني
 *
 * A count session snapshots the system quantity for each product as it's added,
 * the user enters what was physically counted, and posting the session applies
 * the variance as stock adjustments (same effect as /stock/adjust, but batched
 * and auditable as one event with a before/after variance report).
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';

const router = Router();
router.use(requireAuth);

async function generateCountNo(): Promise<string> {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `SC-${y}${m}${d}-`;
  // max + 1 (not count + 1): draft sessions are deletable, and a count-based
  // sequence would re-issue a number that still exists → unique-constraint failure.
  const last = await prisma.stockCount.findFirst({
    where: { countNo: { startsWith: prefix } },
    orderBy: { countNo: 'desc' },
    select: { countNo: true },
  });
  const lastSeq = last ? parseInt(last.countNo.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1).padStart(4, '0')}`;
}

// GET /api/stock-counts — list
router.get('/', requirePermission('stockcount.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const status = req.query.status as string | undefined;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      prisma.stockCount.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { id: 'desc' },
        include: {
          warehouse: { select: { id: true, nameAr: true } },
          lines: { select: { systemQty: true, countedQty: true } },
        },
      }),
      prisma.stockCount.count({ where }),
    ]);

    const rows = data.map((sc) => {
      const itemCount = sc.lines.length;
      const varianceQty = sc.lines.reduce((s, l) => s + (Number(l.countedQty) - Number(l.systemQty)), 0);
      return { ...sc, lines: undefined, itemCount, varianceQty };
    });

    res.json(paginatedResponse(rows, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/stock-counts/:id — detail with lines
router.get('/:id', requirePermission('stockcount.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stockCount = await prisma.stockCount.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: {
        warehouse: { select: { id: true, nameAr: true } },
        lines: {
          include: { product: { select: { id: true, nameAr: true, sku: true, barcode: true, unit: { select: { nameAr: true } } } } },
          orderBy: { id: 'asc' },
        },
      },
    });
    res.json(stockCount);
  } catch (err) {
    next(err);
  }
});

// POST /api/stock-counts — start a new draft session
const createSchema = z.object({
  warehouseId: z.number().int().positive(),
  notes: z.string().optional().nullable(),
});

router.post('/', requirePermission('stockcount.adjust'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createSchema.parse(req.body);
    const userId = req.user!.userId;
    const countNo = await generateCountNo();

    const stockCount = await prisma.stockCount.create({
      data: {
        countNo,
        warehouseId: body.warehouseId,
        notes: body.notes ?? null,
        createdById: userId,
      },
      include: { warehouse: { select: { id: true, nameAr: true } } },
    });

    res.status(201).json(stockCount);
  } catch (err) {
    next(err);
  }
});

// PUT /api/stock-counts/:id/lines — add or update one counted line
const lineSchema = z.object({
  productId: z.number().int().positive(),
  countedQty: z.number().nonnegative(),
});

router.put('/:id/lines', requirePermission('stockcount.adjust'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stockCountId = parseInt(req.params.id);
    const body = lineSchema.parse(req.body);

    const stockCount = await prisma.stockCount.findUniqueOrThrow({ where: { id: stockCountId } });
    if (stockCount.status !== 'DRAFT') {
      res.status(400).json({ error: 'لا يمكن تعديل جرد تم ترحيله' });
      return;
    }

    const existing = await prisma.stockCountLine.findUnique({
      where: { stockCountId_productId: { stockCountId, productId: body.productId } },
    });

    let line;
    if (existing) {
      line = await prisma.stockCountLine.update({
        where: { id: existing.id },
        data: { countedQty: body.countedQty },
        include: { product: { select: { id: true, nameAr: true, sku: true, barcode: true, unit: { select: { nameAr: true } } } } },
      });
    } else {
      // Snapshot the system quantity at the moment this product is first added to the count
      const balance = await prisma.stockBalance.findUnique({
        where: { productId_warehouseId: { productId: body.productId, warehouseId: stockCount.warehouseId } },
      });
      const systemQty = balance ? Number(balance.quantity) : 0;

      line = await prisma.stockCountLine.create({
        data: { stockCountId, productId: body.productId, systemQty, countedQty: body.countedQty },
        include: { product: { select: { id: true, nameAr: true, sku: true, barcode: true, unit: { select: { nameAr: true } } } } },
      });
    }

    res.json(line);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/stock-counts/:id/lines/:productId — remove a counted line
router.delete('/:id/lines/:productId', requirePermission('stockcount.adjust'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stockCountId = parseInt(req.params.id);
    const productId = parseInt(req.params.productId);

    const stockCount = await prisma.stockCount.findUniqueOrThrow({ where: { id: stockCountId } });
    if (stockCount.status !== 'DRAFT') {
      res.status(400).json({ error: 'لا يمكن تعديل جرد تم ترحيله' });
      return;
    }

    await prisma.stockCountLine.delete({
      where: { stockCountId_productId: { stockCountId, productId } },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/stock-counts/:id/post — finalize: apply variances as stock adjustments
router.post('/:id/post', requirePermission('stockcount.adjust'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user!.userId;

    const stockCount = await prisma.stockCount.findUniqueOrThrow({
      where: { id },
      include: { lines: true },
    });

    if (stockCount.status !== 'DRAFT') {
      res.status(400).json({ error: 'هذا الجرد مُرحَّل مسبقاً' });
      return;
    }
    if (stockCount.lines.length === 0) {
      res.status(400).json({ error: 'لا توجد أصناف في هذا الجرد' });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Claim the session atomically first: the DRAFT check above ran outside
      // the transaction, so two concurrent posts could both pass it and apply
      // the adjustments twice. updateMany with the status filter lets only one win.
      const claimed = await tx.stockCount.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'POSTED', postedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new Error('هذا الجرد مُرحَّل مسبقاً');
      }

      for (const line of stockCount.lines) {
        const countedQty = Number(line.countedQty);
        const variance = countedQty - Number(line.systemQty);

        await tx.stockBalance.upsert({
          where: { productId_warehouseId: { productId: line.productId, warehouseId: stockCount.warehouseId } },
          update: { quantity: countedQty },
          create: { productId: line.productId, warehouseId: stockCount.warehouseId, quantity: countedQty },
        });

        if (variance !== 0) {
          await tx.stockMovement.create({
            data: {
              productId: line.productId,
              warehouseId: stockCount.warehouseId,
              type: 'ADJUST',
              quantity: new Prisma.Decimal(Math.abs(variance)),
              balanceAfter: new Prisma.Decimal(countedQty),
              refType: 'STOCK_COUNT',
              refId: stockCount.id,
              reason: `جرد مخزني ${stockCount.countNo} — ${variance > 0 ? 'زيادة' : 'نقص'} ${Math.abs(variance)}`,
              createdById: userId,
            },
          });
        }
      }
    });

    const full = await prisma.stockCount.findUniqueOrThrow({
      where: { id },
      include: {
        warehouse: { select: { id: true, nameAr: true } },
        lines: { include: { product: { select: { id: true, nameAr: true, sku: true, unit: { select: { nameAr: true } } } } } },
      },
    });

    res.json(full);
  } catch (err: any) {
    if (typeof err?.message === 'string' && (
      err.message.includes('لا يمكن') || err.message.includes('مُرحَّل') || err.message.includes('لا توجد أصناف')
    )) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// DELETE /api/stock-counts/:id — cancel a draft session (posted ones are permanent)
router.delete('/:id', requirePermission('stockcount.adjust'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const stockCount = await prisma.stockCount.findUniqueOrThrow({ where: { id } });
    if (stockCount.status !== 'DRAFT') {
      res.status(400).json({ error: 'لا يمكن حذف جرد تم ترحيله' });
      return;
    }
    await prisma.stockCount.delete({ where: { id } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
