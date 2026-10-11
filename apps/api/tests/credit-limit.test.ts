/**
 * الحد الائتماني: 0 = بيع نقدي فقط (لا فاتورة آجلة أو جزئية)، والحد الموجب يُفرض على
 * الرصيد + الفاتورة. التنبيهات تعدّ العميل المدين بحد 0 كمتجاوز.
 */
import { describe, it, expect } from 'vitest';
import { api, prisma, fixtures, forceDeleteSalesInvoiceForTest } from './helpers';

async function newCustomer(creditLimit: number, currentBalance = 0) {
  return prisma.customer.create({
    data: { nameAr: `عميل اختبار الائتمان ${Date.now()}-${Math.floor(Math.random() * 1e4)}`, creditLimit, currentBalance },
  });
}

function invoiceBody(customerId: number, warehouseId: number, productId: number, extra: object = {}) {
  return {
    customerId, warehouseId,
    items: [{ productId, qty: 1, unitPrice: 100 }],
    ...extra,
  };
}

describe('credit limit enforcement', () => {
  it('rejects a credit invoice for a cash-only customer (limit 0)', async () => {
    const { warehouse, product } = await fixtures();
    const cust = await newCustomer(0);
    const res = await api('post', '/sales-invoices', invoiceBody(cust.id, warehouse.id, product.id, { paymentMethod: 'CREDIT', paidStatus: 'UNPAID' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('بيع نقدي فقط');
  });

  it('rejects a part-paid invoice for a cash-only customer', async () => {
    const { warehouse, product } = await fixtures();
    const cust = await newCustomer(0);
    const res = await api('post', '/sales-invoices', invoiceBody(cust.id, warehouse.id, product.id, { paymentMethod: 'CASH', paidStatus: 'PARTIAL' }));
    expect(res.status).toBe(400);
  });

  it('still allows a fully paid cash invoice for a cash-only customer', async () => {
    const { warehouse, product } = await fixtures();
    const cust = await newCustomer(0);
    const res = await api('post', '/sales-invoices', invoiceBody(cust.id, warehouse.id, product.id, { paymentMethod: 'CASH', paidStatus: 'PAID' }));
    expect(res.status).toBe(201);
    await forceDeleteSalesInvoiceForTest(res.body.id);
  });

  it('enforces a positive limit against balance + invoice', async () => {
    const { warehouse, product } = await fixtures();
    const cust = await newCustomer(150, 100);
    // 100 existing + 100 new = 200 > 150
    const over = await api('post', '/sales-invoices', invoiceBody(cust.id, warehouse.id, product.id, { paymentMethod: 'CREDIT', paidStatus: 'UNPAID' }));
    expect(over.status).toBe(400);
    expect(over.body.error).toContain('يتجاوز الحد المسموح');

    // raise the limit → the same invoice is accepted
    await prisma.customer.update({ where: { id: cust.id }, data: { creditLimit: 1000 } });
    const ok = await api('post', '/sales-invoices', invoiceBody(cust.id, warehouse.id, product.id, { paymentMethod: 'CREDIT', paidStatus: 'UNPAID' }));
    expect(ok.status).toBe(201);
    await forceDeleteSalesInvoiceForTest(ok.body.id);
  });
});

describe('over-limit alerts', () => {
  it('counts a customer with a balance and limit 0 as over limit', async () => {
    const before = (await api('get', '/alerts/summary')).body.overLimitCustomersCount as number;
    const cust = await newCustomer(0, 500);
    const after = (await api('get', '/alerts/summary')).body.overLimitCustomersCount as number;
    expect(after).toBe(before + 1);

    await prisma.customer.update({ where: { id: cust.id }, data: { currentBalance: 0 } });
    const cleared = (await api('get', '/alerts/summary')).body.overLimitCustomersCount as number;
    expect(cleared).toBe(before);
  });
});
