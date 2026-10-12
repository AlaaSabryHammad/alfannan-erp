/**
 * Moving-average cost keeps 4 decimals, so the inventory account stays within a halala of quantity × cost.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './helpers';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
let h: { Authorization: string };
let warehouseId: number;
let supplierId: number;
let customerId: number;

const api = (m: 'get' | 'post', p: string, b?: object) => {
  const r = request(app)[m](`/api${p}`).set(h);
  return b ? r.send(b) : r;
};
const glBalance = async (code: string) =>
  Number(((await api('get', '/accounts?pageSize=1000')).body.data as Array<{ code: string; currentBalance: string }>)
    .find((a) => a.code === code)!.currentBalance);

beforeAll(async () => {
  _resetThrottle();
  _resetRateLimits();
  process.env.ALLOW_SIGNUP = 'true';
  const res = await request(app).post('/api/auth/register-tenant').send({
    companyName: `شركة التكلفة ${stamp}`, adminName: 'مدير', email: `cost-${stamp}@company.test`,
    password: 'Company-pass-12345', acceptTerms: true,
  });
  expect(res.status).toBe(201);
  h = { Authorization: `Bearer ${res.body.token}` };
  warehouseId = (await api('get', '/warehouses')).body.data[0].id;
  supplierId = (await api('post', '/suppliers', { nameAr: 'مورد' })).body.id;
  customerId = (await api('post', '/customers', { nameAr: 'عميل', creditLimit: 5000 })).body.id;
});

describe('moving-average cost precision', () => {
  it('keeps 4 decimals and the ledger follows quantity × cost', async () => {
    const productId = (await api('post', '/products', { nameAr: 'صنف', sku: `P-${stamp}`, costPrice: 10, salePrice: 30 })).body.id as number;
    const buy = (qty: number, unitCost: number) =>
      api('post', '/purchase-invoices', {
        supplierId, warehouseId, tax: 0, paymentStatus: 'UNPAID', receiveStatus: 'RECEIVED', items: [{ productId, qty, unitCost }],
      });
    expect((await buy(3, 10)).status).toBe(201);
    expect((await buy(4, 11)).status).toBe(201);

    const product = (await api('get', `/products/${productId}`)).body;
    expect(Number(product.costPrice)).toBe(10.5714); // (30 + 44) / 7

    // a sale books COGS at 2 decimals and the account follows
    const inventoryBefore = await glBalance('1200');
    const sale = await api('post', '/sales-invoices', {
      customerId, warehouseId, discount: 0, tax: 0, paymentMethod: 'CASH', paidStatus: 'PAID',
      items: [{ productId, qty: 5, unitPrice: 30 }],
    });
    expect(sale.status).toBe(201);
    const inventoryAfter = await glBalance('1200');
    expect(inventoryBefore - inventoryAfter).toBeCloseTo(52.86, 2); // 5 × 10.5714

    // the inventory account equals what is left at cost, within a halala
    const stock = (await api('get', '/stock/balances?pageSize=1000')).body.data as Array<{ productId: number; quantity: string }>;
    const qty = stock.filter((s) => s.productId === productId).reduce((n, s) => n + Number(s.quantity), 0);
    expect(qty).toBe(2);
    expect(Math.abs(inventoryAfter - qty * 10.5714)).toBeLessThan(0.01);

    const tb = (await api('get', '/reports/trial-balance')).body;
    expect(tb.grandTotalDebit).toBe(tb.grandTotalCredit);
  });
});
