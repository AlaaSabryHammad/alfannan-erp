/**
 * Platform console — plans, subscriptions and payments (SaaS owner).
 * Mounted by routes/platform.ts after requirePlatformAdmin.
 *
 *   GET  /plans                       POST /plans            PUT /plans/:id
 *   POST /tenants/:id/subscription/change-plan   { planId }
 *   POST /tenants/:id/subscription/extend-trial  { days }
 *   POST /tenants/:id/subscription/activate      { planId, months, amount?, method, reference?, note? }
 *   POST /tenants/:id/subscription/cancel
 *   PUT  /tenants/:id/subscription/overrides     { limitOverrides?, featureOverrides?, notes? }
 *   GET  /payments?tenantId=
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { platformPrisma as db } from '../lib/platformPrisma';
import { invalidateEntitlements } from '../lib/entitlements';
import { getLastLifecycleResult, runSubscriptionLifecycle } from '../lib/subscriptionLifecycle';

const router = Router();

async function audit(req: Request, action: string, tenantId: number | null, detail?: string): Promise<void> {
  await db.platformAuditLog.create({
    data: { adminId: req.platformAdmin?.adminId ?? null, action, tenantId, detail: detail ?? null },
  });
}

const DAY = 24 * 3600 * 1000;

function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0); // 31 Jan + 1 month → 28/29 Feb, not 3 Mar
  return d;
}

const count = z.number().int().min(0).max(1_000_000).nullable();
const limitsSchema = z.object({
  users: count,
  branches: count,
  warehouses: count,
  products: count,
  salesInvoicesPerMonth: count,
});
const featuresSchema = z.object({
  zatca: z.boolean(),
  manufacturing: z.boolean(),
  advancedReports: z.boolean(),
});

const planBody = z.object({
  nameAr: z.string().trim().min(2).max(60),
  priceMonthly: z.number().min(0).max(1_000_000),
  priceYearly: z.number().min(0).max(10_000_000),
  trialDays: z.number().int().min(0).max(90),
  limits: limitsSchema,
  features: featuresSchema,
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
});

// ── plans ─────────────────────────────────────────────────────────────────────

router.get('/plans', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [plans, counts] = await Promise.all([
      db.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
      db.subscription.groupBy({ by: ['planId'], _count: { _all: true } }),
    ]);
    const byPlan = new Map(counts.map((c) => [c.planId, c._count._all]));
    res.json(plans.map((p) => ({ ...p, subscribers: byPlan.get(p.id) ?? 0 })));
  } catch (err) {
    next(err);
  }
});

router.post('/plans', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = planBody.extend({ code: z.string().regex(/^[a-z0-9_-]{2,30}$/, 'كود الباقة: حروف إنجليزية صغيرة وأرقام فقط') }).parse(req.body);
    if (await db.plan.findUnique({ where: { code: body.code } })) {
      res.status(409).json({ error: 'كود الباقة مستخدم بالفعل' });
      return;
    }
    const plan = await db.plan.create({ data: body });
    await audit(req, 'PLAN_CREATE', null, plan.code);
    res.status(201).json(plan);
  } catch (err) {
    next(err);
  }
});

router.put('/plans/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const body = planBody.parse(req.body);
    const plan = await db.plan.findUnique({ where: { id } });
    if (!plan) {
      res.status(404).json({ error: 'الباقة غير موجودة' });
      return;
    }
    if (plan.code === 'trial' && !body.isActive) {
      res.status(400).json({ error: 'الباقة التجريبية مطلوبة لتسجيل الشركات الجديدة ولا يمكن إيقافها' });
      return;
    }
    const updated = await db.plan.update({ where: { id }, data: body });
    invalidateEntitlements(); // limits/features changed for every subscriber
    await audit(req, 'PLAN_UPDATE', null, plan.code);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── subscription actions ──────────────────────────────────────────────────────

async function loadSubscription(req: Request, res: Response) {
  const tenantId = Number(req.params.id);
  const sub = await db.subscription.findUnique({ where: { tenantId }, include: { plan: true } });
  if (!sub) {
    res.status(404).json({ error: 'لا يوجد اشتراك لهذه الشركة' });
    return null;
  }
  return { tenantId, sub };
}

async function activePlan(planId: number, res: Response) {
  const plan = await db.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive) {
    res.status(400).json({ error: 'الباقة غير موجودة أو موقوفة' });
    return null;
  }
  return plan;
}

router.post('/tenants/:id/subscription/change-plan', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { planId } = z.object({ planId: z.number().int().positive() }).parse(req.body);
    const loaded = await loadSubscription(req, res);
    if (!loaded) return;
    const plan = await activePlan(planId, res);
    if (!plan) return;

    const updated = await db.subscription.update({ where: { tenantId: loaded.tenantId }, data: { planId } });
    invalidateEntitlements(loaded.tenantId);
    await audit(req, 'SUB_CHANGE_PLAN', loaded.tenantId, `${loaded.sub.plan.code} → ${plan.code}`);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.post('/tenants/:id/subscription/extend-trial', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { days } = z.object({ days: z.number().int().min(1).max(365) }).parse(req.body);
    const loaded = await loadSubscription(req, res);
    if (!loaded) return;

    const now = Date.now();
    const base = Math.max(now, loaded.sub.trialEndsAt?.getTime() ?? now);
    const updated = await db.subscription.update({
      where: { tenantId: loaded.tenantId },
      data: { status: 'TRIALING', trialEndsAt: new Date(base + days * DAY), currentPeriodEnd: null },
    });
    invalidateEntitlements(loaded.tenantId);
    await audit(req, 'SUB_EXTEND_TRIAL', loaded.tenantId, `+${days} يوم`);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

const activateSchema = z.object({
  planId: z.number().int().positive(),
  months: z.number().int().min(1).max(36),
  amount: z.number().min(0).max(10_000_000).optional(),
  method: z.enum(['CASH', 'BANK_TRANSFER', 'CARD', 'OTHER']).default('BANK_TRANSFER'),
  reference: z.string().trim().max(100).optional(),
  note: z.string().trim().max(300).optional(),
});

// Start or renew a paid period. Renewing before the current period ends adds to it (no lost days).
router.post('/tenants/:id/subscription/activate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = activateSchema.parse(req.body);
    const loaded = await loadSubscription(req, res);
    if (!loaded) return;
    const plan = await activePlan(body.planId, res);
    if (!plan) return;

    const now = new Date();
    const stillRunning =
      loaded.sub.status === 'ACTIVE' && loaded.sub.currentPeriodEnd && loaded.sub.currentPeriodEnd > now;
    const periodStart = stillRunning ? loaded.sub.currentPeriodEnd! : now;
    const periodEnd = addMonths(periodStart, body.months);
    const amount = body.amount ?? Number(plan.priceMonthly) * body.months;

    const [sub, payment] = await db.$transaction([
      db.subscription.update({
        where: { tenantId: loaded.tenantId },
        data: {
          planId: plan.id,
          status: 'ACTIVE',
          trialEndsAt: null,
          currentPeriodStart: stillRunning ? loaded.sub.currentPeriodStart ?? now : now,
          currentPeriodEnd: periodEnd,
        },
      }),
      db.subscriptionPayment.create({
        data: {
          tenantId: loaded.tenantId,
          planId: plan.id,
          amount,
          currency: plan.currency,
          method: body.method,
          reference: body.reference ?? null,
          months: body.months,
          periodStart,
          periodEnd,
          note: body.note ?? null,
          recordedByName: req.platformAdmin?.name ?? null,
        },
      }),
    ]);
    invalidateEntitlements(loaded.tenantId);
    await audit(req, 'SUB_ACTIVATE', loaded.tenantId, `${plan.code} × ${body.months} شهر — ${amount} ${plan.currency}`);
    res.json({ subscription: sub, payment });
  } catch (err) {
    next(err);
  }
});

router.post('/tenants/:id/subscription/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const loaded = await loadSubscription(req, res);
    if (!loaded) return;
    const updated = await db.subscription.update({
      where: { tenantId: loaded.tenantId },
      data: { status: 'CANCELED' },
    });
    invalidateEntitlements(loaded.tenantId);
    await audit(req, 'SUB_CANCEL', loaded.tenantId, loaded.sub.plan.code);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

const overridesSchema = z.object({
  limitOverrides: limitsSchema.partial().nullable().optional(),
  featureOverrides: featuresSchema.partial().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

router.put('/tenants/:id/subscription/overrides', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = overridesSchema.parse(req.body);
    const loaded = await loadSubscription(req, res);
    if (!loaded) return;

    const data: Record<string, unknown> = {};
    if (body.limitOverrides !== undefined) data.limitOverrides = body.limitOverrides ?? null;
    if (body.featureOverrides !== undefined) data.featureOverrides = body.featureOverrides ?? null;
    if (body.notes !== undefined) data.notes = body.notes;
    // Prisma needs the JSON-null sentinel to clear a Json column
    for (const k of ['limitOverrides', 'featureOverrides']) {
      if (k in data && data[k] === null) data[k] = Prisma.DbNull;
    }

    const updated = await db.subscription.update({ where: { tenantId: loaded.tenantId }, data });
    invalidateEntitlements(loaded.tenantId);
    await audit(req, 'SUB_OVERRIDES', loaded.tenantId, JSON.stringify({ l: body.limitOverrides, f: body.featureOverrides }));
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── lifecycle job ─────────────────────────────────────────────────────────────

router.get('/lifecycle', (_req: Request, res: Response) => {
  res.json(getLastLifecycleResult());
});

router.post('/lifecycle/run', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await runSubscriptionLifecycle();
    await audit(req, 'LIFECYCLE_RUN', null, JSON.stringify({ t: result.trialsExpired, p: result.movedToPastDue, e: result.expired, r: result.reminders }));
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ── upgrade requests (filed by companies from inside the app) ─────────────────

router.get('/upgrade-requests', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const [rows, plans] = await Promise.all([
      db.upgradeRequest.findMany({
        orderBy: [{ status: 'asc' }, { id: 'desc' }],
        take: 100,
        include: { tenant: { select: { name: true } } },
      }),
      db.plan.findMany({ select: { id: true, nameAr: true } }),
    ]);
    const planName = new Map(plans.map((p) => [p.id, p.nameAr]));
    res.json(rows.map((r) => ({ ...r, tenantName: r.tenant.name, planName: planName.get(r.requestedPlanId) ?? '—' })));
  } catch (err) {
    next(err);
  }
});

router.post('/upgrade-requests/:id/handle', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = Number(req.params.id);
    const existing = await db.upgradeRequest.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'الطلب غير موجود' });
      return;
    }
    const updated = await db.upgradeRequest.update({
      where: { id },
      data: { status: 'HANDLED', handledAt: new Date(), handledByName: req.platformAdmin?.name ?? null },
    });
    await audit(req, 'UPGRADE_REQUEST_HANDLED', existing.tenantId, String(existing.requestedPlanId));
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ── payments ──────────────────────────────────────────────────────────────────

router.get('/payments', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.query.tenantId ? Number(req.query.tenantId) : undefined;
    const rows = await db.subscriptionPayment.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { id: 'desc' },
      take: 200,
      include: { tenant: { select: { name: true } } },
    });
    res.json(rows.map((r) => ({ ...r, amount: Number(r.amount), tenantName: r.tenant.name })));
  } catch (err) {
    next(err);
  }
});

export default router;
