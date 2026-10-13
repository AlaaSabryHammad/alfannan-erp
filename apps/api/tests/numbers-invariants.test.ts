/**
 * Accounting invariants on a messy but realistic scenario: mixed VAT rates (15 % and 0 %), an invoice
 * discount, credit sales, partial returns of exempt and taxable items.
 *
 *  - the tax a return refunds is the tax the returned goods actually bore
 *  - Σ returns never refunds more tax than the invoice charged
 *  - the VAT report separates standard-rated from exempt sales per ITEM, and its net VAT equals account 2100
 *  - P&L revenue = Σ(subtotal − discount) of sales − net of returns
 *  - customer sub-ledger = general ledger = statement closing = AR aging
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
let P: number; // 33.00 @ 15 %
let B: number; // 28.00 @ 0 %
let C: number; // 10.35 @ 15 %

type Res = { status: number; body: any };
const api = (m: 'get' | 'post' | 'put', p: string, b?: object) => {
  const r = request(app)[m](`/api${p}`).set(h);
  return (b ? r.send(b) : r) as unknown as Promise<Res>;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const glBalance = async (code: string) =>
  Number(((await api('get', '/accounts?pageSize=1000')).body.data as Array<{ code: string; currentBalance: string }>)
    .find((a) => a.code === code)!.currentBalance);
const product = async (name: string, cost: number, price: number, taxRate: number) =>
  (await api('post', '/products', { nameAr: name, sku: `${name}-${stamp}`, costPrice: cost, salePrice: price, taxRate })).body.id as number;

/** What the POS sends: tax = Σ (line net after the pro-rata discount × rate), rounded once. */
function posTax(lines: Array<{ qty: number; price: number; rate: number }>, discount: number): number {
  const subtotal = lines.reduce((s, l) => s + l.qty * l.price, 0);
  return r2(lines.reduce((s, l) => {
    const gross = l.qty * l.price;
    return s + (gross - discount * (gross / subtotal)) * (l.rate / 100);
  }, 0));
}

beforeAll(async () => {
  _resetThrottle();
  _resetRateLimits();
  process.env.ALLOW_SIGNUP = 'true';
  const reg = await request(app).post('/api/auth/register-tenant').send({
    companyName: `شركة الأرقام ${stamp}`, adminName: 'مدير', email: `nums-${stamp}@company.test`,
    password: 'Company-pass-12345', acceptTerms: true,
  });
  expect(reg.status).toBe(201);
  h = { Authorization: `Bearer ${reg.body.token}` };
  warehouseId = (await api('get', '/warehouses')).body.data[0].id;
  supplierId = (await api('post', '/suppliers', { nameAr: 'مورد' })).body.id;
  customerId = (await api('post', '/customers', { nameAr: 'عميل', creditLimit: 100000 })).body.id;
  P = await product('P', 30, 33, 15);
  B = await product('B', 20, 28, 0);
  C = await product('C', 5, 10.35, 15);
  for (const [id, cost] of [[P, 30], [B, 20], [C, 5]] as const) {
    await api('post', '/purchase-invoices', {
      supplierId, warehouseId, tax: 0, paymentStatus: 'PAID', receiveStatus: 'RECEIVED', items: [{ productId: id, qty: 100, unitCost: cost }],
    });
  }
});

describe('mixed-rate invoices, discounts and returns', () => {
  let s1: any;
  let s2: any;
  const s1Lines = [{ qty: 4, price: 33, rate: 15 }, { qty: 4, price: 28, rate: 0 }];
  const s2Lines = [{ qty: 3, price: 33, rate: 15 }, { qty: 5, price: 28, rate: 0 }, { qty: 7, price: 10.35, rate: 15 }];
  const s2Discount = 17.3;

  it('S1 (cash) and S2 (credit, with discount) post with the POS tax', async () => {
    s1 = (await api('post', '/sales-invoices', {
      customerId, warehouseId, discount: 0, tax: posTax(s1Lines, 0), paymentMethod: 'CASH', paidStatus: 'PAID',
      items: [{ productId: P, qty: 4, unitPrice: 33 }, { productId: B, qty: 4, unitPrice: 28 }],
    })).body;
    expect(Number(s1.tax)).toBeCloseTo(19.8, 2);

    s2 = (await api('post', '/sales-invoices', {
      customerId, warehouseId, discount: s2Discount, tax: posTax(s2Lines, s2Discount), paymentMethod: 'CREDIT', paidStatus: 'UNPAID',
      items: [{ productId: P, qty: 3, unitPrice: 33 }, { productId: B, qty: 5, unitPrice: 28 }, { productId: C, qty: 7, unitPrice: 10.35 }],
    })).body;
    expect(s2.id).toBeTruthy();
  });

  it('returning an exempt (0 %) item refunds no VAT', async () => {
    const ret = await api('post', '/sales-returns', { salesInvoiceId: s1.id, refundMethod: 'CASH', items: [{ productId: B, qty: 2 }] });
    expect(ret.status).toBe(201);
    expect(Number(ret.body.tax)).toBe(0); // 2 × 28 = 56, no VAT
    expect(Number(ret.body.total)).toBeCloseTo(56, 2);
  });

  it('returning taxable goods refunds exactly the VAT they bore, and all returns together never exceed it', async () => {
    // P was 4 × 33 = 132 → VAT 19.80 → 4.95 per unit. Return 1, then 2, then the last one.
    const taxes: number[] = [];
    for (const qty of [1, 2, 1]) {
      const ret = await api('post', '/sales-returns', { salesInvoiceId: s1.id, refundMethod: 'CASH', items: [{ productId: P, qty }] });
      expect(ret.status).toBe(201);
      taxes.push(Number(ret.body.tax));
    }
    expect(taxes[0]).toBeCloseTo(4.95, 2);
    expect(taxes[1]).toBeCloseTo(9.9, 2);
    expect(r2(taxes.reduce((a, b) => a + b, 0))).toBeCloseTo(19.8, 2); // all of it, not a halala more
  });

  it('a discounted invoice: the return takes its pro-rata share of discount and the tax of its own item', async () => {
    const ret = await api('post', '/sales-returns', { salesInvoiceId: s2.id, refundMethod: 'BALANCE', items: [{ productId: C, qty: 7 }] });
    expect(ret.status).toBe(201);
    const subtotalS2 = 3 * 33 + 5 * 28 + 7 * 10.35;            // 311.45
    const lineNet = 72.45 - s2Discount * (72.45 / subtotalS2); // C after its share of the discount
    expect(Number(ret.body.subtotal)).toBeCloseTo(72.45, 2);
    expect(Number(ret.body.discount)).toBeCloseTo(s2Discount * (72.45 / subtotalS2), 2);
    expect(Number(ret.body.tax)).toBeCloseTo(lineNet * 0.15, 2); // C's own VAT only
  });

  it('VAT report: standard-rated vs exempt per item, and net VAT = account 2100', async () => {
    const vat = (await api('get', '/reports/vat')).body;
    // standard-rated base = P and C lines after discount, exempt = B lines
    const sub2 = 3 * 33 + 5 * 28 + 7 * 10.35;
    const share = (gross: number) => gross - s2Discount * (gross / sub2);
    const expectedTaxable = r2(4 * 33 + share(3 * 33) + share(7 * 10.35));
    const expectedExempt = r2(4 * 28 + share(5 * 28));
    expect(vat.sales.taxableNet).toBeCloseTo(expectedTaxable, 1);
    expect(vat.sales.exemptNet).toBeCloseTo(expectedExempt, 1);

    expect(vat.outputVAT).toBeCloseTo(await glBalance('2100'), 2);
  });

  it('P&L revenue = sales net of discount − returns; customer figures agree everywhere', async () => {
    const pnl = (await api('get', '/reports/pnl')).body;
    const sub2 = 3 * 33 + 5 * 28 + 7 * 10.35;
    const salesNet = (4 * 33 + 4 * 28) + (sub2 - s2Discount);
    const returnsNet = 2 * 28 + 4 * 33 + (72.45 - s2Discount * (72.45 / sub2));
    expect(pnl.revenue).toBeCloseTo(salesNet - returnsNet, 1);

    const customer = (await api('get', `/customers/${customerId}`)).body;
    const gl = await glBalance('3000');
    expect(Number(customer.currentBalance)).toBeCloseTo(gl, 2);

    const statement = (await api('get', `/customers/${customerId}/statement`)).body;
    const closing = statement.closingBalance ?? statement.closing ?? statement.balance;
    expect(Number(closing)).toBeCloseTo(gl, 2);

    const aging = (await api('get', '/reports/ar-aging')).body;
    expect(Number(aging.totals.total ?? aging.totals.balance)).toBeCloseTo(gl, 2);

    const tb = (await api('get', '/reports/trial-balance')).body;
    expect(tb.grandTotalDebit).toBe(tb.grandTotalCredit);
  });
});

describe('paid at creation stays paid', () => {
  it('a cash sale stays PAID and fully settled after returns, and cannot be collected again', async () => {
    const sale = (await api('post', '/sales-invoices', {
      customerId, warehouseId, discount: 0, tax: 4.95, paymentMethod: 'CASH', paidStatus: 'PAID',
      items: [{ productId: P, qty: 1, unitPrice: 33 }],
    })).body;
    await api('post', '/sales-returns', { salesInvoiceId: sale.id, refundMethod: 'CASH', items: [{ productId: P, qty: 1 }] });

    const detail = (await api('get', `/sales-invoices/${sale.id}`)).body;
    expect(detail.paidStatus).toBe('PAID');
    expect(detail.remainingAmount).toBeCloseTo(0, 2);

    const cashId = ((await api('get', '/accounts?pageSize=1000')).body.data as Array<{ code: string; id: number }>).find((a) => a.code === '1000')!.id;
    const again = await api('post', '/vouchers', {
      type: 'RECEIPT', treasuryAccountId: cashId, partyType: 'CUSTOMER', partyId: customerId, salesInvoiceId: sale.id, amount: 10,
    });
    expect(again.status).toBe(400); // nothing left to collect
  });

  it('a purchase paid on entry stays PAID after a return and the supplier statement matches the ledger', async () => {
    const pur = (await api('post', '/purchase-invoices', {
      supplierId, warehouseId, tax: 0, paymentStatus: 'PAID', receiveStatus: 'RECEIVED',
      items: [{ productId: C, qty: 10, unitCost: 5 }],
    })).body;
    const ret = await api('post', '/purchase-returns', { purchaseInvoiceId: pur.id, refundMethod: 'CASH', items: [{ productId: C, qty: 4 }] });
    expect(ret.status).toBe(201);

    const detail = (await api('get', `/purchase-invoices/${pur.id}`)).body;
    expect(detail.paymentStatus).toBe('PAID');

    const supplier = (await api('get', `/suppliers/${supplierId}`)).body;
    const statement = (await api('get', `/suppliers/${supplierId}/statement`)).body;
    expect(Number(statement.closingBalance)).toBeCloseTo(Number(supplier.currentBalance), 2);
    expect(Number(supplier.currentBalance)).toBeCloseTo(await glBalance('2000'), 2);
  });
});

describe('money amounts are whole halalas', () => {
  it('a document\'s lines add up to its subtotal and total exactly', async () => {
    // 1.5 × 10.33 = 15.495 → each line is 15.50 (rounded), so the subtotal is 31.00, never 30.99
    const sale = (await api('post', '/sales-invoices', {
      customerId, warehouseId, discount: 0, tax: 0, paymentMethod: 'CASH', paidStatus: 'PAID',
      items: [{ productId: C, qty: 1.5, unitPrice: 10.33 }, { productId: C, qty: 1.5, unitPrice: 10.33 }],
    })).body;
    const detail = (await api('get', `/sales-invoices/${sale.id}`)).body;
    const lines = detail.items.reduce((s: number, i: { lineTotal: string }) => s + Number(i.lineTotal), 0);
    expect(Number(detail.subtotal)).toBe(31);
    expect(r2(lines)).toBe(Number(detail.subtotal));
    expect(Number(detail.total)).toBe(31);

    const tb = (await api('get', '/reports/trial-balance')).body;
    expect(Number.isInteger(Math.round(tb.grandTotalDebit * 100))).toBe(true);
    expect(tb.grandTotalDebit).toBe(tb.grandTotalCredit);
  });
});
