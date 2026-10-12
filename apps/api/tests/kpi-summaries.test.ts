/**
 * KPI cards must show real totals, not figures computed from one capped page.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './helpers';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
let h: { Authorization: string };

beforeAll(async () => {
  _resetThrottle();
  _resetRateLimits();
  process.env.ALLOW_SIGNUP = 'true';
  const res = await request(app).post('/api/auth/register-tenant').send({
    companyName: `شركة المؤشرات ${stamp}`, adminName: 'مدير', email: `kpi-${stamp}@company.test`,
    password: 'Company-pass-12345', acceptTerms: true,
  });
  expect(res.status).toBe(201);
  h = { Authorization: `Bearer ${res.body.token}` };
});

describe('list size cap', () => {
  it('honours the 500 / 1000 rows the web app asks for (no silent cut at 100)', async () => {
    for (let i = 0; i < 12; i++) {
      await request(app).post('/api/customers').set(h).send({ nameAr: `عميل ${i}` });
    }
    const res = await request(app).get('/api/customers?page=1&pageSize=1000').set(h);
    expect(res.status).toBe(200);
    expect(res.body.pagination.pageSize).toBe(1000);
    // and never more than the cap
    const huge = await request(app).get('/api/customers?pageSize=99999').set(h);
    expect(huge.body.pagination.pageSize).toBe(1000);
  });
});

describe('summaries', () => {
  it('customers: total, active and total debt come from the database', async () => {
    await request(app).post('/api/customers').set(h).send({ nameAr: 'عميل مدين', creditLimit: 1000, currentBalance: 250 });
    await request(app).post('/api/customers').set(h).send({ nameAr: 'عميل موقوف', status: 'INACTIVE' });
    const s = await request(app).get('/api/customers/summary').set(h);
    expect(s.status).toBe(200);
    const list = await request(app).get('/api/customers?pageSize=1000').set(h);
    expect(s.body.total).toBe(list.body.pagination.total);
    expect(s.body.active).toBe(list.body.data.filter((c: { status: string }) => c.status === 'ACTIVE').length);
    expect(s.body.totalDebt).toBe(
      list.body.data.reduce((n: number, c: { currentBalance: string }) => n + Number(c.currentBalance), 0),
    );
  });

  it('sales invoices: the summary answers for the whole range and needs permission', async () => {
    const s = await request(app).get('/api/sales-invoices/summary').set(h);
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ count: 0, total: 0, paidCount: 0, unpaidCount: 0 });
    expect((await request(app).get('/api/sales-invoices/summary')).status).toBe(401);
  });

  it('stock transfers: counts by status and total quantity', async () => {
    const s = await request(app).get('/api/stock-transfers/summary').set(h);
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ total: 0, done: 0, pending: 0, totalQty: 0 });
  });
});
