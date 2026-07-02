// قوائم المكونات (Bill of Materials) — تعريف المواد الخام اللازمة لتصنيع كل منتج نهائي
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const bomLineSchema = z.object({
  componentId: z.number().int().positive(),
  qtyPerUnit: z.number().positive(),
});

const bomSchema = z.object({
  productId: z.number().int().positive(),
  notes: z.string().optional().nullable(),
  lines: z.array(bomLineSchema).min(1),
});

const productSelect = { id: true, nameAr: true, sku: true, costPrice: true, unit: { select: { nameAr: true } } };

// GET /api/bom
router.get('/', requirePermission('manufacturing.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const boms = await prisma.billOfMaterial.findMany({
      orderBy: { id: 'desc' },
      include: {
        product: { select: productSelect },
        lines: { include: { component: { select: productSelect } } },
      },
    });
    res.json(boms);
  } catch (err) {
    next(err);
  }
});

// GET /api/bom/:id
router.get('/:id', requirePermission('manufacturing.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const bom = await prisma.billOfMaterial.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: {
        product: { select: productSelect },
        lines: { include: { component: { select: productSelect } } },
      },
    });
    res.json(bom);
  } catch (err) {
    next(err);
  }
});

// POST /api/bom
router.post('/', requirePermission('manufacturing.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = bomSchema.parse(req.body);

    if (body.lines.some((l) => l.componentId === body.productId)) {
      res.status(400).json({ error: 'لا يمكن أن يكون المنتج النهائي مكوّناً في قائمة مكوناته' });
      return;
    }

    const bom = await prisma.billOfMaterial.create({
      data: {
        productId: body.productId,
        notes: body.notes ?? null,
        lines: { create: body.lines.map((l) => ({ componentId: l.componentId, qtyPerUnit: l.qtyPerUnit })) },
      },
      include: { product: { select: productSelect }, lines: { include: { component: { select: productSelect } } } },
    });
    res.status(201).json(bom);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(400).json({ error: 'يوجد بالفعل قائمة مكونات لهذا المنتج' });
      return;
    }
    if (typeof err?.message === 'string' && err.message.includes('لا يمكن أن يكون')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// PUT /api/bom/:id — replace notes + lines
router.put('/:id', requirePermission('manufacturing.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const body = bomSchema.parse(req.body);

    if (body.lines.some((l) => l.componentId === body.productId)) {
      res.status(400).json({ error: 'لا يمكن أن يكون المنتج النهائي مكوّناً في قائمة مكوناته' });
      return;
    }

    const bom = await prisma.$transaction(async (tx) => {
      await tx.bOMLine.deleteMany({ where: { bomId: id } });
      return tx.billOfMaterial.update({
        where: { id },
        data: {
          notes: body.notes ?? null,
          lines: { create: body.lines.map((l) => ({ componentId: l.componentId, qtyPerUnit: l.qtyPerUnit })) },
        },
        include: { product: { select: productSelect }, lines: { include: { component: { select: productSelect } } } },
      });
    });
    res.json(bom);
  } catch (err: any) {
    if (typeof err?.message === 'string' && err.message.includes('لا يمكن أن يكون')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// DELETE /api/bom/:id
router.delete('/:id', requirePermission('manufacturing.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.billOfMaterial.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
  } catch (err: any) {
    if (err?.code === 'P2003' || err?.code === 'P2014') {
      res.status(400).json({ error: 'لا يمكن حذف قائمة المكونات لوجود أوامر تصنيع مرتبطة بها' });
      return;
    }
    next(err);
  }
});

export default router;
