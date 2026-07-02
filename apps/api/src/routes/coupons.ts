// كوبونات الخصم — Discount Coupons
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';

const router = Router();
router.use(requireAuth);

const couponSchema = z.object({
  code: z.string().min(2).transform((s) => s.trim().toUpperCase()),
  type: z.enum(['PERCENTAGE', 'FIXED']),
  value: z.number().positive(),
  minPurchaseAmount: z.number().nonnegative().optional().default(0),
  maxDiscountAmount: z.number().positive().optional().nullable(),
  validFrom: z.string().optional().nullable(),
  validTo: z.string().optional().nullable(),
  usageLimit: z.number().int().positive().optional().nullable(),
  isActive: z.boolean().optional().default(true),
});

// GET /api/coupons
router.get('/', requirePermission('marketing.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const where = search ? { code: { contains: search.toUpperCase() } } : {};

    const [data, total] = await Promise.all([
      prisma.coupon.findMany({ where, skip, take: pageSize, orderBy: { id: 'desc' } }),
      prisma.coupon.count({ where }),
    ]);
    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/coupons/validate?code=X&subtotal=Y — used by POS before checkout
router.get('/validate', requirePermission('sales.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const code = String(req.query.code ?? '').trim().toUpperCase();
    const subtotal = parseFloat(req.query.subtotal as string) || 0;

    const coupon = await prisma.coupon.findUnique({ where: { code } });
    const invalid = validateCoupon(coupon, subtotal);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }

    const discountAmount = computeCouponDiscount(coupon!, subtotal);
    res.json({ coupon, discountAmount });
  } catch (err) {
    next(err);
  }
});

// POST /api/coupons
router.post('/', requirePermission('marketing.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = couponSchema.parse(req.body);
    const coupon = await prisma.coupon.create({
      data: {
        code: body.code,
        type: body.type,
        value: body.value,
        minPurchaseAmount: body.minPurchaseAmount,
        maxDiscountAmount: body.maxDiscountAmount ?? null,
        validFrom: body.validFrom ? new Date(body.validFrom) : null,
        validTo: body.validTo ? new Date(body.validTo) : null,
        usageLimit: body.usageLimit ?? null,
        isActive: body.isActive,
      },
    });
    res.status(201).json(coupon);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(400).json({ error: 'هذا الكود مستخدم بالفعل لكوبون آخر' });
      return;
    }
    next(err);
  }
});

// PUT /api/coupons/:id
router.put('/:id', requirePermission('marketing.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = couponSchema.partial().parse(req.body);
    const coupon = await prisma.coupon.update({
      where: { id: parseInt(req.params.id) },
      data: {
        ...(body.code !== undefined && { code: body.code }),
        ...(body.type !== undefined && { type: body.type }),
        ...(body.value !== undefined && { value: body.value }),
        ...(body.minPurchaseAmount !== undefined && { minPurchaseAmount: body.minPurchaseAmount }),
        ...(body.maxDiscountAmount !== undefined && { maxDiscountAmount: body.maxDiscountAmount }),
        ...(body.validFrom !== undefined && { validFrom: body.validFrom ? new Date(body.validFrom) : null }),
        ...(body.validTo !== undefined && { validTo: body.validTo ? new Date(body.validTo) : null }),
        ...(body.usageLimit !== undefined && { usageLimit: body.usageLimit }),
        ...(body.isActive !== undefined && { isActive: body.isActive }),
      },
    });
    res.json(coupon);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(400).json({ error: 'هذا الكود مستخدم بالفعل لكوبون آخر' });
      return;
    }
    next(err);
  }
});

// DELETE /api/coupons/:id
router.delete('/:id', requirePermission('marketing.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.coupon.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
  } catch (err: any) {
    if (err?.code === 'P2003' || err?.code === 'P2014') {
      res.status(400).json({ error: 'لا يمكن حذف الكوبون لوجود فواتير مرتبطة به — يمكنك تعطيله بدلاً من ذلك' });
      return;
    }
    next(err);
  }
});

// ── Shared validation helpers (also used from salesInvoices.ts) ────────────────

export function validateCoupon(
  coupon: { isActive: boolean; validFrom: Date | null; validTo: Date | null; usageLimit: number | null; usedCount: number; minPurchaseAmount: unknown } | null,
  subtotal: number,
): string | null {
  if (!coupon) return 'كود الكوبون غير صحيح';
  if (!coupon.isActive) return 'هذا الكوبون غير مُفعّل';
  const now = new Date();
  if (coupon.validFrom && now < coupon.validFrom) return 'لم يبدأ سريان هذا الكوبون بعد';
  if (coupon.validTo && now > coupon.validTo) return 'انتهت صلاحية هذا الكوبون';
  if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) return 'تم استهلاك الحد الأقصى لاستخدام هذا الكوبون';
  if (subtotal < Number(coupon.minPurchaseAmount)) return `الحد الأدنى للشراء لاستخدام هذا الكوبون هو ${Number(coupon.minPurchaseAmount).toFixed(2)}`;
  return null;
}

export function computeCouponDiscount(
  coupon: { type: 'PERCENTAGE' | 'FIXED'; value: unknown; maxDiscountAmount: unknown },
  subtotal: number,
): number {
  let discount = coupon.type === 'PERCENTAGE' ? subtotal * (Number(coupon.value) / 100) : Number(coupon.value);
  if (coupon.type === 'PERCENTAGE' && coupon.maxDiscountAmount !== null) {
    discount = Math.min(discount, Number(coupon.maxDiscountAmount));
  }
  return Math.min(discount, subtotal);
}

export default router;
