/**
 * الموازنة مقابل الفعلي: الإيرادات والمصروفات لا تُجمع في إجمالي واحد؛
 * يُعرض إجمالي لكل جانب وصافي (الإيرادات − المصروفات).
 */
import { describe, it, expect } from 'vitest';
import { api, prisma } from './helpers';

const YEAR = 2035;

describe('GET /reports/budget-vs-actual', () => {
  it('reports revenue, expense and net totals separately', async () => {
    const rev = await prisma.account.findFirstOrThrow({ where: { code: '4000' } });
    const exp = await prisma.account.findFirstOrThrow({ where: { code: '6000' } });

    // budget: revenue 1000/month, expense 100/month
    for (const [acct, monthly] of [[rev.id, 1000], [exp.id, 100]] as const) {
      const r = await api('post', '/budgets/grid', { accountId: acct, year: YEAR, months: Array(12).fill(monthly) });
      expect(r.status).toBeLessThan(300);
    }

    // actual: revenue 500, expense 200 inside the year
    const entry = await api('post', '/journal', {
      date: `${YEAR}-02-01`,
      description: 'اختبار الموازنة مقابل الفعلي',
      lines: [
        { accountCode: '1100', debit: 500, credit: 0 },
        { accountCode: '4000', debit: 0, credit: 500 },
      ],
    });
    expect(entry.status).toBe(201);
    const entry2 = await api('post', '/journal', {
      date: `${YEAR}-02-01`,
      description: 'اختبار الموازنة مقابل الفعلي — مصروف',
      lines: [
        { accountCode: '6000', debit: 200, credit: 0 },
        { accountCode: '1100', debit: 0, credit: 200 },
      ],
    });
    expect(entry2.status).toBe(201);

    const res = await api('get', `/reports/budget-vs-actual?year=${YEAR}`);
    expect(res.status).toBe(200);
    const t = res.body.totals;

    expect(t.revenue.budget).toBeCloseTo(12000, 2);
    expect(t.revenue.actual).toBeCloseTo(500, 2);
    expect(t.revenue.variance).toBeCloseTo(-11500, 2);
    expect(t.expense.budget).toBeCloseTo(1200, 2);
    expect(t.expense.actual).toBeCloseTo(200, 2);
    expect(t.expense.variance).toBeCloseTo(-1000, 2);

    // net = revenue − expense on both sides, never revenue + expense
    expect(t.net.budget).toBeCloseTo(12000 - 1200, 2);
    expect(t.net.actual).toBeCloseTo(500 - 200, 2);
    expect(t.net.variance).toBeCloseTo(t.net.actual - t.net.budget, 2);
  });
});
