/**
 * الميزانية العمومية: الأصول = الخصوم + حقوق الملكية، ورصيد حساب أب
 * (مثل 7000) المسجّل عليه مباشرة لا يُستبعد من إجمالي حقوق الملكية.
 */
import { describe, it, expect } from 'vitest';
import { api } from './helpers';

async function balanceSheet() {
  const res = await api('get', '/reports/balance-sheet');
  expect(res.status).toBe(200);
  return res.body;
}

describe('GET /reports/balance-sheet', () => {
  it('balances: assets equal liabilities plus equity', async () => {
    const bs = await balanceSheet();
    expect(bs.balanced).toBe(true);
    expect(bs.assets.total).toBeCloseTo(bs.totalLiabilitiesAndEquity, 2);
  });

  it('counts a posting made directly on a parent equity account', async () => {
    const before = await balanceSheet();

    // Dr bank / Cr 7000 (parent of the partner capital accounts)
    const entry = await api('post', '/journal', {
      description: 'ضخ رأس مال على الحساب الأب — اختبار الميزانية',
      lines: [
        { accountCode: '1100', debit: 1234, credit: 0 },
        { accountCode: '7000', debit: 0, credit: 1234 },
      ],
    });
    expect(entry.status).toBe(201);

    const after = await balanceSheet();
    expect(after.equity.total - before.equity.total).toBeCloseTo(1234, 2);
    expect(after.assets.total - before.assets.total).toBeCloseTo(1234, 2);
    expect(after.balanced).toBe(true);
  });
});
