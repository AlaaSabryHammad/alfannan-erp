/**
 * Plans & subscriptions (SaaS phase 1): entitlements, plan limits, plan features, read-only expiry.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { app } from './helpers';
import { platformPrisma } from '../src/lib/platformPrisma';
import { basePrisma } from '../src/lib/prisma';
import { computeEntitlements, invalidateEntitlements } from '../src/lib/entitlements';

const stamp = Date.now();
const email = `ceo-${stamp}@sub-co.test`;
const password = 'Sub-co-pass-12';
const DAY = 24 * 3600 * 1000;

let token: string;
let tenantId: number;
let adminRoleId: number;
const auth = () => ({ Authorization: `Bearer ${token}` });

async function setSubscription(data: Record<string, unknown>) {
  await platformPrisma.subscription.update({ where: { tenantId }, data });
  invalidateEntitlements(tenantId);
}
async function planId(code: string) {
  return (await platformPrisma.plan.findUniqueOrThrow({ where: { code } })).id;
}
const newProduct = (n: string) => ({ nameAr: `صنف ${n}`, sku: `SUB-${stamp}-${n}`, costPrice: 5, salePrice: 9 });

beforeAll(async () => {
  process.env.ALLOW_SIGNUP = 'true';
  process.env.SUBSCRIPTION_ENFORCEMENT = 'enforce';
  const reg = await request(app).post('/api/auth/register-tenant').send({
    companyName: `شركة الاشتراك ${stamp}`, adminName: 'مدير', email, password,
  });
  expect(reg.status).toBe(201);
  token = reg.body.token;
  tenantId = (jwt.decode(token) as { tenantId: number }).tenantId;
  adminRoleId = reg.body.user.role.id;
});

afterAll(() => {
  delete process.env.ALLOW_SIGNUP;
  process.env.SUBSCRIPTION_ENFORCEMENT = 'enforce';
});

beforeEach(async () => {
  // every test starts from a healthy trial
  await setSubscription({
    planId: await planId('trial'),
    status: 'TRIALING',
    trialEndsAt: new Date(Date.now() + 14 * DAY),
    currentPeriodEnd: null,
    limitOverrides: null,
    featureOverrides: null,
  });
  process.env.SUBSCRIPTION_ENFORCEMENT = 'enforce';
});

describe('computeEntitlements', () => {
  const plan = {
    code: 'basic', nameAr: 'أساسي',
    limits: { users: 3, products: 200 },
    features: { zatca: false, manufacturing: true },
  };
  const base = { status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: null, limitOverrides: null, featureOverrides: null, plan };

  it('takes limits and features from the plan; missing limits are unlimited', () => {
    const e = computeEntitlements(base);
    expect(e.limits.users).toBe(3);
    expect(e.limits.branches).toBeNull();
    expect(e.features.zatca).toBe(false);
    expect(e.features.manufacturing).toBe(true);
    expect(e.readOnly).toBe(false);
  });

  it('lets per-company overrides win', () => {
    const e = computeEntitlements({ ...base, limitOverrides: { users: 50, products: null }, featureOverrides: { zatca: true } });
    expect(e.limits.users).toBe(50);
    expect(e.limits.products).toBeNull();
    expect(e.features.zatca).toBe(true);
  });

  it('derives the status from the dates (trial end, period end, 7-day grace)', () => {
    const now = new Date('2026-06-15T00:00:00Z');
    const d = (days: number) => new Date(now.getTime() + days * DAY);
    expect(computeEntitlements({ ...base, status: 'TRIALING', trialEndsAt: d(3) }, now).status).toBe('TRIALING');
    expect(computeEntitlements({ ...base, status: 'TRIALING', trialEndsAt: d(-1) }, now).status).toBe('EXPIRED');
    expect(computeEntitlements({ ...base, currentPeriodEnd: d(10) }, now).status).toBe('ACTIVE');
    expect(computeEntitlements({ ...base, currentPeriodEnd: d(-2) }, now).status).toBe('PAST_DUE');
    expect(computeEntitlements({ ...base, currentPeriodEnd: d(-8) }, now).status).toBe('EXPIRED');
    expect(computeEntitlements({ ...base, status: 'CANCELED' }, now).readOnly).toBe(true);
  });

  it('fails closed when a company has no subscription', () => {
    const e = computeEntitlements(null);
    expect(e.readOnly).toBe(true);
    expect(e.hasSubscription).toBe(false);
    expect(e.limits.users).toBe(0);
  });
});

describe('subscription API', () => {
  it('starts every new company on a 14-day trial', async () => {
    const res = await request(app).get('/api/subscription').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.planCode).toBe('trial');
    expect(res.body.status).toBe('TRIALING');
    expect(res.body.daysLeft).toBeGreaterThanOrEqual(13);
    expect(res.body.limits.users).toBe(10);
    expect(res.body.features.zatca).toBe(true);
    expect(res.body.usage.users).toBe(1);
    expect(res.body.readOnly).toBe(false);
  });

  it('keeps the migrated company on the unlimited plan', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@store.com', password: '123456' });
    const res = await request(app).get('/api/subscription').set('Authorization', `Bearer ${login.body.token}`);
    expect(res.body.planCode).toBe('enterprise');
    expect(res.body.status).toBe('ACTIVE');
    expect(res.body.limits.users).toBeNull();
  });

  it('a company cannot change its own subscription', async () => {
    await expect(
      basePrisma.$executeRawUnsafe(`UPDATE "Subscription" SET "planId" = 1 WHERE "tenantId" = ${tenantId}`),
    ).rejects.toThrow(/permission denied/i);
    await expect(basePrisma.$executeRawUnsafe(`UPDATE "Plan" SET "priceMonthly" = 0`)).rejects.toThrow(/permission denied/i);
  });
});

describe('plan limits', () => {
  it('blocks creation past the limit with a clear 402', async () => {
    await setSubscription({ limitOverrides: { products: 1 } });

    const first = await request(app).post('/api/products').set(auth()).send(newProduct('1'));
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/products').set(auth()).send(newProduct('2'));
    expect(second.status).toBe(402);
    expect(second.body.code).toBe('PLAN_LIMIT');
    expect(second.body.error).toContain('الأصناف');
  });

  it('allows it again once the limit is raised', async () => {
    await setSubscription({ limitOverrides: { products: 100 } });
    const res = await request(app).post('/api/products').set(auth()).send(newProduct('3'));
    expect(res.status).toBe(201);
  });

  it('limits users (the admin counts as one)', async () => {
    await setSubscription({ limitOverrides: { users: 1 } });
    const res = await request(app).post('/api/users').set(auth()).send({
      name: 'موظف', email: `staff-${stamp}@sub-co.test`, password: 'staff-pass-1', roleId: adminRoleId,
    });
    expect(res.status).toBe(402);
    expect(res.body.code).toBe('PLAN_LIMIT');
  });

  it('only logs (does not block) in log mode', async () => {
    await setSubscription({ limitOverrides: { users: 1 } });
    process.env.SUBSCRIPTION_ENFORCEMENT = 'log';
    const res = await request(app).post('/api/users').set(auth()).send({
      name: 'موظف سجل', email: `staff-log-${stamp}@sub-co.test`, password: 'staff-pass-1', roleId: adminRoleId,
    });
    expect(res.status).toBe(201);
  });
});

describe('plan features', () => {
  it('hides ZATCA and manufacturing on the basic plan, keeps everything else', async () => {
    await setSubscription({ planId: await planId('basic'), status: 'ACTIVE', trialEndsAt: null });

    const zatca = await request(app).get('/api/zatca/status').set(auth());
    expect(zatca.status).toBe(402);
    expect(zatca.body.code).toBe('FEATURE_NOT_IN_PLAN');

    const bom = await request(app).get('/api/bom').set(auth());
    expect(bom.status).toBe(402);

    const products = await request(app).get('/api/products').set(auth());
    expect(products.status).toBe(200);
  });

  it('an override can switch a feature on for one company', async () => {
    await setSubscription({ planId: await planId('basic'), status: 'ACTIVE', featureOverrides: { zatca: true } });
    const zatca = await request(app).get('/api/zatca/status').set(auth());
    expect(zatca.status).toBe(200);
  });
});

describe('expiry', () => {
  it('turns an expired trial into read-only: reads work, writes answer 402', async () => {
    await setSubscription({ status: 'TRIALING', trialEndsAt: new Date(Date.now() - DAY) });

    const sub = await request(app).get('/api/subscription').set(auth());
    expect(sub.body.status).toBe('EXPIRED');
    expect(sub.body.readOnly).toBe(true);

    expect((await request(app).get('/api/products').set(auth())).status).toBe(200);
    expect((await request(app).get('/api/dashboard').set(auth())).status).toBe(200);

    const write = await request(app).post('/api/products').set(auth()).send(newProduct('exp'));
    expect(write.status).toBe(402);
    expect(write.body.code).toBe('SUBSCRIPTION_READ_ONLY');
  });

  it('gives a 7-day grace period after the paid period ends', async () => {
    await setSubscription({
      planId: await planId('pro'), status: 'ACTIVE', trialEndsAt: null,
      currentPeriodEnd: new Date(Date.now() - 2 * DAY),
    });
    const grace = await request(app).post('/api/products').set(auth()).send(newProduct('grace'));
    expect(grace.status).toBe(201);
    expect((await request(app).get('/api/subscription').set(auth())).body.status).toBe('PAST_DUE');

    await setSubscription({ currentPeriodEnd: new Date(Date.now() - 10 * DAY) });
    const late = await request(app).post('/api/products').set(auth()).send(newProduct('late'));
    expect(late.status).toBe(402);
  });

  it('is fully restored when the owner renews', async () => {
    await setSubscription({ status: 'TRIALING', trialEndsAt: new Date(Date.now() - DAY) });
    expect((await request(app).post('/api/products').set(auth()).send(newProduct('r1'))).status).toBe(402);

    await setSubscription({
      planId: await planId('pro'), status: 'ACTIVE', trialEndsAt: null,
      currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * DAY),
    });
    expect((await request(app).post('/api/products').set(auth()).send(newProduct('r2'))).status).toBe(201);
  });
});
