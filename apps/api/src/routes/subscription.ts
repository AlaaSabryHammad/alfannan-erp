/**
 * Subscription — the company's own view of its plan (read-mostly).
 *
 *   GET  /api/subscription                    plan, status, limits, usage, features
 *   GET  /api/subscription/plans              plans the company can move to (for the comparison)
 *   GET  /api/subscription/payments           its payment history
 *   GET  /api/subscription/upgrade-requests   its own requests
 *   POST /api/subscription/upgrade-request    ask the platform owner for a plan change
 *
 * Plans, periods and overrides are managed from the platform console only.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { enforcementMode, getEntitlements, getUsage } from '../lib/entitlements';

const router = Router();
router.use(requireAuth);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const [entitlements, usage] = await Promise.all([getEntitlements(tenantId), getUsage(tenantId)]);
    res.json({ ...entitlements, usage, enforcement: enforcementMode() });
  } catch (err) {
    next(err);
  }
});

router.get('/plans', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const plans = await prisma.plan.findMany({
      where: { isActive: true, code: { not: 'trial' } },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    res.json(plans.map((p) => ({
      id: p.id,
      code: p.code,
      nameAr: p.nameAr,
      priceMonthly: Number(p.priceMonthly),
      priceYearly: Number(p.priceYearly),
      currency: p.currency,
      limits: p.limits,
      features: p.features,
    })));
  } catch (err) {
    next(err);
  }
});

router.get('/payments', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.subscriptionPayment.findMany({ orderBy: { id: 'desc' }, take: 50 });
    res.json(rows.map((r) => ({
      id: r.id,
      amount: Number(r.amount),
      currency: r.currency,
      method: r.method,
      reference: r.reference,
      months: r.months,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      createdAt: r.createdAt,
    })));
  } catch (err) {
    next(err);
  }
});

router.get('/upgrade-requests', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.upgradeRequest.findMany({ orderBy: { id: 'desc' }, take: 10 });
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

const upgradeSchema = z.object({
  planId: z.number().int().positive(),
  message: z.string().trim().max(500).optional(),
});

router.post(
  '/upgrade-request',
  requirePermission('settings.edit'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = upgradeSchema.parse(req.body);
      const plan = await prisma.plan.findFirst({ where: { id: body.planId, isActive: true, code: { not: 'trial' } } });
      if (!plan) {
        res.status(400).json({ error: 'الباقة غير متاحة' });
        return;
      }
      const pending = await prisma.upgradeRequest.findFirst({
        where: { status: 'PENDING', requestedPlanId: plan.id },
      });
      if (pending) {
        res.status(409).json({ error: 'لديك طلب سابق لهذه الباقة قيد المراجعة' });
        return;
      }
      const user = await prisma.user.findFirst({
        where: { id: req.user!.userId },
        select: { name: true, email: true },
      });
      const created = await prisma.upgradeRequest.create({
        data: {
          requestedPlanId: plan.id,
          message: body.message || null,
          requestedByName: user?.name ?? null,
          requestedByEmail: user?.email ?? null,
        },
      });
      res.status(201).json(created);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
