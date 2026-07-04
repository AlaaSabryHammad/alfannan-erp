/**
 * سير اعتماد القيود: الصانع لا يعتمد قيده، الرفض ثم التعديل وإعادة الإرسال،
 * والاعتماد يُرحّل القيد فعلياً — مع الحفاظ على توازن الدفتر.
 */
import { describe, it, expect } from 'vitest';
import bcrypt from 'bcrypt';
import request from 'supertest';
import { app, prisma, api, expectLedgerInvariants } from './helpers';

// a second reviewer distinct from the admin maker, with accounts.edit
async function reviewerToken(): Promise<string> {
  const role = await prisma.role.findFirstOrThrow({ where: { code: 'ACCOUNTANT' } });
  const email = `reviewer-${Date.now()}@example.com`;
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { name: 'مراجع', email, passwordHash: await bcrypt.hash('reviewer1', 10), roleId: role.id },
  });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'reviewer1' });
  return res.body.token as string;
}

describe('journal approvals — maker/checker with edit & resubmit', () => {
  it('reject → maker edits & resubmits → different user approves → posted, balanced', async () => {
    const [exp, cash] = await Promise.all([
      prisma.account.findUniqueOrThrow({ where: { code: '6000' } }),
      prisma.account.findUniqueOrThrow({ where: { code: '1000' } }),
    ]);

    // maker (admin) submits a request
    const created = await api('post', '/journal-approvals', {
      description: 'قيد اختبار المراجعة',
      lines: [
        { accountId: exp.id, debit: 500, credit: 0 },
        { accountId: cash.id, debit: 0, credit: 500 },
      ],
    });
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    // the maker cannot approve their own request
    const selfApprove = await api('post', `/journal-approvals/${id}/approve`, {});
    expect(selfApprove.status).toBe(403);

    // a different reviewer rejects it with a reason
    const rt = await reviewerToken();
    const rejected = await request(app).post(`/api/journal-approvals/${id}/reject`)
      .set('Authorization', `Bearer ${rt}`).send({ reason: 'الحساب غير صحيح' });
    expect(rejected.status).toBe(200);
    expect((await prisma.journalEntryApproval.findUniqueOrThrow({ where: { id } })).status).toBe('REJECTED');

    // it now shows as one of the maker's rejected-entry alerts
    const alerts = await api('get', '/alerts/summary');
    expect(alerts.body.myRejectedEntriesCount).toBeGreaterThanOrEqual(1);

    // the maker edits the rejected entry and resubmits → back to PENDING, reason cleared
    const edited = await api('put', `/journal-approvals/${id}`, {
      description: 'قيد اختبار المراجعة (معدّل)',
      lines: [
        { accountId: exp.id, debit: 700, credit: 0 },
        { accountId: cash.id, debit: 0, credit: 700 },
      ],
    });
    expect(edited.status).toBe(200);
    const afterEdit = await prisma.journalEntryApproval.findUniqueOrThrow({ where: { id } });
    expect(afterEdit.status).toBe('PENDING');
    expect(afterEdit.rejectReason).toBeNull();
    expect(afterEdit.reviewedById).toBeNull();

    // a reviewer (not the maker) can only edit their own — reject the maker's edit attempt
    const foreignEdit = await request(app).put(`/api/journal-approvals/${id}`)
      .set('Authorization', `Bearer ${rt}`)
      .send({ description: 'x', lines: [{ accountId: exp.id, debit: 1, credit: 0 }, { accountId: cash.id, debit: 0, credit: 1 }] });
    expect(foreignEdit.status).toBe(403);

    // the reviewer approves the resubmitted entry → posts a real journal entry
    const approved = await request(app).post(`/api/journal-approvals/${id}/approve`)
      .set('Authorization', `Bearer ${rt}`).send({});
    expect(approved.status).toBe(200);
    const finalReq = await prisma.journalEntryApproval.findUniqueOrThrow({ where: { id }, include: { journalEntry: true } });
    expect(finalReq.status).toBe('APPROVED');
    expect(finalReq.journalEntryId).toBeTruthy();

    // the posted entry uses the EDITED amount (700), and an approved request is immutable
    const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: finalReq.journalEntryId! } });
    expect(Number(je.totalDebit)).toBeCloseTo(700, 2);
    expect((await api('put', `/journal-approvals/${id}`, { description: 'y', lines: [{ accountId: exp.id, debit: 1, credit: 0 }, { accountId: cash.id, debit: 0, credit: 1 }] })).status).toBe(400);
    expect((await api('delete', `/journal-approvals/${id}`)).status).toBe(400);

    await expectLedgerInvariants();

    // cleanup: reverse the posted entry and remove the approval + reviewer
    await prisma.$transaction(async (tx) => {
      const entry = await tx.journalEntry.findUniqueOrThrow({ where: { id: finalReq.journalEntryId! }, include: { lines: { include: { account: true } } } });
      for (const l of entry.lines) {
        const dn = l.account.type === 'ASSET' || l.account.type === 'EXPENSE';
        const net = dn ? Number(l.debit) - Number(l.credit) : Number(l.credit) - Number(l.debit);
        if (net !== 0) await tx.account.update({ where: { id: l.accountId }, data: { currentBalance: { decrement: net } } });
      }
      await tx.journalEntryApproval.update({ where: { id }, data: { journalEntryId: null } });
      await tx.journalEntry.delete({ where: { id: entry.id } });
      await tx.journalEntryApproval.delete({ where: { id } });
    });
    await expectLedgerInvariants();
  });
});
