/**
 * تعمير ذمم العملاء: الإجمالي يطابق أرصدة العملاء (بما فيها الأرصدة
 * الافتتاحية والدفعات على الحساب غير المربوطة بفاتورة).
 */
import { describe, it, expect } from 'vitest';
import { api, prisma } from './helpers';

describe('GET /reports/ar-aging', () => {
  it('reconciles the aging total with the sum of customer balances', async () => {
    const res = await api('get', '/reports/ar-aging');
    expect(res.status).toBe(200);

    const agg = await prisma.customer.aggregate({ _sum: { currentBalance: true } });
    const customersTotal = Number(agg._sum.currentBalance ?? 0);

    expect(res.body.totals.total).toBeCloseTo(customersTotal, 2);
    const parts =
      res.body.totals.current + res.body.totals.b31_60 + res.body.totals.b61_90 +
      res.body.totals.over90 + res.body.totals.unallocated;
    expect(parts).toBeCloseTo(res.body.totals.total, 2);
  });

  it('shows an opening balance with no invoices as unallocated', async () => {
    const cust = await prisma.customer.create({
      data: { nameAr: 'عميل اختبار التعمير', openingBalance: 750, currentBalance: 750 },
    });
    try {
      const res = await api('get', '/reports/ar-aging');
      const row = res.body.rows.find((r: { id: number }) => r.id === cust.id);
      expect(row).toBeTruthy();
      expect(row.unallocated).toBeCloseTo(750, 2);
      expect(row.over90 + row.current + row.b31_60 + row.b61_90).toBe(0);
      expect(row.total).toBeCloseTo(750, 2);
    } finally {
      await prisma.customer.delete({ where: { id: cust.id } });
    }
  });
});
