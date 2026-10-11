/**
 * تقرير الأرباح والخسائر (/reports/pnl): المصروفات التشغيلية رقم ولا تشمل COGS،
 * ومعادلة إجمالي الربح − المصروفات التشغيلية = صافي الربح تتحقق.
 */
import { describe, it, expect } from 'vitest';
import { api, prisma } from './helpers';

async function ledgerNet(type: 'REVENUE' | 'EXPENSE') {
  const agg = await prisma.journalLine.aggregate({
    where: { account: { type } },
    _sum: { debit: true, credit: true },
  });
  const dr = Number(agg._sum.debit ?? 0);
  const cr = Number(agg._sum.credit ?? 0);
  return type === 'REVENUE' ? cr - dr : dr - cr;
}

describe('GET /reports/pnl', () => {
  it('returns operatingExpenses as a number that excludes COGS', async () => {
    const res = await api('get', '/reports/pnl');
    expect(res.status).toBe(200);
    const p = res.body;

    expect(typeof p.operatingExpenses).toBe('number');
    expect(p.operatingExpenses).toBeCloseTo(p.totalExpenses - p.cogs, 2);
    expect(p.grossProfit - p.operatingExpenses).toBeCloseTo(p.netProfit, 2);
  });

  it('matches the ledger and keeps the per-account expenses array', async () => {
    const p = (await api('get', '/reports/pnl')).body;

    expect(p.revenue).toBeCloseTo(await ledgerNet('REVENUE'), 2);
    expect(p.totalExpenses).toBeCloseTo(await ledgerNet('EXPENSE'), 2);
    expect(Array.isArray(p.expenses)).toBe(true);
    const arraySum = p.expenses.reduce((s: number, e: { balance: number }) => s + e.balance, 0);
    expect(arraySum).toBeCloseTo(p.totalExpenses, 2);
  });

  it('returns zeros for a period with no postings', async () => {
    const p = (await api('get', '/reports/pnl?from=2000-01-01&to=2000-01-31')).body;
    expect(p.revenue).toBe(0);
    expect(p.operatingExpenses).toBe(0);
    expect(p.netProfit).toBe(0);
  });
});
