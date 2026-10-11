/**
 * Platform console — plans, subscriptions and payments (subscriptions phase 2).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { app } from './helpers';
import { platformPrisma } from '../src/lib/platformPrisma';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
const ownerEmail = `billing-owner-${stamp}@platform.test`;
const ownerPassword = 'Billing-owner-pass-1';
const companyEmail = `ceo-${stamp}@billing-co.test`;
const DAY = 24 * 3600 * 1000;

let platformToken: string;
let tenantId: number;
let tenantToken: string;
let proId: number;
let basicId: number;

const owner = () => ({ Authorization: `Bearer ${platformToken}` });
const company = () => ({ Authorization: `Bearer ${tenantToken}` });
const sub = (path: string) => `/api/platform/tenants/${tenantId}/subscription/${path}`;

beforeAll(async () => {
  _resetThrottle();
  process.env.ALLOW_SIGNUP = 'true';
  process.env.SUBSCRIPTION_ENFORCEMENT = 'enforce';
  await platformPrisma.platformAdmin.create({
    data: { name: 'مالك', email: ownerEmail, passwordHash: await bcrypt.hash(ownerPassword, 4) },
  });
  const login = await request(app).post('/api/platform/auth/login').send({ email: ownerEmail, password: ownerPassword });
  platformToken = login.body.token;

  const reg = await request(app).post('/api/auth/register-tenant').send({
    companyName: `شركة الفوترة ${stamp}`, adminName: 'مدير', acceptTerms: true, email: companyEmail, password: 'Billing-co-pass-1',
  });
  expect(reg.status).toBe(201);
  tenantToken = reg.body.token;
  tenantId = (jwt.decode(tenantToken) as { tenantId: number }).tenantId;

  proId = (await platformPrisma.plan.findUniqueOrThrow({ where: { code: 'pro' } })).id;
  basicId = (await platformPrisma.plan.findUniqueOrThrow({ where: { code: 'basic' } })).id;
});

afterAll(() => {
  delete process.env.ALLOW_SIGNUP;
});

describe('plans', () => {
  it('lists the default plans with their subscribers', async () => {
    const res = await request(app).get('/api/platform/plans').set(owner());
    expect(res.status).toBe(200);
    const codes = (res.body as Array<{ code: string }>).map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['trial', 'basic', 'pro', 'enterprise']));
    const enterprise = (res.body as Array<{ code: string; subscribers: number }>).find((p) => p.code === 'enterprise')!;
    expect(enterprise.subscribers).toBeGreaterThanOrEqual(1);
  });

  const body = {
    nameAr: 'باقة خاصة', priceMonthly: 250, priceYearly: 2500, trialDays: 0, isActive: true, sortOrder: 9,
    limits: { users: 5, branches: 2, warehouses: 2, products: 1000, salesInvoicesPerMonth: null },
    features: { zatca: true, manufacturing: false, advancedReports: true },
  };

  it('creates, validates and updates a plan', async () => {
    const code = `custom-${stamp}`;
    const created = await request(app).post('/api/platform/plans').set(owner()).send({ ...body, code });
    expect(created.status).toBe(201);
    expect(created.body.limits.salesInvoicesPerMonth).toBeNull();

    const dup = await request(app).post('/api/platform/plans').set(owner()).send({ ...body, code });
    expect(dup.status).toBe(409);

    const badCode = await request(app).post('/api/platform/plans').set(owner()).send({ ...body, code: 'Bad Code!' });
    expect(badCode.status).toBe(400);

    const upd = await request(app)
      .put(`/api/platform/plans/${created.body.id}`)
      .set(owner())
      .send({ ...body, priceMonthly: 275 });
    expect(upd.status).toBe(200);
    expect(Number(upd.body.priceMonthly)).toBe(275);
  });

  it('keeps the trial plan active (sign-up needs it)', async () => {
    const trial = await platformPrisma.plan.findUniqueOrThrow({ where: { code: 'trial' } });
    const res = await request(app)
      .put(`/api/platform/plans/${trial.id}`)
      .set(owner())
      .send({
        nameAr: trial.nameAr, priceMonthly: 0, priceYearly: 0, trialDays: 14, isActive: false, sortOrder: 0,
        limits: trial.limits, features: trial.features,
      });
    expect(res.status).toBe(400);
  });
});

describe('subscription management', () => {
  it('shows the trial in the company detail', async () => {
    const res = await request(app).get(`/api/platform/tenants/${tenantId}`).set(owner());
    expect(res.body.subscription.planCode).toBe('trial');
    expect(res.body.subscription.status).toBe('TRIALING');
    expect(res.body.payments).toEqual([]);
  });

  it('extends the trial', async () => {
    const before = await request(app).get(`/api/platform/tenants/${tenantId}`).set(owner());
    const res = await request(app).post(sub('extend-trial')).set(owner()).send({ days: 10 });
    expect(res.status).toBe(200);
    const diff = new Date(res.body.trialEndsAt).getTime() - new Date(before.body.subscription.trialEndsAt).getTime();
    expect(Math.round(diff / DAY)).toBe(10);
  });

  it('activates a paid plan, records the payment and unlocks the company', async () => {
    // an expired trial first: the company is read-only
    await platformPrisma.subscription.update({ where: { tenantId }, data: { trialEndsAt: new Date(Date.now() - DAY) } });
    const { invalidateEntitlements } = await import('../src/lib/entitlements');
    invalidateEntitlements(tenantId);
    const blocked = await request(app).post('/api/products').set(company()).send({ nameAr: 'x', sku: `B-${stamp}-0`, costPrice: 1, salePrice: 2 });
    expect(blocked.status).toBe(402);

    const res = await request(app).post(sub('activate')).set(owner()).send({
      planId: proId, months: 3, amount: 1100, method: 'BANK_TRANSFER', reference: 'TRX-1001',
    });
    expect(res.status).toBe(200);
    expect(res.body.subscription.status).toBe('ACTIVE');
    expect(res.body.payment.months).toBe(3);

    const months = (new Date(res.body.subscription.currentPeriodEnd).getTime() - Date.now()) / DAY;
    expect(months).toBeGreaterThan(88);
    expect(months).toBeLessThan(93);

    const mine = await request(app).get('/api/subscription').set(company());
    expect(mine.body.planCode).toBe('pro');
    expect(mine.body.status).toBe('ACTIVE');
    expect(mine.body.readOnly).toBe(false);

    const ok = await request(app).post('/api/products').set(company()).send({ nameAr: 'x', sku: `B-${stamp}-1`, costPrice: 1, salePrice: 2 });
    expect(ok.status).toBe(201);
  });

  it('renewing early adds to the running period instead of restarting it', async () => {
    const before = await request(app).get(`/api/platform/tenants/${tenantId}`).set(owner());
    const endBefore = new Date(before.body.subscription.currentPeriodEnd).getTime();

    const res = await request(app).post(sub('activate')).set(owner()).send({ planId: proId, months: 1, method: 'CASH' });
    expect(res.status).toBe(200);
    const endAfter = new Date(res.body.subscription.currentPeriodEnd).getTime();
    expect((endAfter - endBefore) / DAY).toBeGreaterThan(27);
    expect((endAfter - endBefore) / DAY).toBeLessThan(32);
    // amount defaults to monthly price × months
    expect(Number(res.body.payment.amount)).toBe(399);
  });

  it('changes the plan and applies per-company overrides', async () => {
    const change = await request(app).post(sub('change-plan')).set(owner()).send({ planId: basicId });
    expect(change.status).toBe(200);
    const zatca = await request(app).get('/api/zatca/status').set(company());
    expect(zatca.status).toBe(402); // basic has no ZATCA

    const override = await request(app)
      .put(sub('overrides'))
      .set(owner())
      .send({ featureOverrides: { zatca: true }, limitOverrides: { products: 0 }, notes: 'اتفاق خاص' });
    expect(override.status).toBe(200);
    expect((await request(app).get('/api/zatca/status').set(company())).status).toBe(200);
    const limited = await request(app).post('/api/products').set(company()).send({ nameAr: 'y', sku: `B-${stamp}-2`, costPrice: 1, salePrice: 2 });
    expect(limited.status).toBe(402);

    // clearing the overrides returns to the plan
    const cleared = await request(app).put(sub('overrides')).set(owner()).send({ featureOverrides: null, limitOverrides: null });
    expect(cleared.status).toBe(200);
    expect((await request(app).get('/api/zatca/status').set(company())).status).toBe(402);
    const detail = await request(app).get(`/api/platform/tenants/${tenantId}`).set(owner());
    expect(detail.body.subscription.limitOverrides).toBeNull();
  });

  it('cancels (read-only) and reactivates', async () => {
    const cancel = await request(app).post(sub('cancel')).set(owner());
    expect(cancel.status).toBe(200);
    expect((await request(app).get('/api/subscription').set(company())).body.readOnly).toBe(true);
    const blocked = await request(app).post('/api/products').set(company()).send({ nameAr: 'z', sku: `B-${stamp}-3`, costPrice: 1, salePrice: 2 });
    expect(blocked.status).toBe(402);

    await request(app).post(sub('activate')).set(owner()).send({ planId: proId, months: 1, method: 'CASH' });
    const ok = await request(app).post('/api/products').set(company()).send({ nameAr: 'z', sku: `B-${stamp}-4`, costPrice: 1, salePrice: 2 });
    expect(ok.status).toBe(201);
  });

  it('rejects invalid input and unknown companies', async () => {
    expect((await request(app).post(sub('activate')).set(owner()).send({ planId: proId, months: 0 })).status).toBe(400);
    expect((await request(app).post(sub('extend-trial')).set(owner()).send({ days: -3 })).status).toBe(400);
    expect((await request(app).post('/api/platform/tenants/999999/subscription/cancel').set(owner())).status).toBe(404);
    expect((await request(app).post(sub('change-plan')).set(owner()).send({ planId: 999999 })).status).toBe(400);
  });
});

describe('revenue and history', () => {
  it('reports MRR, paying/trialing companies and recent payments', async () => {
    const stats = await request(app).get('/api/platform/stats').set(owner());
    expect(stats.status).toBe(200);
    expect(stats.body.revenue.mrr).toBeGreaterThanOrEqual(399);
    expect(stats.body.revenue.payingTenants).toBeGreaterThanOrEqual(1);
    expect(stats.body.revenue.paidLast30Days).toBeGreaterThanOrEqual(1100);
    expect(Array.isArray(stats.body.revenue.attention)).toBe(true);

    const payments = await request(app).get(`/api/platform/payments?tenantId=${tenantId}`).set(owner());
    expect(payments.status).toBe(200);
    expect(payments.body.length).toBeGreaterThanOrEqual(3);
    expect(payments.body[0].tenantName).toContain('شركة الفوترة');
  });

  it('shows each company’s plan and status in the list, and audits the actions', async () => {
    const list = await request(app).get('/api/platform/tenants').set(owner());
    const mine = (list.body as Array<{ id: number; subscription: { planCode: string; status: string } }>).find((t) => t.id === tenantId)!;
    expect(mine.subscription.planCode).toBe('pro');
    expect(mine.subscription.status).toBe('ACTIVE');

    const log = await request(app).get('/api/platform/audit-log').set(owner());
    const actions = (log.body as Array<{ action: string; tenantId: number | null }>)
      .filter((r) => r.tenantId === tenantId)
      .map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['SUB_EXTEND_TRIAL', 'SUB_ACTIVATE', 'SUB_CHANGE_PLAN', 'SUB_OVERRIDES', 'SUB_CANCEL']));
  });
});
