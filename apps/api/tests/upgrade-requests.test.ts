/**
 * Subscription page API for the company (phase 3): plans to compare, payment history,
 * upgrade requests and how the platform owner sees them.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { app } from './helpers';
import { platformPrisma } from '../src/lib/platformPrisma';
import { invalidateEntitlements } from '../src/lib/entitlements';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
const ownerEmail = `up-owner-${stamp}@platform.test`;
const ownerPassword = 'Upgrade-owner-pass-1';
const ceoEmail = `ceo-${stamp}@upgrade-co.test`;
const ceoPassword = 'Upgrade-co-pass-1';
const DAY = 24 * 3600 * 1000;

let platformToken: string;
let token: string;
let tenantId: number;

const co = () => ({ Authorization: `Bearer ${token}` });
const owner = () => ({ Authorization: `Bearer ${platformToken}` });
const planId = async (code: string) => (await platformPrisma.plan.findUniqueOrThrow({ where: { code } })).id;

beforeAll(async () => {
  _resetThrottle();
  process.env.ALLOW_SIGNUP = 'true';
  process.env.SUBSCRIPTION_ENFORCEMENT = 'enforce';
  await platformPrisma.platformAdmin.create({
    data: { name: 'مالك', email: ownerEmail, passwordHash: await bcrypt.hash(ownerPassword, 4) },
  });
  platformToken = (await request(app).post('/api/platform/auth/login').send({ email: ownerEmail, password: ownerPassword })).body.token;

  const reg = await request(app).post('/api/auth/register-tenant').send({
    companyName: `شركة الترقية ${stamp}`, adminName: 'مدير', acceptTerms: true, email: ceoEmail, password: ceoPassword,
  });
  expect(reg.status).toBe(201);
  token = reg.body.token;
  tenantId = (jwt.decode(token) as { tenantId: number }).tenantId;
});

afterAll(() => {
  delete process.env.ALLOW_SIGNUP;
});

describe('plans and payments (company view)', () => {
  it('offers the paid plans for comparison, never the trial plan', async () => {
    const res = await request(app).get('/api/subscription/plans').set(co());
    expect(res.status).toBe(200);
    const codes = (res.body as Array<{ code: string }>).map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['basic', 'pro', 'enterprise']));
    expect(codes).not.toContain('trial');
    const pro = (res.body as Array<{ code: string; priceMonthly: number }>).find((p) => p.code === 'pro')!;
    expect(typeof pro.priceMonthly).toBe('number');
  });

  it('shows the company its own payment history only', async () => {
    expect((await request(app).get('/api/subscription/payments').set(co())).body).toEqual([]);

    await request(app)
      .post(`/api/platform/tenants/${tenantId}/subscription/activate`)
      .set(owner())
      .send({ planId: await planId('basic'), months: 2, amount: 290, method: 'BANK_TRANSFER', reference: 'REF-77' });

    const mine = await request(app).get('/api/subscription/payments').set(co());
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ amount: 290, months: 2, method: 'BANK_TRANSFER', reference: 'REF-77' });

    // the demo company (tenant 1) has none of it
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@store.com', password: '123456' });
    const other = await request(app).get('/api/subscription/payments').set('Authorization', `Bearer ${login.body.token}`);
    expect(other.body.find((p: { reference: string }) => p.reference === 'REF-77')).toBeUndefined();
  });
});

describe('upgrade requests', () => {
  it('files a request, rejects a duplicate and the trial plan', async () => {
    const pro = await planId('pro');
    const created = await request(app).post('/api/subscription/upgrade-request').set(co())
      .send({ planId: pro, message: 'نحتاج فروعًا أكثر' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('PENDING');
    expect(created.body.requestedByEmail).toBe(ceoEmail);

    const dup = await request(app).post('/api/subscription/upgrade-request').set(co()).send({ planId: pro });
    expect(dup.status).toBe(409);

    const trial = await request(app).post('/api/subscription/upgrade-request').set(co()).send({ planId: await planId('trial') });
    expect(trial.status).toBe(400);

    const list = await request(app).get('/api/subscription/upgrade-requests').set(co());
    expect(list.body).toHaveLength(1);
  });

  it('still works when the subscription has expired (read-only mode)', async () => {
    await platformPrisma.subscription.update({
      where: { tenantId },
      data: { status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() - 30 * DAY) },
    });
    invalidateEntitlements(tenantId);

    // other writes are blocked …
    const blocked = await request(app).post('/api/products').set(co()).send({ nameAr: 'x', sku: `U-${stamp}`, costPrice: 1, salePrice: 2 });
    expect(blocked.status).toBe(402);
    // … but asking for an upgrade is not
    const ok = await request(app).post('/api/subscription/upgrade-request').set(co()).send({ planId: await planId('enterprise') });
    expect(ok.status).toBe(201);
  });

  it('is limited to users who can edit settings', async () => {
    const roles = await request(app).get('/api/roles').set(co());
    const cashier = (roles.body as Array<{ id: number; code: string }>).find((r) => r.code === 'CASHIER')!;
    // re-activate so user creation is allowed
    await platformPrisma.subscription.update({
      where: { tenantId },
      data: { currentPeriodEnd: new Date(Date.now() + 30 * DAY) },
    });
    invalidateEntitlements(tenantId);
    const created = await request(app).post('/api/users').set(co()).send({
      name: 'كاشير', email: `cashier-${stamp}@upgrade-co.test`, password: 'cashier-pass-1', roleId: cashier.id,
    });
    expect(created.status).toBe(201);
    const login = await request(app).post('/api/auth/login').send({ email: `cashier-${stamp}@upgrade-co.test`, password: 'cashier-pass-1' });
    const res = await request(app)
      .post('/api/subscription/upgrade-request')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ planId: await planId('pro') });
    expect(res.status).toBe(403);
  });
});

describe('platform owner side', () => {
  it('sees the requests with company and plan names, and marks them handled', async () => {
    const list = await request(app).get('/api/platform/upgrade-requests').set(owner());
    expect(list.status).toBe(200);
    const mine = (list.body as Array<{ id: number; tenantId: number; tenantName: string; planName: string; status: string; message: string | null }>)
      .filter((r) => r.tenantId === tenantId);
    expect(mine.length).toBe(2);
    expect(mine[0].tenantName).toContain('شركة الترقية');
    expect(mine.map((r) => r.planName)).toEqual(expect.arrayContaining(['احترافي', 'مؤسسات']));

    const stats = await request(app).get('/api/platform/stats').set(owner());
    expect(stats.body.pendingUpgradeRequests).toBeGreaterThanOrEqual(2);

    const handled = await request(app).post(`/api/platform/upgrade-requests/${mine[0].id}/handle`).set(owner());
    expect(handled.status).toBe(200);
    expect(handled.body.status).toBe('HANDLED');
    expect(handled.body.handledByName).toBe('مالك');

    // the company sees the new status; it cannot edit a request itself
    const own = await request(app).get('/api/subscription/upgrade-requests').set(co());
    expect((own.body as Array<{ status: string }>).some((r) => r.status === 'HANDLED')).toBe(true);
  });
});
