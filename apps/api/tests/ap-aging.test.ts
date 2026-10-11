/**
 * تعمير ذمم الموردين: الإجمالي يطابق أرصدة الموردين (بما فيها الأرصدة
 * الافتتاحية والدفعات على الحساب غير المربوطة بفاتورة).
 */
import { describe, it, expect } from 'vitest';
import { api, prisma } from './helpers';

describe('GET /reports/ap-aging', () => {
  it('reconciles the aging total with the sum of supplier balances', async () => {
    const res = await api('get', '/reports/ap-aging');
    expect(res.status).toBe(200);

    const agg = await prisma.supplier.aggregate({ _sum: { currentBalance: true } });
    const suppliersTotal = Number(agg._sum.currentBalance ?? 0);

    expect(res.body.totals.total).toBeCloseTo(suppliersTotal, 2);
    const t = res.body.totals;
    expect(t.current + t.b31_60 + t.b61_90 + t.over90 + t.unallocated).toBeCloseTo(t.total, 2);
  });

  it('shows an opening balance with no invoices as unallocated', async () => {
    const sup = await prisma.supplier.create({
      data: { nameAr: 'مورد اختبار التعمير', openingBalance: 900, currentBalance: 900 },
    });
    try {
      const res = await api('get', '/reports/ap-aging');
      const row = res.body.rows.find((r: { id: number }) => r.id === sup.id);
      expect(row).toBeTruthy();
      expect(row.unallocated).toBeCloseTo(900, 2);
      expect(row.current + row.b31_60 + row.b61_90 + row.over90).toBe(0);
      expect(row.total).toBeCloseTo(900, 2);
    } finally {
      await prisma.supplier.delete({ where: { id: sup.id } });
    }
  });
});
