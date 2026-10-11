/**
 * Self-service tenant registration (SaaS phase 3): a new company is provisioned with roles, a chart
 * of accounts and a working admin — isolated from every other tenant.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, prisma } from './helpers';
import { runUnscoped } from '../src/lib/tenantContext';

const stamp = Date.now();
const email = `owner-${stamp}@new-company.test`;
const password = 'Str0ng-pass!';
let token: string;
let tenantId: number;

const post = (body: object) => request(app).post('/api/auth/register-tenant').send(body);
const valid = { companyName: 'شركة النور للتجارة', adminName: 'أحمد المالك', acceptTerms: true, email, password };

beforeAll(() => {
  process.env.ALLOW_SIGNUP = 'true';
});
afterAll(() => {
  delete process.env.ALLOW_SIGNUP;
});

describe('tenant registration', () => {
  it('is refused when sign-ups are not enabled', async () => {
    delete process.env.ALLOW_SIGNUP;
    const res = await post({ ...valid, email: `off-${stamp}@x.test` });
    expect(res.status).toBe(403);
    process.env.ALLOW_SIGNUP = 'true';
  });

  it('validates the payload', async () => {
    expect((await post({ ...valid, password: 'short' })).status).toBe(400);
    expect((await post({ ...valid, email: 'not-an-email' })).status).toBe(400);
    expect((await post({ ...valid, companyName: '' })).status).toBe(400);
  });

  it('creates the company and returns a logged-in admin', async () => {
    const res = await post(valid);
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.email).toBe(email);
    expect(res.body.user.role.code).toBe('ADMIN');
    expect(res.body.user.permissions.length).toBeGreaterThan(50);
    token = res.body.token;

    const tenant = await runUnscoped(() => prisma.tenant.findFirstOrThrow({ where: { name: valid.companyName } }));
    tenantId = tenant.id;
    expect(tenantId).toBeGreaterThan(1);
  });

  it('rejects a second registration with the same e-mail (case-insensitive)', async () => {
    const res = await post({ ...valid, email: email.toUpperCase() });
    expect(res.status).toBe(409);
  });

  it('lets the new admin log in with the chosen password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password });
    expect(res.status).toBe(200);
  });

  it('starts with the standard roles, chart of accounts, units and warehouse', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const roles = await request(app).get('/api/roles').set(auth);
    expect(roles.status).toBe(200);
    const roleCodes = (roles.body as Array<{ code: string }>).map((r) => r.code).sort();
    expect(roleCodes).toEqual(['ACCOUNTANT', 'ADMIN', 'CASHIER', 'MANAGER', 'STOREKEEPER']);

    const accounts = await request(app).get('/api/accounts').set(auth);
    expect(accounts.status).toBe(200);
    const flat = JSON.stringify(accounts.body);
    for (const code of ['1000', '1200', '3000', '2000', '4000', '5000']) expect(flat).toContain(`"code":"${code}"`);

    const warehouses = await request(app).get('/api/warehouses').set(auth);
    expect(warehouses.status).toBe(200);
    expect((Array.isArray(warehouses.body) ? warehouses.body : warehouses.body.data).length).toBe(1);

    const settings = await request(app).get('/api/settings').set(auth);
    expect(settings.body.companyName).toBe(valid.companyName);
  });

  it('is empty of business data and isolated from tenant 1', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const products = await request(app).get('/api/products').set(auth);
    expect(products.body.pagination.total).toBe(0);
    const customers = await request(app).get('/api/customers').set(auth);
    const list = Array.isArray(customers.body) ? customers.body : customers.body.data;
    expect(list.length).toBe(0);

    const dash = await request(app).get('/api/dashboard').set(auth);
    expect(dash.status).toBe(200);
  });

  it('can run a sales flow end-to-end in the new company', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const wh = (await request(app).get('/api/warehouses').set(auth)).body;
    const warehouseId = (Array.isArray(wh) ? wh : wh.data)[0].id;

    const product = await request(app).post('/api/products').set(auth).send({
      nameAr: 'صنف تجريبي', sku: `SKU-${stamp}`, costPrice: 10, salePrice: 25, taxRate: 15,
    });
    expect(product.status).toBe(201);

    const customer = await request(app).post('/api/customers').set(auth).send({ nameAr: 'عميل نقدي', creditLimit: 0 });
    expect(customer.status).toBe(201);

    const adjust = await request(app).post('/api/stock/adjust').set(auth).send({
      productId: product.body.id, warehouseId, quantity: 50, reason: 'رصيد افتتاحي',
    });
    expect([200, 201]).toContain(adjust.status);

    const invoice = await request(app).post('/api/sales-invoices').set(auth).send({
      customerId: customer.body.id,
      warehouseId,
      paymentMethod: 'CASH',
      items: [{ productId: product.body.id, qty: 2, unitPrice: 25 }],
    });
    expect(invoice.status).toBe(201);
    expect(Number(invoice.body.total)).toBeGreaterThan(0);
  });
});
