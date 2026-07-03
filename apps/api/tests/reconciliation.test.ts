/**
 * التسوية البنكية: المطابقة، الفرق الصفري، وقاعدة «السطر يُسوّى مرة واحدة».
 */
import { describe, it, expect } from 'vitest';
import { api, prisma, expectLedgerInvariants } from './helpers';

describe('bank reconciliation', () => {
  it('reconciles deposits with zero difference and enforces once-only lines', async () => {
    const bank = await prisma.account.findUniqueOrThrow({ where: { code: '1100' } });
    const opening = Number(bank.openingBalance);

    const v1 = await api('post', '/vouchers', { type: 'DEPOSIT', treasuryAccountId: bank.id, amount: 300, description: 'إيداع اختبار 1' });
    const v2 = await api('post', '/vouchers', { type: 'DEPOSIT', treasuryAccountId: bank.id, amount: 200, description: 'إيداع اختبار 2' });
    expect(v1.status).toBe(201);
    expect(v2.status).toBe(201);

    const already = await prisma.journalLine.aggregate({
      where: { accountId: bank.id, reconciliationLine: { isNot: null } },
      _sum: { debit: true, credit: true },
    });
    const alreadyNet = Number(already._sum.debit ?? 0) - Number(already._sum.credit ?? 0);
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

    // bank statement only saw the first deposit
    const recon = await api('post', '/bank-reconciliations', {
      accountId: bank.id, statementDate: tomorrow, statementBalance: opening + alreadyNet + 300,
    });
    expect(recon.status).toBe(201);

    // one open draft per account
    expect((await api('post', '/bank-reconciliations', { accountId: bank.id, statementDate: tomorrow, statementBalance: 0 })).status).toBe(400);

    const un = await api('get', `/bank-reconciliations/${recon.body.id}/unreconciled`);
    const line300 = un.body.find((l: { debit: number; description: string }) => Math.abs(l.debit - 300) < 0.01 && l.description?.includes('إيداع اختبار 1'));
    const line200 = un.body.find((l: { debit: number; description: string }) => Math.abs(l.debit - 200) < 0.01 && l.description?.includes('إيداع اختبار 2'));
    expect(line300).toBeTruthy();
    expect(line200).toBeTruthy();

    const put = await api('put', `/bank-reconciliations/${recon.body.id}/lines`, { journalLineIds: [line300.id] });
    expect(put.status).toBe(200);
    expect(Number(put.body.differencePreview)).toBeCloseTo(0, 2);

    const comp = await api('post', `/bank-reconciliations/${recon.body.id}/complete`);
    expect(comp.body.status).toBe('COMPLETED');
    expect(Number(comp.body.difference)).toBeCloseTo(0, 2);

    // completed sessions are immutable
    expect((await api('put', `/bank-reconciliations/${recon.body.id}/lines`, { journalLineIds: [] })).status).toBe(400);
    expect((await api('delete', `/bank-reconciliations/${recon.body.id}`)).status).toBe(400);

    // the reconciled line is gone from the next session's candidates and cannot be claimed
    const recon2 = await api('post', '/bank-reconciliations', {
      accountId: bank.id, statementDate: tomorrow, statementBalance: opening + alreadyNet + 500,
    });
    const un2 = await api('get', `/bank-reconciliations/${recon2.body.id}/unreconciled`);
    expect(un2.body.some((l: { id: number }) => l.id === line300.id)).toBe(false);
    expect((await api('put', `/bank-reconciliations/${recon2.body.id}/lines`, { journalLineIds: [line300.id] })).status).toBe(400);

    await api('put', `/bank-reconciliations/${recon2.body.id}/lines`, { journalLineIds: [line200.id] });
    const comp2 = await api('post', `/bank-reconciliations/${recon2.body.id}/complete`);
    expect(Number(comp2.body.difference)).toBeCloseTo(0, 2);

    await expectLedgerInvariants();

    // cleanup
    await prisma.bankReconciliation.deleteMany({ where: { id: { in: [recon.body.id, recon2.body.id] } } });
    expect((await api('delete', `/vouchers/${v1.body.id}`)).status).toBe(200);
    expect((await api('delete', `/vouchers/${v2.body.id}`)).status).toBe(200);
  });
});
