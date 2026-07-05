/**
 * الفروع ومزامنة البيانات بين الفروع
 *
 * كل الفروع تتشارك نفس قاعدة البيانات المركزية، فالبيانات مُحدَّثة لحظيًا بطبيعتها
 * بين الفروع (لا حاجة لمزامنة شبكية فعلية). زر "مزامنة الآن" هنا يقوم بعملية فعلية:
 * فحص تكامل أرصدة المخزون في مستودعات الفرع (لا رصيد سالب) وتحديث وقت آخر تحقق.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const branchSchema = z.object({
  nameAr: z.string().min(1),
  code: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

// GET /api/branches
router.get('/', requirePermission('branches.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const branches = await prisma.branch.findMany({
      orderBy: { id: 'asc' },
      include: {
        _count: { select: { warehouses: true, users: true } },
      },
    });
    res.json(branches);
  } catch (err) {
    next(err);
  }
});

// GET /api/branches/sync-status — لوحة حالة المزامنة: ملخص لحظي لكل فرع
router.get('/sync-status', requirePermission('branches.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const branches = await prisma.branch.findMany({
      where: { isActive: true },
      include: { warehouses: { select: { id: true, nameAr: true } } },
      orderBy: { id: 'asc' },
    });

    const rows = await Promise.all(
      branches.map(async (b) => {
        const warehouseIds = b.warehouses.map((w) => w.id);
        const [stockAgg, salesAgg, negativeCount] = await Promise.all([
          warehouseIds.length
            ? prisma.stockBalance.aggregate({ where: { warehouseId: { in: warehouseIds } }, _sum: { quantity: true } })
            : Promise.resolve({ _sum: { quantity: null } }),
          warehouseIds.length
            ? prisma.salesInvoice.aggregate({
                where: { warehouseId: { in: warehouseIds }, date: { gte: new Date(new Date().toDateString()) } },
                _sum: { total: true },
                _count: true,
              })
            : Promise.resolve({ _sum: { total: null }, _count: 0 }),
          warehouseIds.length
            ? prisma.stockBalance.count({ where: { warehouseId: { in: warehouseIds }, quantity: { lt: 0 } } })
            : Promise.resolve(0),
        ]);

        return {
          id: b.id,
          nameAr: b.nameAr,
          code: b.code,
          warehouseCount: b.warehouses.length,
          totalStockQty: Number(stockAgg._sum.quantity ?? 0),
          todaySalesCount: salesAgg._count,
          todaySalesTotal: Number(salesAgg._sum.total ?? 0),
          integrityIssues: negativeCount,
          lastSyncedAt: b.lastSyncedAt,
        };
      }),
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/branches/:id
router.get('/:id', requirePermission('branches.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const branch = await prisma.branch.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: {
        warehouses: { select: { id: true, nameAr: true, isActive: true } },
        users: { select: { id: true, name: true, email: true } },
      },
    });
    res.json(branch);
  } catch (err) {
    next(err);
  }
});

// POST /api/branches
router.post('/', requirePermission('branches.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = branchSchema.parse(req.body);
    const branch = await prisma.branch.create({ data: body });
    res.status(201).json(branch);
  } catch (err) {
    next(err);
  }
});

// PUT /api/branches/:id
router.put('/:id', requirePermission('branches.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = branchSchema.partial().parse(req.body);
    const branch = await prisma.branch.update({ where: { id: parseInt(req.params.id) }, data: body });
    res.json(branch);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/branches/:id — soft delete (preserve warehouse/user history)
router.delete('/:id', requirePermission('branches.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.branch.update({ where: { id: parseInt(req.params.id) }, data: { isActive: false } });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/branches/:id/sync — فحص تكامل فعلي + تحديث وقت آخر مزامنة
router.post('/:id/sync', requirePermission('branches.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const branch = await prisma.branch.findUniqueOrThrow({ where: { id }, include: { warehouses: { select: { id: true } } } });
    const warehouseIds = branch.warehouses.map((w) => w.id);

    const negativeBalances = warehouseIds.length
      ? await prisma.stockBalance.findMany({
          where: { warehouseId: { in: warehouseIds }, quantity: { lt: 0 } },
          include: { product: { select: { nameAr: true } }, warehouse: { select: { nameAr: true } } },
        })
      : [];

    const updated = await prisma.branch.update({ where: { id }, data: { lastSyncedAt: new Date() } });

    res.json({
      branch: updated,
      issuesFound: negativeBalances.length,
      issues: negativeBalances.map((b) => `${b.product.nameAr} في ${b.warehouse.nameAr}: رصيد سالب (${Number(b.quantity)})`),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
