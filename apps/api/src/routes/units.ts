import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';

const router = Router();
router.use(requireAuth);

const unitSchema = z.object({
  nameAr: z.string().min(1),
  code: z.string().min(1).toUpperCase(),
});

router.get('/', requirePermission('units.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const where = search
      ? { OR: [{ nameAr: { contains: search, mode: 'insensitive' as const } }, { code: { contains: search } }] }
      : {};
    const [data, total] = await Promise.all([
      prisma.unit.findMany({ where, skip, take: pageSize, orderBy: { id: 'asc' } }),
      prisma.unit.count({ where }),
    ]);
    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('units.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = unitSchema.parse(req.body);
    const unit = await prisma.unit.create({ data });
    res.status(201).json(unit);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission('units.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.unit.delete({ where: { id: parseInt(req.params.id) } });
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
