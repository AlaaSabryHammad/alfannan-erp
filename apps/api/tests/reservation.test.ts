/**
 * حجز المخزون: أمر البيع المعلّق يحجز كميته — لا تُباع لغيره ولا تُحجز مرتين،
 * وتنفيذ الأمر نفسه يستهلك حجزه، والإلغاء يحرره.
 */
import { describe, it, expect } from 'vitest';
import { api, prisma, fixtures, expectLedgerInvariants, forceDeleteSalesInvoiceForTest } from './helpers';

describe('stock reservations', () => {
  it('pending orders reserve stock; fulfilling consumes own reservation; cancel releases', async () => {
    const { customer, supplier, warehouse } = await fixtures();

    // isolated product with exactly 10 on hand
    const prod = await api('post', '/products', {
      nameAr: 'منتج اختبار الحجز', sku: `T-RSV-${Date.now()}`, costPrice: 10, salePrice: 50,
    });
    const productId = prod.body.id as number;
    const po = await api('post', '/purchase-invoices', {
      supplierId: supplier.id, warehouseId: warehouse.id,
      paymentStatus: 'UNPAID', receiveStatus: 'RECEIVED',
      items: [{ productId, qty: 10, unitCost: 10 }],
    });
    expect(po.status).toBe(201);

    // order A reserves 7 of the 10
    const orderA = await api('post', '/sales-orders', {
      customerId: customer.id, warehouseId: warehouse.id,
      items: [{ productId, qty: 7, unitPrice: 50 }],
    });
    expect(orderA.status).toBe(201);

    // a direct sale of 5 would leave 5 < 7 reserved → blocked
    const blockedSale = await api('post', '/sales-invoices', {
      customerId: customer.id, warehouseId: warehouse.id,
      paymentMethod: 'CASH', paidStatus: 'PAID',
      items: [{ productId, qty: 5, unitPrice: 50 }],
    });
    expect(blockedSale.status).toBe(400);
    expect(blockedSale.body.error).toContain('محجوزة لأوامر بيع');

    // a direct sale of 3 (exactly the unreserved remainder) is fine
    const okSale = await api('post', '/sales-invoices', {
      customerId: customer.id, warehouseId: warehouse.id,
      paymentMethod: 'CASH', paidStatus: 'PAID',
      items: [{ productId, qty: 3, unitPrice: 50 }],
    });
    expect(okSale.status).toBe(201);

    // a second order can't reserve more than what's left unreserved (0 now)
    const orderB = await api('post', '/sales-orders', {
      customerId: customer.id, warehouseId: warehouse.id,
      items: [{ productId, qty: 1, unitPrice: 50 }],
    });
    expect(orderB.status).toBe(400);
    expect(orderB.body.error).toContain('غير كافية للحجز');

    // order A itself fulfills fine — it consumes its own reservation
    const ful = await api('post', `/sales-orders/${orderA.body.id}/fulfill`, { paymentMethod: 'CASH', paidStatus: 'PAID' });
    expect(ful.status).toBe(200);

    // stock is now 0 and nothing is reserved → a fresh order for 1 is rejected on availability
    const orderC = await api('post', '/sales-orders', {
      customerId: customer.id, warehouseId: warehouse.id,
      items: [{ productId, qty: 1, unitPrice: 50 }],
    });
    expect(orderC.status).toBe(400);

    await expectLedgerInvariants();

    // cancellation releases a reservation: restock 2 via new purchase, order 2, cancel, sell 2
    const po2 = await api('post', '/purchase-invoices', {
      supplierId: supplier.id, warehouseId: warehouse.id,
      paymentStatus: 'UNPAID', receiveStatus: 'RECEIVED',
      items: [{ productId, qty: 2, unitCost: 10 }],
    });
    const orderD = await api('post', '/sales-orders', {
      customerId: customer.id, warehouseId: warehouse.id,
      items: [{ productId, qty: 2, unitPrice: 50 }],
    });
    expect(orderD.status).toBe(201);
    await api('post', `/sales-orders/${orderD.body.id}/cancel`);
    const saleAfterCancel = await api('post', '/sales-invoices', {
      customerId: customer.id, warehouseId: warehouse.id,
      paymentMethod: 'CASH', paidStatus: 'PAID',
      items: [{ productId, qty: 2, unitPrice: 50 }],
    });
    expect(saleAfterCancel.status).toBe(201);

    // cleanup
    await forceDeleteSalesInvoiceForTest(saleAfterCancel.body.id);
    await api('delete', `/sales-orders/${orderD.body.id}`);
    await forceDeleteSalesInvoiceForTest(ful.body.invoiceId);
    await prisma.salesOrder.delete({ where: { id: orderA.body.id } });
    await forceDeleteSalesInvoiceForTest(okSale.body.id);
    for (const id of [po2.body.id, po.body.id]) {
      expect((await api('delete', `/purchase-invoices/${id}`)).status).toBe(200);
    }
    await prisma.stockMovement.deleteMany({ where: { productId } });
    await prisma.stockBalance.deleteMany({ where: { productId } });
    await prisma.product.delete({ where: { id: productId } });
    await expectLedgerInvariants();
  });
});
