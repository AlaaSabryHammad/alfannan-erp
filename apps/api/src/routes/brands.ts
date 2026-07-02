import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';

const router = Router();
router.use(requireAuth);

const brandSchema = z.object({
  nameAr: z.string().min(1),
  logoUrl: z.string().url().optional().nullable(),
  sortOrder: z.number().int().optional(),
});

router.get('/', requirePermission('brands.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const where = search ? { nameAr: { contains: search, mode: 'insensitive' as const } } : {};
    const [data, total] = await Promise.all([
      prisma.brand.findMany({ where, skip, take: pageSize, orderBy: { sortOrder: 'asc' } }),
      prisma.brand.count({ where }),
    ]);
    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

router.post('/', requirePermission('brands.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = brandSchema.parse(req.body);
    const brand = await prisma.brand.create({ data });
    res.status(201).json(brand);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', requirePermission('brands.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = brandSchema.partial().parse(req.body);
    const brand = await prisma.brand.update({ where: { id: parseInt(req.params.id) }, data });
    res.json(brand);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requirePermission('brands.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.brand.delete({ where: { id: parseInt(req.params.id) } });
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
