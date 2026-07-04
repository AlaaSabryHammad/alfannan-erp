/**
 * الفاتورة المعلّقة (غير مستلمة) ليست ذمة بعد: لا ترفع رصيد المورّد ولا حساب
 * الموردين (2000) حتى الاستلام — فيبقى الدفتر المساعد متطابقاً مع الأستاذ العام.
 */
import { describe, it, expect } from 'vitest';
import { api, prisma, fixtures, expectLedgerInvariants } from './helpers';

const supplierBalance = async (id: number) => Number((await prisma.supplier.findUniqueOrThrow({ where: { id } })).currentBalance);
const apBalance = async () => Number((await prisma.account.findUniqueOrThrow({ where: { code: '2000' } })).currentBalance);

describe('pending purchase is not a payable until received', () => {
  it('raises supplier balance and AP only on receipt, and both move together', async () => {
    const { supplier, warehouse, product } = await fixtures();
    const suppBefore = await supplierBalance(supplier.id);
    const apBefore = await apBalance();

    // PENDING unpaid purchase — no payable yet
    const po = await api('post', '/purchase-invoices', {
      supplierId: supplier.id, warehouseId: warehouse.id,
      paymentStatus: 'UNPAID', receiveStatus: 'PENDING',
      items: [{ productId: product.id, qty: 3, unitCost: 40 }],
    });
    expect(po.status).toBe(201);
    expect(await supplierBalance(supplier.id)).toBeCloseTo(suppBefore, 2);
    expect(await apBalance()).toBeCloseTo(apBefore, 2);

    // it must NOT appear in AP aging while pending
    const agingPending = await api('get', '/reports/ap-aging');
    expect(agingPending.body.rows.some((r: { id: number }) => r.id === supplier.id &&
      agingPending.body.rows.find((x: { id: number; total: number }) => x.id === supplier.id)!.total > suppBefore + 100)).toBe(false);

    // receive → payable now exists; supplier balance and AP rise by the same total
    const total = Number(po.body.total);
    const rcv = await api('post', `/purchase-invoices/${po.body.id}/receive`);
    expect(rcv.status).toBe(200);
    expect(await supplierBalance(supplier.id)).toBeCloseTo(suppBefore + total, 2);
    expect(await apBalance()).toBeCloseTo(apBefore + total, 2);

    await expectLedgerInvariants();

    // deleting the received invoice reverses both back to the start
    expect((await api('delete', `/purchase-invoices/${po.body.id}`)).status).toBe(200);
    expect(await supplierBalance(supplier.id)).toBeCloseTo(suppBefore, 2);
    expect(await apBalance()).toBeCloseTo(apBefore, 2);
    await expectLedgerInvariants();
  });

  it('deleting a still-pending purchase leaves the supplier balance untouched', async () => {
    const { supplier, warehouse, product } = await fixtures();
    const suppBefore = await supplierBalance(supplier.id);

    const po = await api('post', '/purchase-invoices', {
      supplierId: supplier.id, warehouseId: warehouse.id,
      paymentStatus: 'UNPAID', receiveStatus: 'PENDING',
      items: [{ productId: product.id, qty: 2, unitCost: 25 }],
    });
    expect((await api('delete', `/purchase-invoices/${po.body.id}`)).status).toBe(200);
    expect(await supplierBalance(supplier.id)).toBeCloseTo(suppBefore, 2);
    await expectLedgerInvariants();
  });
});
