import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';

const router = Router();
router.use(requireAuth);

const partnerSchema = z.object({
  nameAr: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  capitalRequired: z.number().nonnegative().optional().default(0),
  capitalPaid: z.number().nonnegative().optional().default(0),
  profitSharePct: z.number().min(0).max(100).optional().default(0),
  currentBalance: z.number().optional().default(0),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
});

// GET /api/partners
router.get('/', requirePermission('partners.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const where = search
      ? {
          OR: [
            { nameAr: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search } },
          ],
        }
      : {};
    const [data, total] = await Promise.all([
      prisma.partner.findMany({ where, skip, take: pageSize, orderBy: { id: 'asc' } }),
      prisma.partner.count({ where }),
    ]);
    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/partners/summary — aggregate KPIs
router.get('/summary', requirePermission('partners.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const partners = await prisma.partner.findMany();

    const totalCapitalRequired = partners.reduce((s, p) => s + Number(p.capitalRequired), 0);
    const totalCapitalPaid = partners.reduce((s, p) => s + Number(p.capitalPaid), 0);
    const totalCurrentBalance = partners.reduce((s, p) => s + Number(p.currentBalance), 0);
    const paymentPct = totalCapitalRequired > 0
      ? Math.round((totalCapitalPaid / totalCapitalRequired) * 100)
      : 0;

    res.json({
      totalCapitalRequired,
      totalCapitalPaid,
      paymentPct,
      netCurrentBalance: totalCurrentBalance,
      partnerCount: partners.length,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/partners/:id
router.get('/:id', requirePermission('partners.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const partner = await prisma.partner.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
    });
    res.json(partner);
  } catch (err) {
    next(err);
  }
});

// POST /api/partners
router.post('/', requirePermission('partners.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = partnerSchema.parse(req.body);
    const partner = await prisma.partner.create({ data });
    res.status(201).json(partner);
  } catch (err) {
    next(err);
  }
});

// PUT /api/partners/:id
router.put('/:id', requirePermission('partners.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = partnerSchema.partial().parse(req.body);
    const partner = await prisma.partner.update({ where: { id: parseInt(req.params.id) }, data });
    res.json(partner);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/partners/:id
router.delete('/:id', requirePermission('partners.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.partner.delete({ where: { id: parseInt(req.params.id) } });
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
