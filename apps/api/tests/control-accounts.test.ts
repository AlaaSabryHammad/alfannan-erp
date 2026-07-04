/**
 * تكامل الدفتر المساعد مع الأستاذ العام: منع التقييد اليدوي على حسابات المراقبة
 * (العملاء/الموردين)، وأن الرصيد الافتتاحي يُقيَّد على AR/AP فيبقيان متطابقين.
 */
import { describe, it, expect } from 'vitest';
import { api, prisma, expectLedgerInvariants } from './helpers';

describe('control accounts & opening balances', () => {
  it('blocks manual journal entries that post directly to AR/AP', async () => {
    const [ar, rev] = await Promise.all([
      prisma.account.findUniqueOrThrow({ where: { code: '3000' } }),
      prisma.account.findUniqueOrThrow({ where: { code: '4000' } }),
    ]);
    const res = await api('post', '/journal', {
      description: 'محاولة تقييد يدوي على العملاء',
      lines: [
        { accountId: ar.id, debit: 100, credit: 0 },
        { accountId: rev.id, debit: 0, credit: 100 },
      ],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('حساب العملاء');
    await expectLedgerInvariants();
  });

  it('a customer opening balance posts to AR so subledger and GL stay in sync', async () => {
    const before = (await api('get', '/reports/control-reconciliation')).body;
    const arBefore = Number((await prisma.account.findUniqueOrThrow({ where: { code: '3000' } })).currentBalance);

    const cust = await api('post', '/customers', { nameAr: `عميل رصيد افتتاحي ${Date.now()}`, openingBalance: 500 });
    expect(cust.status).toBe(201);

    const arAfter = Number((await prisma.account.findUniqueOrThrow({ where: { code: '3000' } })).currentBalance);
    expect(arAfter - arBefore).toBeCloseTo(500, 2); // GL control account moved with the subledger

    const after = (await api('get', '/reports/control-reconciliation')).body;
    // both sides moved by 500 → the reconciliation gap is unchanged
    expect(after.receivables.difference).toBeCloseTo(before.receivables.difference, 2);

    await expectLedgerInvariants();

    // cleanup: reverse the opening entry, then remove the customer
    await prisma.$transaction(async (tx) => {
      const je = await tx.journalEntry.findFirst({
        where: { sourceType: 'OPENING', description: { contains: cust.body.nameAr } },
        include: { lines: { include: { account: true } } },
      });
      if (je) {
        for (const l of je.lines) {
          const dn = l.account.type === 'ASSET' || l.account.type === 'EXPENSE';
          const net = dn ? Number(l.debit) - Number(l.credit) : Number(l.credit) - Number(l.debit);
          if (net !== 0) await tx.account.update({ where: { id: l.accountId }, data: { currentBalance: { decrement: net } } });
        }
        await tx.journalEntry.delete({ where: { id: je.id } });
      }
      await tx.customer.delete({ where: { id: cust.body.id } });
    });
    await expectLedgerInvariants();
  });
});
