/**
 * Subscription lifecycle job (subscriptions phase 4): stored state follows the dates,
 * reminders are recorded once, the bell reflects it, the owner can run it on demand.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { app } from './helpers';
import { platformPrisma } from '../src/lib/platformPrisma';
import { invalidateEntitlements } from '../src/lib/entitlements';
import { runSubscriptionLifecycle } from '../src/lib/subscriptionLifecycle';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
const DAY = 24 * 3600 * 1000;
const ownerEmail = `lc-owner-${stamp}@platform.test`;
const ownerPassword = 'Lifecycle-owner-pass-1';

let tenantId: number;
let token: string;
let platformToken: string;

const co = () => ({ Authorization: `Bearer ${token}` });
const owner = () => ({ Authorization: `Bearer ${platformToken}` });

async function setSub(data: Record<string, unknown>) {
  await platformPrisma.subscription.update({ where: { tenantId }, data });
  invalidateEntitlements(tenantId);
}
const stored = async () => (await platformPrisma.subscription.findUniqueOrThrow({ where: { tenantId } })).status;
const auditCount = (action: string) =>
  platformPrisma.platformAuditLog.count({ where: { tenantId, action } });

beforeAll(async () => {
  _resetThrottle();
  process.env.ALLOW_SIGNUP = 'true';
  process.env.SUBSCRIPTION_ENFORCEMENT = 'enforce';
  await platformPrisma.platformAdmin.create({
    data: { name: 'مالك', email: ownerEmail, passwordHash: await bcrypt.hash(ownerPassword, 4) },
  });
  platformToken = (await request(app).post('/api/platform/auth/login').send({ email: ownerEmail, password: ownerPassword })).body.token;

  const reg = await request(app).post('/api/auth/register-tenant').send({
    companyName: `شركة الدورة ${stamp}`, adminName: 'مدير', email: `ceo-${stamp}@lifecycle.test`, password: 'Lifecycle-co-pass-1',
  });
  expect(reg.status).toBe(201);
  token = reg.body.token;
  tenantId = (jwt.decode(token) as { tenantId: number }).tenantId;
});

afterAll(() => {
  delete process.env.ALLOW_SIGNUP;
});

describe('state transitions', () => {
  it('expires a trial that ran out, once', async () => {
    await setSub({ status: 'TRIALING', trialEndsAt: new Date(Date.now() - DAY), currentPeriodEnd: null });
    const r = await runSubscriptionLifecycle();
    expect(r.trialsExpired).toBeGreaterThanOrEqual(1);
    expect(await stored()).toBe('EXPIRED');
    expect(await auditCount('SUB_AUTO_EXPIRE')).toBe(1);

    await runSubscriptionLifecycle(); // idempotent
    expect(await auditCount('SUB_AUTO_EXPIRE')).toBe(1);
  });

  it('moves an ended paid period to the grace state, which still allows work', async () => {
    const pro = await platformPrisma.plan.findUniqueOrThrow({ where: { code: 'pro' } });
    await setSub({ planId: pro.id, status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: new Date(Date.now() - 2 * DAY) });

    await runSubscriptionLifecycle();
    expect(await stored()).toBe('PAST_DUE');
    expect(await auditCount('SUB_AUTO_PAST_DUE')).toBe(1);

    const write = await request(app).post('/api/products').set(co()).send({ nameAr: 'x', sku: `LC-${stamp}-1`, costPrice: 1, salePrice: 2 });
    expect(write.status).toBe(201);
  });

  it('expires after the 7-day grace, and goes straight there if the job missed the window', async () => {
    await runSubscriptionLifecycle(); // PAST_DUE stays while the grace runs
    expect(await stored()).toBe('PAST_DUE');

    await setSub({ currentPeriodEnd: new Date(Date.now() - 9 * DAY) });
    await runSubscriptionLifecycle();
    expect(await stored()).toBe('EXPIRED');

    await setSub({ status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() - 20 * DAY) });
    await runSubscriptionLifecycle();
    expect(await stored()).toBe('EXPIRED');
  });

  it('a renewal after auto-expiry restores the company', async () => {
    const pro = await platformPrisma.plan.findUniqueOrThrow({ where: { code: 'pro' } });
    const res = await request(app)
      .post(`/api/platform/tenants/${tenantId}/subscription/activate`)
      .set(owner())
      .send({ planId: pro.id, months: 1, method: 'CASH' });
    expect(res.status).toBe(200);
    expect(await stored()).toBe('ACTIVE');
    await runSubscriptionLifecycle();
    expect(await stored()).toBe('ACTIVE');
  });
});

describe('reminders', () => {
  it('records one reminder per milestone (3 days, then 1 day), never twice', async () => {
    await setSub({ status: 'TRIALING', trialEndsAt: new Date(Date.now() + 2 * DAY), currentPeriodEnd: null });

    await runSubscriptionLifecycle();
    await runSubscriptionLifecycle();
    expect(await auditCount('SUB_REMINDER')).toBe(1);

    await setSub({ trialEndsAt: new Date(Date.now() + 12 * 3600 * 1000) });
    await runSubscriptionLifecycle();
    await runSubscriptionLifecycle();
    expect(await auditCount('SUB_REMINDER')).toBe(2);
  });

  it('sends none while there is plenty of time left', async () => {
    const before = await auditCount('SUB_REMINDER');
    await setSub({ status: 'TRIALING', trialEndsAt: new Date(Date.now() + 20 * DAY) });
    await runSubscriptionLifecycle();
    expect(await auditCount('SUB_REMINDER')).toBe(before);
  });
});

describe('visibility', () => {
  it('lights the notification bell only when the subscription needs attention', async () => {
    await setSub({ status: 'TRIALING', trialEndsAt: new Date(Date.now() + 20 * DAY) });
    const healthy = await request(app).get('/api/alerts/summary').set(co());
    expect(healthy.body.subscriptionAlert).toBe(0);

    await setSub({ trialEndsAt: new Date(Date.now() + 2 * DAY) });
    const ending = await request(app).get('/api/alerts/summary').set(co());
    expect(ending.body.subscriptionAlert).toBe(1);
    expect(ending.body.total).toBeGreaterThanOrEqual(1);

    await setSub({ trialEndsAt: new Date(Date.now() - DAY) });
    const expired = await request(app).get('/api/alerts/summary').set(co());
    expect(expired.body.subscriptionAlert).toBe(1);
  });

  it('lets the owner run the job on demand and see the last result', async () => {
    await setSub({ status: 'TRIALING', trialEndsAt: new Date(Date.now() - DAY) });
    const run = await request(app).post('/api/platform/lifecycle/run').set(owner());
    expect(run.status).toBe(200);
    expect(run.body.trialsExpired).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(run.body.errors)).toBe(true);

    const last = await request(app).get('/api/platform/lifecycle').set(owner());
    expect(last.body.ranAt).toBe(run.body.ranAt);

    const unauth = await request(app).post('/api/platform/lifecycle/run');
    expect(unauth.status).toBe(401);
  });
});
