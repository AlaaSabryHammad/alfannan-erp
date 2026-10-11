/**
 * Online subscription payments (fake gateway): checkout, webhook authenticity, idempotency,
 * amount tampering, polling, reconciliation, isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { app } from './helpers';
import { platformPrisma } from '../src/lib/platformPrisma';
import { invalidateEntitlements } from '../src/lib/entitlements';
import { getFakeProvider } from '../src/lib/payments/provider';
import { runSubscriptionLifecycle } from '../src/lib/subscriptionLifecycle';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
const DAY = 24 * 3600 * 1000;
const WEBHOOK_SECRET = 'whsec-test-0123456789';
const fake = getFakeProvider();

interface Company { token: string; tenantId: number; roles: Record<string, number> }
let A: Company;
let B: Company;
let proId: number;
let basicId: number;
let trialId: number;

const auth = (c: Company) => ({ Authorization: `Bearer ${c.token}` });

async function register(name: string): Promise<Company> {
  const reg = await request(app).post('/api/auth/register-tenant').send({
    companyName: `${name} ${stamp}`, adminName: 'مدير', email: `${name}-${stamp}@pay.test`, password: 'Payments-pass-1',
  });
  expect(reg.status).toBe(201);
  const token = reg.body.token as string;
  const roles = await request(app).get('/api/roles').set('Authorization', `Bearer ${token}`);
  return {
    token,
    tenantId: (jwt.decode(token) as { tenantId: number }).tenantId,
    roles: Object.fromEntries((roles.body as Array<{ code: string; id: number }>).map((r) => [r.code, r.id])),
  };
}

async function checkout(c: Company, planId: number, months: 1 | 12 = 1) {
  const res = await request(app).post('/api/subscription/checkout').set(auth(c)).send({ planId, months });
  return res;
}

async function invoiceOf(orderId: number) {
  const order = await platformPrisma.paymentOrder.findUniqueOrThrow({ where: { id: orderId } });
  return order.providerInvoiceId!;
}

async function subscriptionOf(c: Company) {
  return platformPrisma.subscription.findUniqueOrThrow({ where: { tenantId: c.tenantId } });
}

/** the callback URL we gave the gateway, as a path+query the test can POST to */
function callbackPath(invoiceId: string): string {
  const url = new URL(fake.lastRequestFor(invoiceId)!.callbackUrl);
  return url.pathname + url.search;
}

beforeAll(async () => {
  _resetThrottle();
  _resetRateLimits();
  process.env.ALLOW_SIGNUP = 'true';
  process.env.SUBSCRIPTION_ENFORCEMENT = 'enforce';
  A = await register('payA');
  B = await register('payB');
  proId = (await platformPrisma.plan.findUniqueOrThrow({ where: { code: 'pro' } })).id;
  basicId = (await platformPrisma.plan.findUniqueOrThrow({ where: { code: 'basic' } })).id;
  trialId = (await platformPrisma.plan.findUniqueOrThrow({ where: { code: 'trial' } })).id;
});

afterAll(() => {
  delete process.env.ALLOW_SIGNUP;
});

describe('starting a checkout', () => {
  it('tells the app that payments are available', async () => {
    const res = await request(app).get('/api/subscription').set(auth(A));
    expect(res.body.paymentsEnabled).toBe(true);
  });

  it('prices the order on the server and returns the gateway page', async () => {
    const res = await request(app).post('/api/subscription/checkout').set(auth(A))
      // a hostile client tries to dictate the price
      .send({ planId: proId, months: 1, amount: 1, amountMinor: 100 });
    expect(res.status).toBe(201);
    expect(res.body.checkoutUrl).toMatch(/^https:\/\/fake-gateway\.test\/checkout\//);

    const order = await platformPrisma.paymentOrder.findUniqueOrThrow({ where: { id: res.body.orderId } });
    expect(order.status).toBe('PENDING');
    expect(Number(order.amount)).toBe(399);
    expect(order.tenantId).toBe(A.tenantId);

    const sent = fake.lastRequestFor(order.providerInvoiceId!)!;
    expect(sent.amountMinor).toBe(39900);
    expect(sent.currency).toBe('SAR');
    expect(sent.successUrl).toContain(`order=${order.id}`);
  });

  it('uses the yearly price for twelve months', async () => {
    const res = await checkout(A, proId, 12);
    expect(res.status).toBe(201);
    const order = await platformPrisma.paymentOrder.findUniqueOrThrow({ where: { id: res.body.orderId } });
    expect(Number(order.amount)).toBe(3990);
    expect(order.months).toBe(12);
  });

  it('rejects the trial plan, unknown plans, unsupported periods and bad input', async () => {
    expect((await checkout(A, trialId)).status).toBe(400);
    expect((await checkout(A, 999999)).status).toBe(400);
    const sixMonths = await request(app).post('/api/subscription/checkout').set(auth(A)).send({ planId: proId, months: 6 });
    expect(sixMonths.status).toBe(400);
  });

  it('is limited to users who can edit settings', async () => {
    const created = await request(app).post('/api/users').set(auth(A)).send({
      name: 'كاشير', email: `cashier-${stamp}@pay.test`, password: 'Cashier-pass-12', roleId: A.roles.CASHIER,
    });
    expect(created.status).toBe(201);
    const login = await request(app).post('/api/auth/login').send({ email: `cashier-${stamp}@pay.test`, password: 'Cashier-pass-12' });
    const res = await request(app).post('/api/subscription/checkout')
      .set('Authorization', `Bearer ${login.body.token}`).send({ planId: proId, months: 1 });
    expect(res.status).toBe(403);
  });
});

describe('settling a payment', () => {
  it('refuses a callback with a wrong signature or a wrong shared secret', async () => {
    const res = await checkout(A, proId);
    const invoiceId = await invoiceOf(res.body.orderId);

    const badSig = await request(app).post(`/api/webhooks/moyasar?order=${res.body.orderId}&sig=${'0'.repeat(64)}`).send({});
    expect(badSig.status).toBe(401);
    const noAuth = await request(app).post('/api/webhooks/moyasar').send({ data: { invoice_id: invoiceId } });
    expect(noAuth.status).toBe(401);
    const wrongSecret = await request(app).post('/api/webhooks/moyasar')
      .send({ secret_token: 'nope', data: { invoice_id: invoiceId } });
    expect(wrongSecret.status).toBe(401);
  });

  it('does nothing while the gateway says the invoice is unpaid, even with a valid callback', async () => {
    const res = await checkout(A, proId);
    const invoiceId = await invoiceOf(res.body.orderId);
    const before = await subscriptionOf(A);

    const hook = await request(app).post(callbackPath(invoiceId)).send({ status: 'paid' }); // the body lies
    expect(hook.status).toBe(200);
    expect(hook.body.status).toBe('PENDING');
    const after = await subscriptionOf(A);
    expect(after.status).toBe(before.status);
  });

  it('activates the subscription once the gateway confirms, and only once', async () => {
    const res = await checkout(A, proId, 1);
    const invoiceId = await invoiceOf(res.body.orderId);
    fake.markPaid(invoiceId);

    const paymentsBefore = await platformPrisma.subscriptionPayment.count({ where: { tenantId: A.tenantId } });

    const first = await request(app).post(callbackPath(invoiceId)).send({});
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('PAID');

    const sub = await subscriptionOf(A);
    expect(sub.status).toBe('ACTIVE');
    expect(sub.planId).toBe(proId);
    expect(sub.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now() + 27 * DAY);

    const payment = await platformPrisma.subscriptionPayment.findFirstOrThrow({
      where: { tenantId: A.tenantId }, orderBy: { id: 'desc' },
    });
    expect(payment.method).toBe('CARD');
    expect(Number(payment.amount)).toBe(399);
    expect(payment.reference).toBe(`fake_pay_${invoiceId}`);

    // the gateway retries, the browser reloads, a second webhook arrives …
    const endAfterFirst = sub.currentPeriodEnd!.getTime();
    await request(app).post(callbackPath(invoiceId)).send({});
    await request(app).post(callbackPath(invoiceId)).send({});
    const again = await subscriptionOf(A);
    expect(again.currentPeriodEnd!.getTime()).toBe(endAfterFirst);
    expect(await platformPrisma.subscriptionPayment.count({ where: { tenantId: A.tenantId } })).toBe(paymentsBefore + 1);
  });

  it('also understands the dashboard webhook (shared secret, payment object)', async () => {
    const res = await checkout(A, proId);
    const invoiceId = await invoiceOf(res.body.orderId);
    fake.markPaid(invoiceId);

    const hook = await request(app).post('/api/webhooks/moyasar').send({
      id: 'evt_1', type: 'payment_paid', secret_token: WEBHOOK_SECRET,
      data: { id: 'pay_1', invoice_id: invoiceId, status: 'paid' },
    });
    expect(hook.status).toBe(200);
    expect(hook.body.status).toBe('PAID');
  });

  it('does not activate when the paid amount differs from the order (tampering / short payment)', async () => {
    const res = await checkout(B, proId);
    const invoiceId = await invoiceOf(res.body.orderId);
    fake.markPaid(invoiceId, { amountMinor: 100 });

    const hook = await request(app).post(callbackPath(invoiceId)).send({});
    expect(hook.body.status).toBe('FAILED');
    const order = await platformPrisma.paymentOrder.findUniqueOrThrow({ where: { id: res.body.orderId } });
    expect(order.failureReason).toContain('amount_mismatch');
    expect((await subscriptionOf(B)).status).toBe('TRIALING');
  });

  it('records a failed payment without touching the subscription', async () => {
    const res = await checkout(B, basicId);
    const invoiceId = await invoiceOf(res.body.orderId);
    fake.markFailed(invoiceId, 'card declined');
    const hook = await request(app).post(callbackPath(invoiceId)).send({});
    expect(hook.body.status).toBe('FAILED');
    expect((await subscriptionOf(B)).status).toBe('TRIALING');
  });
});

describe('the return page and the safety net', () => {
  it('lets the return page settle a payment whose webhook was lost', async () => {
    const res = await checkout(B, proId);
    const invoiceId = await invoiceOf(res.body.orderId);
    fake.markPaid(invoiceId);
    // pretend the customer has been waiting a while
    await platformPrisma.paymentOrder.update({
      where: { id: res.body.orderId }, data: { createdAt: new Date(Date.now() - 60_000) },
    });

    const poll = await request(app).get(`/api/subscription/checkout/${res.body.orderId}`).set(auth(B));
    expect(poll.status).toBe(200);
    expect(poll.body.status).toBe('PAID');
    expect((await subscriptionOf(B)).status).toBe('ACTIVE');
  });

  it('reconciles stale pending orders and closes abandoned ones', async () => {
    const paid = await checkout(A, proId);
    const paidInvoice = await invoiceOf(paid.body.orderId);
    fake.markPaid(paidInvoice);
    const abandoned = await checkout(A, basicId);

    await platformPrisma.paymentOrder.update({ where: { id: paid.body.orderId }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
    await platformPrisma.paymentOrder.update({ where: { id: abandoned.body.orderId }, data: { createdAt: new Date(Date.now() - 25 * 3600_000) } });

    const result = await runSubscriptionLifecycle();
    expect(result.paymentsSettled).toBeGreaterThanOrEqual(1);
    expect(result.errors).toEqual([]);

    expect((await platformPrisma.paymentOrder.findUniqueOrThrow({ where: { id: paid.body.orderId } })).status).toBe('PAID');
    const closed = await platformPrisma.paymentOrder.findUniqueOrThrow({ where: { id: abandoned.body.orderId } });
    expect(closed.status).toBe('EXPIRED');
  });

  it('lets an expired (read-only) company pay its way back in', async () => {
    const C = await register('payC');
    await platformPrisma.subscription.update({
      where: { tenantId: C.tenantId }, data: { status: 'TRIALING', trialEndsAt: new Date(Date.now() - DAY) },
    });
    invalidateEntitlements(C.tenantId);

    const blocked = await request(app).post('/api/products').set(auth(C))
      .send({ nameAr: 'x', sku: `PAY-${stamp}`, costPrice: 1, salePrice: 2 });
    expect(blocked.status).toBe(402);

    const res = await checkout(C, proId);
    expect(res.status).toBe(201);
    const invoiceId = await invoiceOf(res.body.orderId);
    fake.markPaid(invoiceId);
    await request(app).post(callbackPath(invoiceId)).send({});

    const unlocked = await request(app).post('/api/products').set(auth(C))
      .send({ nameAr: 'x', sku: `PAY-${stamp}`, costPrice: 1, salePrice: 2 });
    expect(unlocked.status).toBe(201);
  });
});

describe('isolation and the owner console', () => {
  it('hides one company\'s orders from another, and the app role cannot alter them', async () => {
    const res = await checkout(A, proId);
    const other = await request(app).get(`/api/subscription/checkout/${res.body.orderId}`).set(auth(B));
    expect(other.status).toBe(404);

    const { basePrisma } = await import('../src/lib/prisma');
    await expect(
      basePrisma.$executeRawUnsafe(`UPDATE "PaymentOrder" SET "status" = 'PAID' WHERE id = ${res.body.orderId}`),
    ).rejects.toThrow(/permission denied/i);
  });

  it('shows the orders to the platform owner and can re-check one', async () => {
    const ownerEmail = `pay-owner-${stamp}@platform.test`;
    await platformPrisma.platformAdmin.create({
      data: { name: 'مالك', email: ownerEmail, passwordHash: await bcrypt.hash('Owner-pass-12345', 4) },
    });
    const owner = (await request(app).post('/api/platform/auth/login').send({ email: ownerEmail, password: 'Owner-pass-12345' })).body.token;
    const asOwner = { Authorization: `Bearer ${owner}` };

    const list = await request(app).get('/api/platform/payment-orders').set(asOwner);
    expect(list.status).toBe(200);
    const statuses = new Set((list.body as Array<{ status: string }>).map((o) => o.status));
    expect(statuses.has('PAID')).toBe(true);
    expect(statuses.has('PENDING') || statuses.has('FAILED')).toBe(true);
    expect((list.body[0] as { tenantName: string }).tenantName).toBeTruthy();

    const pending = (list.body as Array<{ id: number; status: string }>).find((o) => o.status === 'PENDING');
    if (pending) {
      const settle = await request(app).post(`/api/platform/payment-orders/${pending.id}/settle`).set(asOwner);
      expect(settle.status).toBe(200);
    }
    expect((await request(app).get('/api/platform/payment-orders')).status).toBe(401);
  });
});
