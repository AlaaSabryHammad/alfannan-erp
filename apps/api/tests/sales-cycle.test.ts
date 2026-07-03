/**
 * دورة المبيعات: فاتورة آجلة → سند قبض → مرتجع → حواجز الحذف → الثوابت المحاسبية.
 */
import { describe, it, expect } from 'vitest';
import { api, prisma, fixtures, expectLedgerInvariants } from './helpers';

describe('sales cycle', () => {
  it('credit invoice → payment → balance return → guarded deletes, balances exact', async () => {
    const { customer, warehouse, product } = await fixtures();
    const custBefore = Number(customer.currentBalance);
    const cash = await prisma.account.findUniqueOrThrow({ where: { code: '1000' } });

    // credit invoice: 4 × 100 + tax 60 = 460
    const inv = await api('post', '/sales-invoices', {
      customerId: customer.id, warehouseId: warehouse.id,
      paymentMethod: 'CREDIT', paidStatus: 'UNPAID', tax: 60,
      items: [{ productId: product.id, qty: 4, unitPrice: 100 }],
    });
    expect(inv.status).toBe(201);
    expect(Number(inv.body.total)).toBeCloseTo(460, 2);

    // ledger debits AR (3000), never cash, when a receivable is raised
    const je = await prisma.journalEntry.findFirstOrThrow({
      where: { sourceType: 'SALES_INVOICE', sourceId: inv.body.id },
      include: { lines: { include: { account: true } } },
    });
    expect(je.lines.some((l) => l.account.code === '3000' && Number(l.debit) > 0)).toBe(true);

    // partial payment 200 → PARTIAL
    const v = await api('post', '/vouchers', {
      type: 'RECEIPT', treasuryAccountId: cash.id, partyType: 'CUSTOMER', partyId: customer.id,
      salesInvoiceId: inv.body.id, amount: 200,
    });
    expect(v.status).toBe(201);
    expect((await prisma.salesInvoice.findUniqueOrThrow({ where: { id: inv.body.id } })).paidStatus).toBe('PARTIAL');

    // BALANCE return of 1 unit: 100 + prorated tax 15 = 115 → remaining 145
    const ret = await api('post', '/sales-returns', {
      salesInvoiceId: inv.body.id, refundMethod: 'BALANCE',
      items: [{ productId: product.id, qty: 1 }],
    });
    expect(ret.status).toBe(201);
    expect(Number(ret.body.total)).toBeCloseTo(115, 2);

    const detail = await api('get', `/sales-invoices/${inv.body.id}`);
    expect(Number(detail.body.remainingAmount)).toBeCloseTo(145, 2);

    // overpay guard counts the return
    const over = await api('post', '/vouchers', {
      type: 'RECEIPT', treasuryAccountId: cash.id, partyType: 'CUSTOMER', partyId: customer.id,
      salesInvoiceId: inv.body.id, amount: 146,
    });
    expect(over.status).toBe(400);

    // invoice with linked documents cannot be deleted
    expect((await api('delete', `/sales-invoices/${inv.body.id}`)).status).toBe(400);

    // unwind: return → voucher → invoice; customer balance must land exactly where it started
    expect((await api('delete', `/sales-returns/${ret.body.id}`)).status).toBe(200);
    expect((await api('delete', `/vouchers/${v.body.id}`)).status).toBe(200);
    expect((await api('delete', `/sales-invoices/${inv.body.id}`)).status).toBe(200);

    const custAfter = await prisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(Number(custAfter.currentBalance)).toBeCloseTo(custBefore, 2);

    await expectLedgerInvariants();
  });

  it('deleting a journal entry never breaks next-day numbering (max+1, not count+1)', async () => {
    const { customer, warehouse, product } = await fixtures();
    const mk = () => api('post', '/sales-invoices', {
      customerId: customer.id, warehouseId: warehouse.id,
      paymentMethod: 'CASH', paidStatus: 'PAID',
      items: [{ productId: product.id, qty: 1, unitPrice: 50 }],
    });
    const a = await mk();
    const b = await mk();
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    // delete the FIRST — count-based sequencing would now re-issue B's number
    expect((await api('delete', `/sales-invoices/${a.body.id}`)).status).toBe(200);
    const c = await mk();
    expect(c.status).toBe(201);
    await api('delete', `/sales-invoices/${b.body.id}`);
    await api('delete', `/sales-invoices/${c.body.id}`);
  });
});
