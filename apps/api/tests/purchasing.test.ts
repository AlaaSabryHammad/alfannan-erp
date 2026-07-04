/**
 * المشتريات: خصم الفاتورة (توازن القيد)، متوسط التكلفة المتحرك، استلام المعلّق، مرتجع الشراء.
 */
import { describe, it, expect } from 'vitest';
import { api, prisma, fixtures, expectLedgerInvariants, forceDeleteSalesInvoiceForTest } from './helpers';

describe('purchasing, costing, and receiving', () => {
  it('moving average tracks receipts (discount prorated) and feeds COGS', async () => {
    const { supplier, customer, warehouse } = await fixtures();

    // fresh product so the math is fully controlled
    const prod = await api('post', '/products', {
      nameAr: 'منتج اختبار التكلفة', sku: `T-COST-${Date.now()}`, costPrice: 10, salePrice: 100,
    });
    expect(prod.status).toBe(201);
    const productId = prod.body.id as number;
    const cost = async () => Number((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).costPrice);

    // 10 @ 20 received on empty stock → avg resets to 20
    const p1 = await api('post', '/purchase-invoices', {
      supplierId: supplier.id, warehouseId: warehouse.id,
      paymentStatus: 'UNPAID', receiveStatus: 'RECEIVED',
      items: [{ productId, qty: 10, unitCost: 20 }],
    });
    expect(p1.status).toBe(201);
    expect(await cost()).toBeCloseTo(20, 2);

    // 10 @ 30 with discount 30 (net 27) → (10×20 + 10×27) / 20 = 23.5
    // also the regression for the unbalanced-entry bug: discounted RECEIVED purchases must post
    const p2 = await api('post', '/purchase-invoices', {
      supplierId: supplier.id, warehouseId: warehouse.id,
      paymentStatus: 'UNPAID', receiveStatus: 'RECEIVED', discount: 30,
      items: [{ productId, qty: 10, unitCost: 30 }],
    });
    expect(p2.status).toBe(201);
    expect(await cost()).toBeCloseTo(23.5, 2);

    // pending purchase moves nothing until received
    const p3 = await api('post', '/purchase-invoices', {
      supplierId: supplier.id, warehouseId: warehouse.id,
      paymentStatus: 'UNPAID', receiveStatus: 'PENDING',
      items: [{ productId, qty: 20, unitCost: 40 }],
    });
    expect(p3.status).toBe(201);
    expect(await prisma.journalEntry.findFirst({ where: { sourceType: 'PURCHASE_INVOICE', sourceId: p3.body.id } })).toBeNull();

    const rcv = await api('post', `/purchase-invoices/${p3.body.id}/receive`);
    expect(rcv.status).toBe(200);
    expect(await cost()).toBeCloseTo(31.75, 2); // (20×23.5 + 20×40) / 40
    expect((await api('post', `/purchase-invoices/${p3.body.id}/receive`)).status).toBe(400); // once only

    // a sale's COGS uses the current moving average
    const sale = await api('post', '/sales-invoices', {
      customerId: customer.id, warehouseId: warehouse.id,
      paymentMethod: 'CASH', paidStatus: 'PAID',
      items: [{ productId, qty: 2, unitPrice: 100 }],
    });
    const saleJe = await prisma.journalEntry.findFirstOrThrow({
      where: { sourceType: 'SALES_INVOICE', sourceId: sale.body.id },
      include: { lines: { include: { account: true } } },
    });
    const cogsLine = saleJe.lines.find((l) => l.account.code === '5000');
    expect(Number(cogsLine?.debit)).toBeCloseTo(63.5, 2);

    // purchase return: 2 units back, prorated totals, supplier balance drops
    const suppBefore = Number((await prisma.supplier.findUniqueOrThrow({ where: { id: supplier.id } })).currentBalance);
    const pret = await api('post', '/purchase-returns', {
      purchaseInvoiceId: p2.body.id, refundMethod: 'BALANCE',
      items: [{ productId, qty: 2 }],
    });
    expect(pret.status).toBe(201);
    const suppAfter = Number((await prisma.supplier.findUniqueOrThrow({ where: { id: supplier.id } })).currentBalance);
    expect(suppBefore - suppAfter).toBeCloseTo(Number(pret.body.total), 2);

    await expectLedgerInvariants();

    // cleanup
    await forceDeleteSalesInvoiceForTest(sale.body.id);
    await api('delete', `/purchase-returns/${pret.body.id}`);
    for (const id of [p3.body.id, p2.body.id, p1.body.id]) {
      expect((await api('delete', `/purchase-invoices/${id}`)).status).toBe(200);
    }
    await prisma.stockMovement.deleteMany({ where: { productId } });
    await prisma.stockBalance.deleteMany({ where: { productId } });
    await prisma.product.delete({ where: { id: productId } });
    await expectLedgerInvariants();
  });
});
