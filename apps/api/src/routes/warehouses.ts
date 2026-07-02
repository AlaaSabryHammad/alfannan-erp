import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';

const router = Router();
router.use(requireAuth);

const warehouseSchema = z.object({
  nameAr: z.string().min(1),
  location: z.string().optional().nullable(),
  managerId: z.number().int().optional().nullable(),
  branchId: z.number().int().positive().optional().nullable(),
  isActive: z.boolean().optional(),
});

router.get('/', requirePermission('warehouses.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const where = search ? { nameAr: { contains: search, mode: 'insensitive' as const } } : {};
    const [data, total] = await Promise.all([
      prisma.warehouse.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { id: 'asc' },
        include: { manager: { select: { id: true, name: true, email: true } }, branch: { select: { id: true, nameAr: true } } },
      }),
      prisma.warehouse.count({ where }),
    ]);
    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', requirePermission('warehouses.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wh = await prisma.warehouse.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: { manager: { select: { id: true, name: true, email: true } }, branch: { select: { id: true, nameAr: true } } },
    });
    res.json(wh);
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('warehouses.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = warehouseSchema.parse(req.body);
    const wh = await prisma.warehouse.create({ data });
    res.status(201).json(wh);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('warehouses.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = warehouseSchema.partial().parse(req.body);
    const wh = await prisma.warehouse.update({ where: { id: parseInt(req.params.id) }, data });
    res.json(wh);
  } catch (err) {
    next(err);
  }
});

// Soft delete — warehouses have isActive, preserve stock history
router.delete('/:id', requirePermission('warehouses.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.warehouse.update({
      where: { id: parseInt(req.params.id) },
      data: { isActive: false },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
