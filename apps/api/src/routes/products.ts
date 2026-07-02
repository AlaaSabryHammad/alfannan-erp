import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';

const router = Router();
router.use(requireAuth);

const productSchema = z.object({
  nameAr: z.string().min(1),
  sku: z.string().min(1),
  barcode: z.string().optional().nullable(),
  departmentId: z.number().int().optional().nullable(),
  brandId: z.number().int().optional().nullable(),
  unitId: z.number().int().optional().nullable(),
  costPrice: z.number().positive(),
  salePrice: z.number().positive(),
  wholesalePrice: z.number().positive().optional().nullable(),
  halfWholesalePrice: z.number().positive().optional().nullable(),
  taxRate: z.number().min(0).max(100).optional(),
  expiryDate: z.coerce.date().optional().nullable(),
  reorderPoint: z.number().min(0).optional().nullable(),
  reorderQty: z.number().min(0).optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

// GET /api/products
router.get('/', requirePermission('products.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const where = search
      ? {
          OR: [
            { nameAr: { contains: search, mode: 'insensitive' as const } },
            { sku: { contains: search, mode: 'insensitive' as const } },
            { barcode: { contains: search } },
          ],
        }
      : {};

    const [data, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { id: 'desc' },
        include: {
          department: true,
          brand: true,
          unit: true,
          stockBalances: { include: { warehouse: true } },
        },
      }),
      prisma.product.count({ where }),
    ]);

    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/products/barcode/:code — exact barcode/SKU lookup (POS scanner)
router.get('/barcode/:code', requirePermission('products.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = req.params.code.trim();
    const product = await prisma.product.findFirst({
      where: {
        isActive: true,
        OR: [
          { barcode: code },
          { sku: code },
        ],
      },
      include: { unit: true, stockBalances: { include: { warehouse: true } } },
    });
    if (!product) {
      res.status(404).json({ error: 'لم يتم العثور على صنف بهذا الباركود' });
      return;
    }
    res.json(product);
  } catch (err) {
    next(err);
  }
});

// GET /api/products/:id
router.get('/:id', requirePermission('products.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: { department: true, brand: true, unit: true, stockBalances: { include: { warehouse: true } } },
    });
    res.json(product);
  } catch (err) {
    next(err);
  }
});

// POST /api/products
router.post('/', requirePermission('products.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = productSchema.parse(req.body);
    const product = await prisma.product.create({ data });
    res.status(201).json(product);
  } catch (err) {
    next(err);
  }
});

// PUT /api/products/:id
router.put('/:id', requirePermission('products.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = productSchema.partial().parse(req.body);
    const product = await prisma.product.update({
      where: { id: parseInt(req.params.id) },
      data,
    });
    res.json(product);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/products/:id
router.delete('/:id', requirePermission('products.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.product.update({
      where: { id: parseInt(req.params.id) },
      data: { isActive: false },
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
