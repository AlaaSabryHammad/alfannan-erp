/**
 * The point of sale sells to the company's own walk-in customer — never a hard-coded id.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './helpers';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
const make = async (n: number) => {
  const res = await request(app).post('/api/auth/register-tenant').send({
    companyName: `شركة نقاط البيع ${n} ${stamp}`, adminName: 'مدير', email: `pos-${n}-${stamp}@company.test`,
    password: 'Company-pass-12345', acceptTerms: true,
  });
  expect(res.status).toBe(201);
  return { Authorization: `Bearer ${res.body.token}` };
};

let a: { Authorization: string };
let b: { Authorization: string };

beforeAll(async () => {
  _resetThrottle();
  _resetRateLimits();
  process.env.ALLOW_SIGNUP = 'true';
  a = await make(1);
  b = await make(2);
});

describe('walk-in customer', () => {
  it('is created on first use, once, and is the company\'s own', async () => {
    const first = await request(app).get('/api/customers/walk-in').set(a);
    expect(first.status).toBe(200);
    expect(first.body.nameAr).toBe('عميل نقدي عام');

    const again = await request(app).get('/api/customers/walk-in').set(a);
    expect(again.body.id).toBe(first.body.id);

    const other = await request(app).get('/api/customers/walk-in').set(b);
    expect(other.body.id).not.toBe(first.body.id);

    // the other company cannot read it
    const leak = await request(app).get(`/api/customers/${first.body.id}`).set(b);
    expect(leak.status).toBe(404);
  });

  it('a sale to it is accepted by the invoice service (no "record not found")', async () => {
    const walkIn = (await request(app).get('/api/customers/walk-in').set(a)).body as { id: number };
    const wh = await request(app).get('/api/warehouses').set(a);
    const warehouseId = (wh.body.data ?? wh.body)[0].id as number;
    const product = await request(app).post('/api/products').set(a)
      .send({ nameAr: 'صنف اختبار', sku: `T-${stamp}`, costPrice: 5, salePrice: 10 });
    expect(product.status).toBe(201);

    // no stock yet: the answer must be the stock rule, not a missing customer/warehouse
    const res = await request(app).post('/api/sales-invoices').set(a).send({
      customerId: walkIn.id, warehouseId, discount: 0, tax: 0, paymentMethod: 'CASH', paidStatus: 'PAID',
      items: [{ productId: product.body.id, qty: 1, unitPrice: 10 }],
    });
    expect(res.status).not.toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('السجل غير موجود');
  });

  it('the old fixed id does not belong to a new company', async () => {
    const res = await request(app).post('/api/sales-invoices').set(b).send({
      customerId: 3, warehouseId: 1, discount: 0, tax: 0, paymentMethod: 'CASH', paidStatus: 'PAID',
      items: [{ productId: 1, qty: 1, unitPrice: 10 }],
    });
    expect([400, 404]).toContain(res.status);
  });
});
