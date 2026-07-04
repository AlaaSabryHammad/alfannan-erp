/**
 * خط الأنابيب: عرض سعر → أمر بيع → فاتورة، وأمر شراء → فاتورة، مع حواجز التزامن.
 */
import { describe, it, expect } from 'vitest';
import { api, prisma, fixtures, expectLedgerInvariants, forceDeleteSalesInvoiceForTest } from './helpers';

describe('quotation → order → invoice pipeline', () => {
  it('runs the full sales pipeline with no stock effect before fulfillment', async () => {
    const { customer, warehouse, product } = await fixtures();
    const stockBefore = Number((await prisma.stockBalance.findUniqueOrThrow({
      where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
    })).quantity);

    const q = await api('post', '/quotations', {
      customerId: customer.id, tax: 30,
      items: [{ productId: product.id, qty: 2, unitPrice: 100 }],
    });
    expect(q.status).toBe(201);
    expect(Number(q.body.total)).toBeCloseTo(230, 2);

    await api('post', `/quotations/${q.body.id}/status`, { status: 'ACCEPTED' });
    const conv = await api('post', `/quotations/${q.body.id}/convert`, { warehouseId: warehouse.id });
    expect(conv.status).toBe(201);
    expect((await api('post', `/quotations/${q.body.id}/convert`, { warehouseId: warehouse.id })).status).toBe(400);

    // pre-documents never move stock
    const stockMid = Number((await prisma.stockBalance.findUniqueOrThrow({
      where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
    })).quantity);
    expect(stockMid).toBeCloseTo(stockBefore, 2);

    const ful = await api('post', `/sales-orders/${conv.body.id}/fulfill`, { paymentMethod: 'CASH', paidStatus: 'PAID' });
    expect(ful.status).toBe(200);
    expect(ful.body.invoiceRefNo).toMatch(/^INV-/);
    expect((await api('post', `/sales-orders/${conv.body.id}/fulfill`, {})).status).toBe(400); // once only

    const inv = await prisma.salesInvoice.findUniqueOrThrow({ where: { id: ful.body.invoiceId } });
    expect(Number(inv.total)).toBeCloseTo(230, 2);

    // fulfilled orders and converted quotations are permanent
    expect((await api('delete', `/sales-orders/${conv.body.id}`)).status).toBe(400);
    expect((await api('delete', `/quotations/${q.body.id}`)).status).toBe(400);

    await expectLedgerInvariants();

    // cleanup (invoice reversal restores stock; prisma removes pre-documents)
    await forceDeleteSalesInvoiceForTest(ful.body.invoiceId);
    await prisma.salesOrder.delete({ where: { id: conv.body.id } });
    await prisma.quotation.delete({ where: { id: q.body.id } });
    const stockEnd = Number((await prisma.stockBalance.findUniqueOrThrow({
      where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
    })).quantity);
    expect(stockEnd).toBeCloseTo(stockBefore, 2);
  });

  it('converts a purchase order into a received invoice with prorated totals', async () => {
    const { supplier, warehouse, product } = await fixtures();
    const po = await api('post', '/purchase-orders', {
      supplierId: supplier.id, warehouseId: warehouse.id, discount: 10, tax: 15,
      items: [{ productId: product.id, qty: 3, unitCost: 40 }],
    });
    expect(po.status).toBe(201);
    expect(Number(po.body.total)).toBeCloseTo(125, 2); // 120 − 10 + 15

    const conv = await api('post', `/purchase-orders/${po.body.id}/convert`, { receiveStatus: 'RECEIVED', paymentStatus: 'UNPAID' });
    expect(conv.status).toBe(200);
    expect((await api('post', `/purchase-orders/${po.body.id}/convert`, {})).status).toBe(400);

    await expectLedgerInvariants();

    expect((await api('delete', `/purchase-invoices/${conv.body.invoiceId}`)).status).toBe(200);
    await prisma.purchaseOrder.delete({ where: { id: po.body.id } });
  });

  it('cancels pending orders and blocks acting on them afterwards', async () => {
    const { supplier, warehouse, product } = await fixtures();
    const po = await api('post', '/purchase-orders', {
      supplierId: supplier.id, warehouseId: warehouse.id,
      items: [{ productId: product.id, qty: 1, unitCost: 10 }],
    });
    expect((await api('post', `/purchase-orders/${po.body.id}/cancel`)).status).toBe(200);
    expect((await api('post', `/purchase-orders/${po.body.id}/convert`, {})).status).toBe(400);
    expect((await api('delete', `/purchase-orders/${po.body.id}`)).status).toBe(200);
  });
});
