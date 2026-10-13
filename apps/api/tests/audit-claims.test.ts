/**
 * Findings of the second review, each reproduced and fixed:
 * inclusive report ranges, voucher rules, role escalation, notification permission, ledger sign
 * normalisation, discount ceilings, purchase-return valuation, subscription reads, stock locks.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import { app } from './helpers';
import { platformPrisma } from '../src/lib/platformPrisma';
import { postJournalEntry } from '../src/lib/ledger';
import { runWithTenant } from '../src/lib/tenantContext';
import prisma from '../src/lib/prisma';
import { endOfDay } from '../src/lib/dateRange';
import { _resetRateLimits } from '../src/middleware/rateLimit';
import { _resetThrottle } from '../src/lib/loginThrottle';

const stamp = Date.now();
let h: { Authorization: string };
let tenantId: number;
let warehouseId: number;
let supplierId: number;
let customerId: number;
let cashId: number;

type Res = { status: number; body: any };
const api = (m: 'get' | 'post' | 'put' | 'delete', p: string, b?: object, headers = h) => {
  const r = request(app)[m](`/api${p}`).set(headers);
  return (b ? r.send(b) : r) as unknown as Promise<Res>;
};
const accounts = async () =>
  (await api('get', '/accounts?pageSize=1000')).body.data as Array<{ id: number; code: string; currentBalance: string }>;
const balance = async (code: string) => Number((await accounts()).find((a) => a.code === code)!.currentBalance);
const product = async (name: string, cost: number) =>
  (await api('post', '/products', { nameAr: name, sku: `${name}-${stamp}`, costPrice: cost, salePrice: cost * 2 })).body.id as number;
const buy = (productId: number, qty: number, unitCost: number, extra: object = {}) =>
  api('post', '/purchase-invoices', {
    supplierId, warehouseId, tax: 0, paymentStatus: 'UNPAID', receiveStatus: 'RECEIVED',
    items: [{ productId, qty, unitCost }], ...extra,
  });
const sell = (productId: number, qty: number, price: number, extra: object = {}) =>
  api('post', '/sales-invoices', {
    customerId, warehouseId, discount: 0, tax: 0, paymentMethod: 'CASH', paidStatus: 'PAID',
    items: [{ productId, qty, unitPrice: price }], ...extra,
  });

beforeAll(async () => {
  _resetThrottle();
  _resetRateLimits();
  process.env.ALLOW_SIGNUP = 'true';
  const reg = await request(app).post('/api/auth/register-tenant').send({
    companyName: `شركة المراجعة ${stamp}`, adminName: 'مدير', email: `claims-${stamp}@company.test`,
    password: 'Company-pass-12345', acceptTerms: true,
  });
  expect(reg.status).toBe(201);
  h = { Authorization: `Bearer ${reg.body.token}` };
  tenantId = JSON.parse(Buffer.from(reg.body.token.split('.')[1], 'base64url').toString()).tenantId;
  warehouseId = (await api('get', '/warehouses')).body.data[0].id;
  supplierId = (await api('post', '/suppliers', { nameAr: 'مورد' })).body.id;
  customerId = (await api('post', '/customers', { nameAr: 'عميل', creditLimit: 100000 })).body.id;
  cashId = (await accounts()).find((a) => a.code === '1000')!.id;
});

describe('report date ranges include the last day', () => {
  it('endOfDay: a calendar day means its end, a timestamp is kept', () => {
    expect(endOfDay('2026-10-12').toISOString()).toBe('2026-10-12T23:59:59.999Z');
    expect(endOfDay('2026-10-12T10:00:00.000Z').toISOString()).toBe('2026-10-12T10:00:00.000Z');
  });

  it('sales-log and the account ledger return an invoice posted later on the "to" day', async () => {
    const p = await product('تقرير', 10);
    await buy(p, 5, 10);
    expect((await sell(p, 1, 20)).status).toBe(201);
    const today = new Date().toISOString().slice(0, 10);

    const log = await api('get', `/reports/sales-log?from=${today}&to=${today}`);
    expect(log.status).toBe(200);
    expect(log.body.summary.count).toBeGreaterThanOrEqual(1);

    const ledger = await api('get', `/accounts/${cashId}/ledger?from=${today}&to=${today}`);
    expect(ledger.status).toBe(200);
    expect(ledger.body.lines.length).toBeGreaterThanOrEqual(1);
  });
});

describe('vouchers', () => {
  it('cannot be linked to a sales and a purchase invoice at once', async () => {
    const p = await product('سند-أ', 10);
    const pur = (await buy(p, 2, 10)).body;
    const sale = (await sell(p, 1, 30, { paymentMethod: 'CREDIT', paidStatus: 'UNPAID' })).body;
    const res = await api('post', '/vouchers', {
      type: 'RECEIPT', treasuryAccountId: cashId, partyType: 'CUSTOMER', partyId: customerId,
      salesInvoiceId: sale.id, purchaseInvoiceId: pur.id, amount: 10,
    });
    expect(res.status).toBe(400);
  });

  it('compound mode is checked against what is still owed', async () => {
    const p = await product('سند-ب', 10);
    await buy(p, 3, 10);
    const sale = (await sell(p, 1, 30, { paymentMethod: 'CREDIT', paidStatus: 'UNPAID' })).body;
    const arId = (await accounts()).find((a) => a.code === '3000')!.id;
    const over = await api('post', '/vouchers', {
      type: 'RECEIPT', treasuryAccountId: cashId, partyType: 'CUSTOMER', partyId: customerId,
      salesInvoiceId: sale.id, lines: [{ accountId: arId, amount: 999 }],
    });
    expect(over.status).toBe(400);
    expect(over.body.error).toContain('أكبر من المتبقي');
  });

  it('a sales invoice takes a receipt, from its own customer, not a payment', async () => {
    const p = await product('سند-ج', 10);
    await buy(p, 3, 10);
    const sale = (await sell(p, 1, 30, { paymentMethod: 'CREDIT', paidStatus: 'UNPAID' })).body;
    const other = (await api('post', '/customers', { nameAr: 'عميل آخر' })).body.id;

    const wrongType = await api('post', '/vouchers', {
      type: 'PAYMENT', treasuryAccountId: cashId, partyType: 'SUPPLIER', partyId: supplierId, salesInvoiceId: sale.id, amount: 5,
    });
    expect(wrongType.status).toBe(400);

    const wrongParty = await api('post', '/vouchers', {
      type: 'RECEIPT', treasuryAccountId: cashId, partyType: 'CUSTOMER', partyId: other, salesInvoiceId: sale.id, amount: 5,
    });
    expect(wrongParty.status).toBe(400);

    const ok = await api('post', '/vouchers', {
      type: 'RECEIPT', treasuryAccountId: cashId, partyType: 'CUSTOMER', partyId: customerId, salesInvoiceId: sale.id, amount: 5,
    });
    expect(ok.status).toBe(201);
  });
});

describe('roles', () => {
  it('nobody can grant a permission they do not hold', async () => {
    // a manager-like role with roles.edit but without treasury.delete
    const role = await platformPrisma.role.create({
      data: { tenantId, code: `LIMITED_${stamp}`, nameAr: 'محدود', description: 'test' },
    });
    const perms = await platformPrisma.permission.findMany({ where: { code: { in: ['roles.edit', 'roles.view', 'users.view'] } } });
    for (const p of perms) await platformPrisma.rolePermission.create({ data: { roleId: role.id, permissionId: p.id } });
    const email = `limited-${stamp}@company.test`;
    await platformPrisma.user.create({
      data: { tenantId, name: 'محدود', email, passwordHash: await bcrypt.hash('Limited-pass-12345', 4), roleId: role.id },
    });
    const login = await request(app).post('/api/auth/login').send({ email, password: 'Limited-pass-12345' });
    expect(login.status).toBe(200);
    const limited = { Authorization: `Bearer ${login.body.token}` };

    const grabAll = await api('put', `/roles/${role.id}/permissions`, { permissionCodes: ['roles.edit', 'treasury.delete', 'settings.edit'] }, limited);
    expect(grabAll.status).toBe(403);

    const keep = await api('put', `/roles/${role.id}/permissions`, { permissionCodes: ['roles.edit', 'roles.view'] }, limited);
    expect(keep.status).toBe(200);

    // the company admin holds everything and can still grant it
    const admin = await api('put', `/roles/${role.id}/permissions`, { permissionCodes: ['roles.edit', 'roles.view', 'treasury.delete'] });
    expect(admin.status).toBe(200);
  });
});

describe('notifications', () => {
  it('generic WhatsApp / SMS need settings.edit', async () => {
    const role = await platformPrisma.role.create({ data: { tenantId, code: `CASH_${stamp}`, nameAr: 'كاشير', description: 'test' } });
    const perm = await platformPrisma.permission.findFirstOrThrow({ where: { code: 'sales.view' } });
    await platformPrisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    const email = `cash-${stamp}@company.test`;
    await platformPrisma.user.create({
      data: { tenantId, name: 'كاشير', email, passwordHash: await bcrypt.hash('Cashier-pass-12345', 4), roleId: role.id },
    });
    const token = (await request(app).post('/api/auth/login').send({ email, password: 'Cashier-pass-12345' })).body.token;
    const asCashier = { Authorization: `Bearer ${token}` };

    expect((await api('post', '/notifications/whatsapp', { to: '966500000000', message: 'x' }, asCashier)).status).toBe(403);
    expect((await api('post', '/notifications/sms', { to: '966500000000', message: 'x' }, asCashier)).status).toBe(403);
    // the admin passes the permission wall (the gateway itself is not configured in tests → 400, not 403)
    expect((await api('post', '/notifications/sms', { to: '966500000000', message: 'x' })).status).not.toBe(403);
  });
});

describe('ledger', () => {
  it('stores one-sided, non-negative lines whatever the caller passes', async () => {
    const accs = await accounts();
    const cash = accs.find((a) => a.code === '1000')!.id;
    const expense = accs.find((a) => a.code === '6000')!.id;
    const entry = await runWithTenant(tenantId, () =>
      prisma.$transaction(async (tx) =>
        postJournalEntry(tx, {
          date: new Date(),
          description: 'تطبيع الإشارات',
          sourceType: 'MANUAL' as never,
          sourceId: null,
          lines: [
            { accountId: expense, debit: 100, credit: 40 }, // two-sided → net debit 60
            { accountId: cash, debit: -60, credit: 0 },       // negative debit → credit 60
          ],
        }),
      ),
    );
    const lines = await platformPrisma.journalLine.findMany({ where: { entryId: entry.id }, orderBy: { id: 'asc' } });
    expect(lines.map((l) => [Number(l.debit), Number(l.credit)])).toEqual([[60, 0], [0, 60]]);
  });
});

describe('discount ceilings', () => {
  it('a sale or a purchase cannot discount more than the subtotal', async () => {
    const p = await product('خصم', 10);
    await buy(p, 5, 10);
    // tax large enough to hide an over-discount from the old "total < 0" check
    const sale = await sell(p, 1, 100, { discount: 150, tax: 100 });
    expect(sale.status).toBe(400);
    const pur = await buy(p, 1, 10, { discount: 11 });
    expect(pur.status).toBe(400);
  });
});

describe('purchase return valuation', () => {
  it('inventory leaves at the moving average and the variance goes to COGS', async () => {
    const p = await product('مرتجع', 10);
    const first = (await buy(p, 10, 10)).body;      // 10 @ 10
    await buy(p, 10, 20);                            // 10 @ 20 → average 15
    const inventory0 = await balance('1200');
    const cogs0 = await balance('5000');
    const ap0 = await balance('2000');

    const ret = await api('post', '/purchase-returns', {
      purchaseInvoiceId: first.id, refundMethod: 'BALANCE', items: [{ productId: p, qty: 5 }],
    });
    expect(ret.status).toBe(201);

    expect(inventory0 - (await balance('1200'))).toBeCloseTo(75, 2); // 5 × 15 (average), not 5 × 10
    expect(ap0 - (await balance('2000'))).toBeCloseTo(50, 2);         // the supplier credits 5 × 10
    expect((await balance('5000')) - cogs0).toBeCloseTo(25, 2);       // variance 75 − 50

    const stock = (await api('get', '/stock/balances?pageSize=1000')).body.data as Array<{ productId: number; quantity: string }>;
    const qty = stock.filter((s) => s.productId === p).reduce((n, s) => n + Number(s.quantity), 0);
    const cost = Number((await api('get', `/products/${p}`)).body.costPrice);
    expect(qty).toBe(15);
    expect(cost).toBe(15);
  });
});

describe('subscription reads', () => {
  it('payments and upgrade requests need settings.view', async () => {
    const role = await platformPrisma.role.findFirstOrThrow({ where: { tenantId, code: `CASH_${stamp}` } });
    void role;
    const token = (await request(app).post('/api/auth/login')
      .send({ email: `cash-${stamp}@company.test`, password: 'Cashier-pass-12345' })).body.token;
    const asCashier = { Authorization: `Bearer ${token}` };
    expect((await api('get', '/subscription/payments', undefined, asCashier)).status).toBe(403);
    expect((await api('get', '/subscription/upgrade-requests', undefined, asCashier)).status).toBe(403);
    expect((await api('get', '/subscription/payments')).status).toBe(200);
  });
});

describe('stock decisions are serialised', () => {
  it('two simultaneous sales of the last units cannot both succeed', async () => {
    const p = await product('تزامن', 10);
    await buy(p, 3, 10);
    const results = await Promise.all([sell(p, 2, 30), sell(p, 2, 30)]);
    const ok = results.filter((r) => r.status === 201).length;
    expect(ok).toBe(1);
    const stock = (await api('get', '/stock/balances?pageSize=1000')).body.data as Array<{ productId: number; quantity: string }>;
    expect(stock.filter((s) => s.productId === p).reduce((n, s) => n + Number(s.quantity), 0)).toBe(1);
  });
});
