/**
 * The statement day itself is part of the statement: entries posted that day (they carry a time of day)
 * must be offered for matching.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './helpers';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
let h: { Authorization: string };

const api = (m: 'get' | 'post' | 'put', p: string, b?: object) => {
  const r = request(app)[m](`/api${p}`).set(h);
  return b ? r.send(b) : r;
};

beforeAll(async () => {
  _resetThrottle();
  _resetRateLimits();
  process.env.ALLOW_SIGNUP = 'true';
  const res = await request(app).post('/api/auth/register-tenant').send({
    companyName: `شركة البنك ${stamp}`, adminName: 'مدير', email: `bank-${stamp}@company.test`,
    password: 'Company-pass-12345', acceptTerms: true,
  });
  expect(res.status).toBe(201);
  h = { Authorization: `Bearer ${res.body.token}` };
});

describe('bank reconciliation — statement day', () => {
  it('offers, matches and completes entries posted on the statement date', async () => {
    const warehouseId = (await api('get', '/warehouses')).body.data[0].id;
    const supplierId = (await api('post', '/suppliers', { nameAr: 'مورد' })).body.id;
    const customerId = (await api('post', '/customers', { nameAr: 'عميل' })).body.id;
    const productId = (await api('post', '/products', { nameAr: 'صنف', sku: `B-${stamp}`, costPrice: 10, salePrice: 100 })).body.id;
    await api('post', '/purchase-invoices', {
      supplierId, warehouseId, tax: 0, paymentStatus: 'UNPAID', receiveStatus: 'RECEIVED', items: [{ productId, qty: 5, unitCost: 10 }],
    });
    // a card sale posts to the bank account (1100) with the current time of day
    const sale = await api('post', '/sales-invoices', {
      customerId, warehouseId, discount: 0, tax: 0, paymentMethod: 'CARD', paidStatus: 'PAID',
      items: [{ productId, qty: 2, unitPrice: 100 }],
    });
    expect(sale.status).toBe(201);

    const bank = ((await api('get', '/accounts?pageSize=1000')).body.data as Array<{ code: string; id: number }>).find((a) => a.code === '1100')!;
    const today = new Date().toISOString().slice(0, 10);
    const recon = await api('post', '/bank-reconciliations', { accountId: bank.id, statementDate: today, statementBalance: 200 });
    expect(recon.status).toBe(201);

    const candidates = (await api('get', `/bank-reconciliations/${recon.body.id}/unreconciled`)).body as Array<{ id: number; debit: number }>;
    expect(candidates.length).toBe(1);
    expect(candidates[0].debit).toBe(200);

    const save = await api('put', `/bank-reconciliations/${recon.body.id}/lines`, { journalLineIds: [candidates[0].id] });
    expect(save.status).toBe(200);
    expect(save.body.differencePreview).toBe(0);

    const done = await api('post', `/bank-reconciliations/${recon.body.id}/complete`);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('COMPLETED');
    expect(Number(done.body.difference)).toBe(0);
  });
});
