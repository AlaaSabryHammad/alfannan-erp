/**
 * Findings of an external test session: the dashboard's "net sales" must not include VAT.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './helpers';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
let h: { Authorization: string };

const api = (m: 'get' | 'post', p: string, b?: object) => {
  const r = request(app)[m](`/api${p}`).set(h);
  return b ? r.send(b) : r;
};

beforeAll(async () => {
  _resetThrottle();
  _resetRateLimits();
  process.env.ALLOW_SIGNUP = 'true';
  const res = await request(app).post('/api/auth/register-tenant').send({
    companyName: `شركة اللوحة ${stamp}`, adminName: 'مدير', email: `dash-${stamp}@company.test`,
    password: 'Company-pass-12345', acceptTerms: true,
  });
  expect(res.status).toBe(201);
  h = { Authorization: `Bearer ${res.body.token}` };
});

describe('dashboard', () => {
  it('net sales are revenue (before VAT) and profit is computed on them', async () => {
    const warehouseId = (await api('get', '/warehouses')).body.data[0].id;
    const supplierId = (await api('post', '/suppliers', { nameAr: 'مورد' })).body.id;
    const customerId = (await api('post', '/customers', { nameAr: 'عميل' })).body.id;
    const productId = (await api('post', '/products', { nameAr: 'صنف', sku: `D-${stamp}`, costPrice: 30, salePrice: 33 })).body.id;
    await api('post', '/purchase-invoices', {
      supplierId, warehouseId, tax: 0, paymentStatus: 'PAID', receiveStatus: 'RECEIVED',
      items: [{ productId, qty: 10, unitCost: 30 }],
    });
    // 4 × 33 = 132, VAT 15% = 19.80, total 151.80
    const sale = await api('post', '/sales-invoices', {
      customerId, warehouseId, discount: 0, tax: 19.8, paymentMethod: 'CASH', paidStatus: 'PAID',
      items: [{ productId, qty: 4, unitPrice: 33 }],
    });
    expect(sale.status).toBe(201);
    expect(Number(sale.body.total)).toBeCloseTo(151.8, 2);

    const dash = (await api('get', '/dashboard')).body;
    expect(dash.kpis.netSales).toBeCloseTo(132, 2); // not 151.80
    // profit = 132 − cost (4 × 30) = 12, not 151.80 − 120
    expect(dash.kpis.netProfit).toBeCloseTo(12, 2);
    const thisMonth = new Date().getMonth();
    expect(dash.chartSeries.find((p: { sales?: number }, i: number) => i === thisMonth)?.sales).toBeCloseTo(132, 2);
  });
});
