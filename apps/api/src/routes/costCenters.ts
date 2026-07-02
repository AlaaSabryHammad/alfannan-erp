import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';

const router = Router();
router.use(requireAuth);

const costCenterSchema = z.object({
  code: z.string().min(1),
  nameAr: z.string().min(1),
  isActive: z.boolean().optional(),
});

// GET /api/cost-centers
router.get('/', requirePermission('accounts.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const where = search
      ? { OR: [{ nameAr: { contains: search, mode: 'insensitive' as const } }, { code: { contains: search } }] }
      : {};
    const [data, total] = await Promise.all([
      prisma.costCenter.findMany({ where, skip, take: pageSize, orderBy: { code: 'asc' } }),
      prisma.costCenter.count({ where }),
    ]);
    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// POST /api/cost-centers
router.post('/', requirePermission('accounts.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = costCenterSchema.parse(req.body);
    const costCenter = await prisma.costCenter.create({ data });
    res.status(201).json(costCenter);
  } catch (err) {
    next(err);
  }
});

// PUT /api/cost-centers/:id
router.put('/:id', requirePermission('accounts.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = costCenterSchema.partial().parse(req.body);
    const costCenter = await prisma.costCenter.update({ where: { id: parseInt(req.params.id) }, data });
    res.json(costCenter);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/cost-centers/:id
router.delete('/:id', requirePermission('accounts.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.costCenter.delete({ where: { id: parseInt(req.params.id) } });
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
