/**
 * Findings of the end-to-end audit: manufacturing cost, stock adjustments in the ledger, executing a
 * pending transfer, and double settlement of a promissory note.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app } from './helpers';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
let h: { Authorization: string };
let warehouseId: number;
let secondWarehouseId: number;
let supplierId: number;
let customerId: number;
let cashAccountId: number;

const api = (m: 'get' | 'post' | 'put', p: string, b?: object) => {
  const r = request(app)[m](`/api${p}`).set(h);
  return b ? r.send(b) : r;
};
const accountBalance = async (code: string) => {
  const list = (await api('get', '/accounts?pageSize=1000')).body.data as Array<{ code: string; currentBalance: string }>;
  return Number(list.find((a) => a.code === code)!.currentBalance);
};
const stockOf = async (productId: number, wid?: number) => {
  const rows = (await api('get', '/stock/balances?pageSize=1000')).body.data as Array<{ productId: number; warehouseId: number; quantity: string }>;
  return rows.filter((r) => r.productId === productId && (wid === undefined || r.warehouseId === wid))
    .reduce((n, r) => n + Number(r.quantity), 0);
};
const makeProduct = async (name: string, cost: number) =>
  (await api('post', '/products', { nameAr: name, sku: `${name}-${stamp}`, costPrice: cost, salePrice: cost * 2 })).body.id as number;
const buy = (productId: number, qty: number, unitCost: number) =>
  api('post', '/purchase-invoices', {
    supplierId, warehouseId, tax: 0, paymentStatus: 'UNPAID', receiveStatus: 'RECEIVED', items: [{ productId, qty, unitCost }],
  });

beforeAll(async () => {
  _resetThrottle();
  _resetRateLimits();
  process.env.ALLOW_SIGNUP = 'true';
  const res = await request(app).post('/api/auth/register-tenant').send({
    companyName: `شركة التدقيق ${stamp}`, adminName: 'مدير', email: `audit-${stamp}@company.test`,
    password: 'Company-pass-12345', acceptTerms: true,
  });
  expect(res.status).toBe(201);
  h = { Authorization: `Bearer ${res.body.token}` };
  warehouseId = (await api('get', '/warehouses')).body.data[0].id;
  secondWarehouseId = (await api('post', '/warehouses', { nameAr: 'مستودع ثانٍ' })).body.id;
  supplierId = (await api('post', '/suppliers', { nameAr: 'مورد' })).body.id;
  customerId = (await api('post', '/customers', { nameAr: 'عميل', creditLimit: 1000 })).body.id;
  cashAccountId = ((await api('get', '/accounts?pageSize=1000')).body.data as Array<{ code: string; id: number }>)
    .find((a) => a.code === '1000')!.id;
});

describe('manufacturing', () => {
  it('the finished product takes the cost of the components consumed', async () => {
    const a = await makeProduct('مكوّن-أ', 10);
    const b = await makeProduct('مكوّن-ب', 5);
    const f = await makeProduct('تام', 1);
    expect((await buy(a, 100, 10)).status).toBe(201);
    expect((await buy(b, 100, 5)).status).toBe(201);

    const bom = await api('post', '/bom', { productId: f, lines: [{ componentId: a, qtyPerUnit: 2 }, { componentId: b, qtyPerUnit: 1 }] });
    expect(bom.status).toBe(201);
    const wo = await api('post', '/work-orders', { bomId: bom.body.id, warehouseId, qty: 10 });
    expect(wo.status).toBe(201);
    const inventoryBefore = await accountBalance('1200');
    expect((await api('post', `/work-orders/${wo.body.id}/post`)).status).toBe(200);

    const product = (await api('get', `/products/${f}`)).body;
    expect(Number(product.costPrice)).toBe(25); // 2 × 10 + 1 × 5
    expect(await stockOf(f)).toBe(10);
    expect(await stockOf(a)).toBe(80);
    // value moved between products: the inventory account does not change
    expect(await accountBalance('1200')).toBe(inventoryBefore);
  });
});

describe('stock adjustments reach the ledger', () => {
  it('a stock count shortage is booked against COGS', async () => {
    const p = await makeProduct('جرد', 20);
    await buy(p, 50, 20);
    const inventory0 = await accountBalance('1200');
    const cogs0 = await accountBalance('5000');

    const sc = await api('post', '/stock-counts', { warehouseId });
    await api('put', `/stock-counts/${sc.body.id}/lines`, { productId: p, countedQty: 47 });
    expect((await api('post', `/stock-counts/${sc.body.id}/post`)).status).toBe(200);

    expect(await stockOf(p, warehouseId)).toBe(47);
    expect(await accountBalance('1200')).toBe(inventory0 - 60); // 3 units × 20
    expect(await accountBalance('5000')).toBe(cogs0 + 60);
  });

  it('a manual adjustment books the difference and the movement records the change, not the balance', async () => {
    const p = await makeProduct('تسوية', 10);
    await buy(p, 20, 10);
    const inventory0 = await accountBalance('1200');

    const up = await api('post', '/stock/adjust', { productId: p, warehouseId, quantity: 25, reason: 'زيادة' });
    expect(up.status).toBe(200);
    expect(Number(up.body.movement.quantity)).toBe(5); // 25 − 20
    expect(await accountBalance('1200')).toBe(inventory0 + 50);

    const tb = (await api('get', '/reports/trial-balance')).body;
    expect(tb.grandTotalDebit).toBe(tb.grandTotalCredit);
  });
});

describe('stock transfers', () => {
  it('a pending transfer moves nothing until it is executed, then moves once', async () => {
    const p = await makeProduct('تحويل', 10);
    await buy(p, 30, 10);

    const tr = await api('post', '/stock-transfers', {
      fromWarehouseId: warehouseId, toWarehouseId: secondWarehouseId, items: [{ productId: p, qty: 12 }],
    });
    expect(tr.status).toBe(201);
    expect(tr.body.status).toBe('PENDING');
    expect(await stockOf(p, secondWarehouseId)).toBe(0);

    const done = await api('post', `/stock-transfers/${tr.body.id}/complete`);
    expect(done.status).toBe(200);
    expect(done.body.status).toBe('DONE');
    expect(await stockOf(p, warehouseId)).toBe(18);
    expect(await stockOf(p, secondWarehouseId)).toBe(12);

    expect((await api('post', `/stock-transfers/${tr.body.id}/complete`)).status).toBe(400);
    expect(await stockOf(p)).toBe(30);
  });

  it('refuses to execute a transfer the source cannot cover', async () => {
    const p = await makeProduct('تحويل-كبير', 10);
    await buy(p, 5, 10);
    const tr = await api('post', '/stock-transfers', {
      fromWarehouseId: warehouseId, toWarehouseId: secondWarehouseId, items: [{ productId: p, qty: 50 }],
    });
    expect(tr.status).toBe(201);
    const done = await api('post', `/stock-transfers/${tr.body.id}/complete`);
    expect(done.status).toBe(400);
    expect(await stockOf(p, warehouseId)).toBe(5);
    // still pending, can be retried later
    const again = (await api('get', `/stock-transfers/${tr.body.id}`)).body;
    expect(again.status).toBe('PENDING');
  });
});

describe('promissory notes', () => {
  it('settling twice answers 400, not 500, and posts once', async () => {
    const note = await api('post', '/promissory-notes', {
      type: 'RECEIVABLE', partyType: 'CUSTOMER', partyId: customerId, amount: 100,
      dueDate: new Date(Date.now() + 30 * 864e5).toISOString(),
    });
    expect(note.status).toBe(201);
    const cash0 = await accountBalance('1000');
    const first = await api('post', `/promissory-notes/${note.body.id}/settle`, { treasuryAccountId: cashAccountId });
    expect(first.status).toBe(200);
    const second = await api('post', `/promissory-notes/${note.body.id}/settle`, { treasuryAccountId: cashAccountId });
    expect(second.status).toBe(400);
    expect(await accountBalance('1000')).toBe(cash0 + 100);
  });
});
