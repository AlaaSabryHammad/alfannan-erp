import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';

const router = Router();
router.use(requireAuth);

// GET /api/stock/balances
router.get('/balances', requirePermission('stock.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const warehouseId = req.query.warehouseId ? parseInt(req.query.warehouseId as string) : undefined;

    const productWhere = search
      ? { OR: [{ nameAr: { contains: search, mode: 'insensitive' as const } }, { sku: { contains: search } }] }
      : {};

    const where: Record<string, unknown> = { product: productWhere };
    if (warehouseId) where.warehouseId = warehouseId;

    const [data, total] = await Promise.all([
      prisma.stockBalance.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { id: 'asc' },
        include: {
          product: { include: { unit: true, brand: true, department: true } },
          warehouse: true,
        },
      }),
      prisma.stockBalance.count({ where }),
    ]);

    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/stock/movements
router.get('/movements', requirePermission('stock.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const productId = req.query.productId ? parseInt(req.query.productId as string) : undefined;
    const warehouseId = req.query.warehouseId ? parseInt(req.query.warehouseId as string) : undefined;

    const where: Record<string, unknown> = {};
    if (productId) where.productId = productId;
    if (warehouseId) where.warehouseId = warehouseId;

    const [data, total] = await Promise.all([
      prisma.stockMovement.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          product: { select: { id: true, nameAr: true, sku: true } },
          warehouse: { select: { id: true, nameAr: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      prisma.stockMovement.count({ where }),
    ]);

    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// POST /api/stock/adjust
const adjustSchema = z.object({
  productId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  quantity: z.number().nonnegative(),
  reason: z.string().optional(),
});

router.post('/adjust', requirePermission('stock.adjust'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { productId, warehouseId, quantity, reason } = adjustSchema.parse(req.body);
    const userId = req.user!.userId;

    const result = await prisma.$transaction(async (tx) => {
      const balance = await tx.stockBalance.upsert({
        where: { productId_warehouseId: { productId, warehouseId } },
        update: { quantity },
        create: { productId, warehouseId, quantity },
      });
      const movement = await tx.stockMovement.create({
        data: {
          productId,
          warehouseId,
          type: 'ADJUST',
          quantity: Math.abs(quantity),
          balanceAfter: quantity,
          reason: reason ?? 'تسوية مخزون',
          createdById: userId,
        },
      });
      return { balance, movement };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
