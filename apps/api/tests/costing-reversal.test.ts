/**
 * صحة متوسط التكلفة عند العكس: حذف فاتورة شراء يُعيد المتوسط، ومرتجع البيع
 * يعكس تكلفة البضاعة بسعرها وقت البيع لا بالمتوسط الحالي.
 */
import { describe, it, expect } from 'vitest';
import { api, prisma, fixtures, expectLedgerInvariants, forceDeleteSalesInvoiceForTest } from './helpers';

const cost = async (id: number) => Number((await prisma.product.findUniqueOrThrow({ where: { id } })).costPrice);

describe('moving-average reversal', () => {
  it('deleting a purchase invoice restores the moving average', async () => {
    const { supplier, warehouse } = await fixtures();
    const prod = await api('post', '/products', { nameAr: 'منتج عكس المتوسط', sku: `T-REV-${Date.now()}`, costPrice: 10, salePrice: 100 });
    const productId = prod.body.id as number;

    // receive 10 @ 20 on empty stock → avg 20
    const p1 = await api('post', '/purchase-invoices', {
      supplierId: supplier.id, warehouseId: warehouse.id, paymentStatus: 'UNPAID', receiveStatus: 'RECEIVED',
      items: [{ productId, qty: 10, unitCost: 20 }],
    });
    expect(await cost(productId)).toBeCloseTo(20, 2);

    // receive 10 @ 30 → avg (10×20 + 10×30)/20 = 25
    const p2 = await api('post', '/purchase-invoices', {
      supplierId: supplier.id, warehouseId: warehouse.id, paymentStatus: 'UNPAID', receiveStatus: 'RECEIVED',
      items: [{ productId, qty: 10, unitCost: 30 }],
    });
    expect(await cost(productId)).toBeCloseTo(25, 2);

    // deleting the 2nd receipt removes its contribution → back to 20
    expect((await api('delete', `/purchase-invoices/${p2.body.id}`)).status).toBe(200);
    expect(await cost(productId)).toBeCloseTo(20, 2);

    await expectLedgerInvariants();

    // cleanup
    expect((await api('delete', `/purchase-invoices/${p1.body.id}`)).status).toBe(200);
    await prisma.stockMovement.deleteMany({ where: { productId } });
    await prisma.stockBalance.deleteMany({ where: { productId } });
    await prisma.product.delete({ where: { id: productId } });
    await expectLedgerInvariants();
  });

  it('a sales return reverses COGS at the cost booked when sold, not the drifted average', async () => {
    const { customer, supplier, warehouse } = await fixtures();
    const prod = await api('post', '/products', { nameAr: 'منتج تكلفة المرتجع', sku: `T-RCOGS-${Date.now()}`, costPrice: 10, salePrice: 100 });
    const productId = prod.body.id as number;

    // receive 10 @ 20 → avg 20
    const p1 = await api('post', '/purchase-invoices', {
      supplierId: supplier.id, warehouseId: warehouse.id, paymentStatus: 'UNPAID', receiveStatus: 'RECEIVED',
      items: [{ productId, qty: 10, unitCost: 20 }],
    });

    // sell 2 @ 100 → COGS booked at avg 20 → 40
    const sale = await api('post', '/sales-invoices', {
      customerId: customer.id, warehouseId: warehouse.id, paymentMethod: 'CASH', paidStatus: 'PAID',
      items: [{ productId, qty: 2, unitPrice: 100 }],
    });
    const saleJe = await prisma.journalEntry.findFirstOrThrow({
      where: { sourceType: 'SALES_INVOICE', sourceId: sale.body.id },
      include: { lines: { include: { account: true } } },
    });
    expect(Number(saleJe.lines.find((l) => l.account.code === '5000')!.debit)).toBeCloseTo(40, 2);

    // a later, pricier receipt drifts the average up (10 @ 40 on 8 on-hand → (8×20+10×40)/18 = 28.89)
    const p2 = await api('post', '/purchase-invoices', {
      supplierId: supplier.id, warehouseId: warehouse.id, paymentStatus: 'UNPAID', receiveStatus: 'RECEIVED',
      items: [{ productId, qty: 10, unitCost: 40 }],
    });
    expect(await cost(productId)).toBeGreaterThan(28);

    // return 1 of the sold units — COGS must reverse at 20 (cost when sold), not ~28.89
    const ret = await api('post', '/sales-returns', {
      salesInvoiceId: sale.body.id, refundMethod: 'BALANCE', items: [{ productId, qty: 1 }],
    });
    expect(ret.status).toBe(201);
    const retJe = await prisma.journalEntry.findFirstOrThrow({
      where: { sourceType: 'SALES_RETURN', sourceId: ret.body.id },
      include: { lines: { include: { account: true } } },
    });
    const cogsCredit = retJe.lines.find((l) => l.account.code === '5000' && Number(l.credit) > 0);
    expect(Number(cogsCredit!.credit)).toBeCloseTo(20, 2);

    await expectLedgerInvariants();

    // cleanup
    await api('delete', `/sales-returns/${ret.body.id}`);
    await forceDeleteSalesInvoiceForTest(sale.body.id);
    for (const id of [p2.body.id, p1.body.id]) await api('delete', `/purchase-invoices/${id}`);
    await prisma.stockMovement.deleteMany({ where: { productId } });
    await prisma.stockBalance.deleteMany({ where: { productId } });
    await prisma.product.delete({ where: { id: productId } });
    await expectLedgerInvariants();
  });
});
