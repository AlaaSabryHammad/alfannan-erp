/**
 * Platform console — growth and revenue analytics (read only; OWNER and SUPPORT).
 * Mounted by routes/platform.ts after requirePlatformAdmin.
 *
 *   GET /analytics?days=90&dormantDays=14
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { platformPrisma as db } from '../lib/platformPrisma';
import { computeEntitlements } from '../lib/entitlements';

const router = Router();
const DAY = 24 * 3600 * 1000;

const query = z.object({
  days: z.coerce.number().int().min(7).max(365).default(90),
  dormantDays: z.coerce.number().int().min(3).max(180).default(14),
});

/** Monday 00:00 UTC of the week containing d, as YYYY-MM-DD */
function weekStart(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - dow);
  return x.toISOString().slice(0, 10);
}

const idSet = (rows: Array<{ tenantId: number }>) => new Set(rows.map((r) => r.tenantId));

router.get('/analytics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { days, dormantDays } = query.parse(req.query);
    const now = Date.now();
    const since = new Date(now - days * DAY);
    const since30 = new Date(now - 30 * DAY);

    const [tenants, subs, plans, products, customers, invoices, verifiedAdmins, paidEver, activity, sales30, payments, lostEvents] =
      await Promise.all([
        db.tenant.findMany({ select: { id: true, name: true, isActive: true, createdAt: true } }),
        db.subscription.findMany({ include: { plan: true } }),
        db.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
        db.product.groupBy({ by: ['tenantId'] }),
        db.customer.groupBy({ by: ['tenantId'] }),
        db.salesInvoice.groupBy({ by: ['tenantId'] }),
        db.user.groupBy({ by: ['tenantId'], where: { role: { code: 'ADMIN' }, emailVerifiedAt: { not: null } } }),
        db.subscriptionPayment.groupBy({ by: ['tenantId'] }),
        db.auditLog.groupBy({ by: ['tenantId'], _max: { createdAt: true } }),
        db.salesInvoice.groupBy({
          by: ['tenantId'],
          where: { date: { gte: since30 } },
          _count: { _all: true },
          _sum: { total: true },
        }),
        db.subscriptionPayment.findMany({
          where: { createdAt: { gte: new Date(now - 190 * DAY) } },
          select: { amount: true, createdAt: true },
        }),
        db.platformAuditLog.findMany({
          where: { createdAt: { gte: since }, action: { in: ['SUB_CANCEL', 'SUB_AUTO_EXPIRE'] } },
          orderBy: { id: 'desc' },
          take: 500,
        }),
      ]);

    const nameOf = new Map(tenants.map((t) => [t.id, t.name]));

    // ── funnel for the companies that registered in the period ────────────────
    const cohort = tenants.filter((t) => t.createdAt >= since);
    const verified = idSet(verifiedAdmins);
    const activated = new Set([...idSet(products), ...idSet(customers), ...idSet(invoices)]);
    const paid = idSet(paidEver);
    const inCohort = (set: Set<number>) => cohort.filter((t) => set.has(t.id)).length;
    const funnel = {
      registered: cohort.length,
      emailVerified: inCohort(verified),
      activated: inCohort(activated),
      paid: inCohort(paid),
    };

    // ── signups per week ──────────────────────────────────────────────────────
    const weeks = new Map<string, number>();
    for (let t = since.getTime(); t <= now; t += 7 * DAY) weeks.set(weekStart(new Date(t)), 0);
    weeks.set(weekStart(new Date(now)), weeks.get(weekStart(new Date(now))) ?? 0);
    for (const t of cohort) {
      const k = weekStart(t.createdAt);
      weeks.set(k, (weeks.get(k) ?? 0) + 1);
    }
    const signups = [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, count]) => ({ week, count }));

    // ── subscriptions now ─────────────────────────────────────────────────────
    const statusCounts: Record<string, number> = { TRIALING: 0, ACTIVE: 0, PAST_DUE: 0, EXPIRED: 0, CANCELED: 0 };
    const byPlan = new Map<number, { planName: string; priceMonthly: number; subscribers: number; trialing: number; mrr: number }>();
    for (const p of plans) {
      byPlan.set(p.id, { planName: p.nameAr, priceMonthly: Number(p.priceMonthly), subscribers: 0, trialing: 0, mrr: 0 });
    }
    let mrr = 0;
    let payingNow = 0;
    for (const s of subs) {
      const st = computeEntitlements(s).status;
      statusCounts[st] = (statusCounts[st] ?? 0) + 1;
      const row = byPlan.get(s.planId);
      if (!row) continue;
      if (st === 'TRIALING') row.trialing += 1;
      if ((st === 'ACTIVE' || st === 'PAST_DUE') && row.priceMonthly > 0) {
        row.subscribers += 1;
        row.mrr += row.priceMonthly;
        mrr += row.priceMonthly;
        payingNow += 1;
      }
    }

    // ── collected per month (last 6 calendar months) ──────────────────────────
    const monthly = new Map<string, number>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - i, 1));
      monthly.set(d.toISOString().slice(0, 7), 0);
    }
    for (const p of payments) {
      const k = p.createdAt.toISOString().slice(0, 7);
      if (monthly.has(k)) monthly.set(k, (monthly.get(k) ?? 0) + Number(p.amount));
    }

    // ── churn ─────────────────────────────────────────────────────────────────
    const isTrialExpiry = (e: { action: string; detail: string | null }) =>
      e.action === 'SUB_AUTO_EXPIRE' && (e.detail ?? '').includes('التجريبية');
    const trialsNotConverted = lostEvents.filter(isTrialExpiry).length;
    const paidLost = lostEvents.filter((e) => !isTrialExpiry(e));
    const lostBase = payingNow + paidLost.length;
    const churn = {
      trialsExpired: trialsNotConverted,
      paidLost: paidLost.length,
      ratePct: lostBase > 0 ? Math.round((paidLost.length / lostBase) * 1000) / 10 : 0,
      recent: paidLost.slice(0, 10).map((e) => ({
        tenantId: e.tenantId,
        name: e.tenantId ? nameOf.get(e.tenantId) ?? '' : '',
        action: e.action,
        at: e.createdAt,
      })),
    };

    // ── dormant companies ─────────────────────────────────────────────────────
    const lastActivity = new Map(activity.map((a) => [a.tenantId, a._max.createdAt]));
    const subOf = new Map(subs.map((s) => [s.tenantId, s]));
    const dormant = tenants
      .filter((t) => t.isActive && now - t.createdAt.getTime() >= 3 * DAY)
      .map((t) => {
        const last = lastActivity.get(t.id) ?? null;
        const idleFrom = (last ?? t.createdAt).getTime();
        const s = subOf.get(t.id);
        return {
          tenantId: t.id,
          name: t.name,
          createdAt: t.createdAt,
          lastActivityAt: last,
          daysIdle: Math.floor((now - idleFrom) / DAY),
          status: s ? computeEntitlements(s).status : null,
          planName: s?.plan.nameAr ?? null,
        };
      })
      .filter((t) => t.daysIdle >= dormantDays)
      .sort((a, b) => b.daysIdle - a.daysIdle)
      .slice(0, 50);

    // ── most active by sales ──────────────────────────────────────────────────
    const topTenants = sales30
      .map((r) => ({
        tenantId: r.tenantId,
        name: nameOf.get(r.tenantId) ?? '',
        invoices30: r._count._all,
        sales30: Number(r._sum.total ?? 0),
      }))
      .sort((a, b) => b.sales30 - a.sales30)
      .slice(0, 5);

    res.json({
      period: { days, since, dormantDays },
      funnel,
      signups,
      statusCounts,
      revenue: {
        mrr,
        payingNow,
        byPlan: [...byPlan.values()].filter((p) => p.subscribers > 0 || p.trialing > 0),
        monthly: [...monthly.entries()].map(([month, amount]) => ({ month, amount })),
      },
      churn,
      dormant,
      topTenants,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
