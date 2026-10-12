/**
 * Platform console: growth / revenue analytics.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { app } from './helpers';
import { platformPrisma } from '../src/lib/platformPrisma';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
const ownerEmail = `an-owner-${stamp}@platform.test`;
const ownerPassword = 'Platform-owner-pass-1';
let token: string;
let tenantId: number;
const as = () => ({ Authorization: `Bearer ${token}` });

type Analytics = {
  period: { days: number; dormantDays: number };
  funnel: { registered: number; emailVerified: number; activated: number; paid: number };
  signups: Array<{ week: string; count: number }>;
  statusCounts: Record<string, number>;
  revenue: { mrr: number; payingNow: number; byPlan: unknown[]; monthly: Array<{ month: string; amount: number }> };
  churn: { trialsExpired: number; paidLost: number; ratePct: number };
  dormant: Array<{ tenantId: number; daysIdle: number; lastActivityAt: string | null }>;
  topTenants: unknown[];
};

beforeAll(async () => {
  _resetThrottle();
  _resetRateLimits();
  process.env.ALLOW_SIGNUP = 'true';
  await platformPrisma.platformAdmin.create({
    data: { name: 'مالك', email: ownerEmail, passwordHash: await bcrypt.hash(ownerPassword, 4) },
  });
  token = (await request(app).post('/api/platform/auth/login').send({ email: ownerEmail, password: ownerPassword })).body.token;
});

describe('platform analytics', () => {
  it('needs a platform session', async () => {
    expect((await request(app).get('/api/platform/analytics')).status).toBe(401);
  });

  it('validates the period', async () => {
    expect((await request(app).get('/api/platform/analytics?days=3').set(as())).status).toBe(400);
  });

  it('counts a new company in the funnel and the weekly signups', async () => {
    const before = (await request(app).get('/api/platform/analytics?days=30').set(as())).body as Analytics;

    const reg = await request(app).post('/api/auth/register-tenant').send({
      companyName: `شركة التحليلات ${stamp}`, adminName: 'مدير', email: `an-co-${stamp}@company.test`,
      password: 'Company-pass-12345', acceptTerms: true,
    });
    expect(reg.status).toBe(201);
    tenantId = (jwt.decode(reg.body.token) as { tenantId: number }).tenantId;

    const after = (await request(app).get('/api/platform/analytics?days=30').set(as())).body as Analytics;
    expect(after.funnel.registered).toBe(before.funnel.registered + 1);
    expect(after.funnel.emailVerified).toBe(before.funnel.emailVerified);
    expect(after.funnel.paid).toBeGreaterThanOrEqual(0);
    expect(after.signups.reduce((n, w) => n + w.count, 0)).toBe(after.funnel.registered);
    expect(after.statusCounts.TRIALING).toBeGreaterThan(0);
    expect(after.revenue.monthly).toHaveLength(6);
  });

  it('lists a company that never did anything as dormant, but not a brand-new one', async () => {
    const fresh = (await request(app).get('/api/platform/analytics?days=30&dormantDays=3').set(as())).body as Analytics;
    expect(fresh.dormant.find((d) => d.tenantId === tenantId)).toBeUndefined();

    await platformPrisma.tenant.update({ where: { id: tenantId }, data: { createdAt: new Date(Date.now() - 20 * 24 * 3600 * 1000) } });
    const old = (await request(app).get('/api/platform/analytics?days=30&dormantDays=14').set(as())).body as Analytics;
    const row = old.dormant.find((d) => d.tenantId === tenantId);
    expect(row).toBeTruthy();
    expect(row!.lastActivityAt).toBeNull();
    expect(row!.daysIdle).toBeGreaterThanOrEqual(19);
  });

  it('a paying company shows up in revenue by plan', async () => {
    const plan = await platformPrisma.plan.findFirstOrThrow({ where: { priceMonthly: { gt: 0 } } });
    const sub = await platformPrisma.subscription.findFirstOrThrow({ where: { tenantId } });
    await platformPrisma.subscription.update({
      where: { id: sub.id },
      data: { planId: plan.id, status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 20 * 24 * 3600 * 1000) },
    });
    const res = (await request(app).get('/api/platform/analytics').set(as())).body as Analytics;
    expect(res.revenue.payingNow).toBeGreaterThanOrEqual(1);
    expect(res.revenue.mrr).toBeGreaterThanOrEqual(Number(plan.priceMonthly));
    expect(res.revenue.byPlan.length).toBeGreaterThan(0);
  });
});
