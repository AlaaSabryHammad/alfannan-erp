/**
 * لوحة التحكم: مؤشرات السيولة والذمم والمخزون والأرباح تُقرأ من الأستاذ العام.
 */
import { describe, it, expect } from 'vitest';
import { api, prisma } from './helpers';

const sum = (v: unknown) => Number(v ?? 0);

async function ledgerNet(type: 'REVENUE' | 'EXPENSE') {
  const agg = await prisma.journalLine.aggregate({
    where: { account: { type }, entry: { sourceType: { not: 'YEAR_CLOSE' } } },
    _sum: { debit: true, credit: true },
  });
  return type === 'REVENUE'
    ? sum(agg._sum.credit) - sum(agg._sum.debit)
    : sum(agg._sum.debit) - sum(agg._sum.credit);
}

async function balance(code: string) {
  const a = await prisma.account.findFirstOrThrow({ where: { code } });
  return Number(a.currentBalance);
}

describe('dashboard', () => {
  it('reads cash, receivables, inventory and net profit from the ledger', async () => {
    const res = await api('get', '/dashboard');
    expect(res.status).toBe(200);
    const k = res.body.kpis;

    expect(k.cashLiquidity).toBeCloseTo((await balance('1000')) + (await balance('1100')), 2);
    expect(k.totalReceivables).toBeCloseTo(await balance('3000'), 2);
    expect(k.inventoryValuation).toBeCloseTo(await balance('1200'), 2);
    expect(k.netProfit).toBeCloseTo((await ledgerNet('REVENUE')) - (await ledgerNet('EXPENSE')), 2);
  });

  it('reflects a ledger posting in cash liquidity but leaves net profit unchanged', async () => {
    const before = (await api('get', '/dashboard')).body.kpis;

    // capital injection: Dr bank / Cr capital — raises cash, no P&L effect
    const entry = await api('post', '/journal', {
      description: 'ضخ رأس مال — اختبار الداشبورد',
      lines: [
        { accountCode: '1100', debit: 750, credit: 0 },
        { accountCode: '7000', debit: 0, credit: 750 },
      ],
    });
    expect(entry.status).toBe(201);

    const after = (await api('get', '/dashboard')).body.kpis;
    expect(after.cashLiquidity - before.cashLiquidity).toBeCloseTo(750, 2);
    expect(after.netProfit).toBeCloseTo(before.netProfit, 2);
  });

  it('accepts a branch filter and falls back to document-based figures', async () => {
    const branch = await prisma.branch.findFirst();
    if (!branch) return;
    const res = await api('get', `/dashboard?branchId=${branch.id}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.kpis.cashLiquidity).toBe('number');
  });
});
