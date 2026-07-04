/**
 * تسوية حسابات المراقبة — أداة لمرة واحدة
 *
 * تُطابق حساب العملاء (3000) والموردين (2000) في الأستاذ العام مع إجمالي أرصدة
 * الدفتر المساعد (الأرصدة الفعلية للعملاء/الموردين، وهي «الحقيقة» التشغيلية).
 * الفرق يُرحَّل قيداً على حساب «رصيد افتتاحي» (7910).
 *
 *   تشخيص فقط:   npx tsx scripts/reconcile-control-accounts.ts
 *   تطبيق القيد:  npx tsx scripts/reconcile-control-accounts.ts --apply
 */
import 'dotenv/config';
import prisma from '../src/lib/prisma';
import { postJournalEntry, getOrCreateOpeningEquityAccount, ACCT } from '../src/lib/ledger';
import { JournalSource } from '@prisma/client';

const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const apply = process.argv.includes('--apply');

  const [custAgg, suppAgg, ar, ap] = await Promise.all([
    prisma.customer.aggregate({ _sum: { currentBalance: true } }),
    prisma.supplier.aggregate({ _sum: { currentBalance: true } }),
    prisma.account.findUniqueOrThrow({ where: { code: ACCT.AR } }),
    prisma.account.findUniqueOrThrow({ where: { code: ACCT.AP } }),
  ]);

  const arSub = round2(Number(custAgg._sum.currentBalance ?? 0));
  const arGL = round2(Number(ar.currentBalance));
  const apSub = round2(Number(suppAgg._sum.currentBalance ?? 0));
  const apGL = round2(Number(ap.currentBalance));
  const arDiff = round2(arSub - arGL);
  const apDiff = round2(apSub - apGL);

  console.log('── تشخيص تسوية حسابات المراقبة ─────────────────────────');
  console.log(`ذمم العملاء (3000):  مساعد ${money(arSub)}  |  عام ${money(arGL)}  |  فرق ${money(arDiff)}`);
  console.log(`ذمم الموردين (2000): مساعد ${money(apSub)}  |  عام ${money(apGL)}  |  فرق ${money(apDiff)}`);

  // Breakdown of what built each GL control account, to understand the cause
  for (const [label, acctId] of [['العملاء 3000', ar.id], ['الموردين 2000', ap.id]] as const) {
    const bySource = await prisma.journalLine.groupBy({
      by: ['entryId'],
      where: { accountId: acctId },
      _sum: { debit: true, credit: true },
    });
    // summarize per source type
    const entries = await prisma.journalEntry.findMany({
      where: { id: { in: bySource.map((b) => b.entryId) } },
      select: { id: true, sourceType: true },
    });
    const srcOf = new Map(entries.map((e) => [e.id, e.sourceType]));
    const totals: Record<string, { debit: number; credit: number }> = {};
    for (const b of bySource) {
      const s = srcOf.get(b.entryId) ?? 'UNKNOWN';
      totals[s] ??= { debit: 0, credit: 0 };
      totals[s].debit += Number(b._sum.debit ?? 0);
      totals[s].credit += Number(b._sum.credit ?? 0);
    }
    console.log(`\nمصادر حركة حساب ${label} في الأستاذ العام:`);
    for (const [s, t] of Object.entries(totals)) {
      console.log(`  ${s.padEnd(18)} مدين ${money(round2(t.debit))}  دائن ${money(round2(t.credit))}`);
    }
  }

  if (Math.abs(arDiff) < 0.01 && Math.abs(apDiff) < 0.01) {
    console.log('\n✅ الحسابات متطابقة بالفعل — لا حاجة لأي قيد.');
    return;
  }

  if (!apply) {
    console.log('\n(تشخيص فقط — أضف --apply لترحيل قيد التسوية)');
    return;
  }

  // Post the adjusting entries (subledger is the source of truth)
  await prisma.$transaction(async (tx) => {
    const equity = await getOrCreateOpeningEquityAccount(tx);

    if (Math.abs(arDiff) >= 0.01) {
      // AR is debit-normal: positive diff → Dr AR / Cr equity
      const arDr = arDiff > 0;
      const amt = Math.abs(arDiff);
      const e = await postJournalEntry(tx, {
        date: new Date(),
        description: 'تسوية حساب ذمم العملاء (3000) مع الدفتر المساعد',
        sourceType: JournalSource.OPENING,
        sourceId: null,
        createdById: null,
        lines: [
          { accountCode: ACCT.AR, debit: arDr ? amt : 0, credit: arDr ? 0 : amt },
          { accountId: equity.id, debit: arDr ? 0 : amt, credit: arDr ? amt : 0 },
        ],
      });
      console.log(`\n✔ قيد تسوية العملاء: ${e.entryNo} بمبلغ ${money(amt)}`);
    }

    if (Math.abs(apDiff) >= 0.01) {
      // AP is credit-normal: positive diff → Cr AP / Dr equity
      const apCr = apDiff > 0;
      const amt = Math.abs(apDiff);
      const e = await postJournalEntry(tx, {
        date: new Date(),
        description: 'تسوية حساب ذمم الموردين (2000) مع الدفتر المساعد',
        sourceType: JournalSource.OPENING,
        sourceId: null,
        createdById: null,
        lines: [
          { accountCode: ACCT.AP, debit: apCr ? 0 : amt, credit: apCr ? amt : 0 },
          { accountId: equity.id, debit: apCr ? amt : 0, credit: apCr ? 0 : amt },
        ],
      });
      console.log(`✔ قيد تسوية الموردين: ${e.entryNo} بمبلغ ${money(amt)}`);
    }
  });

  console.log('\n✅ تمت التسوية. أعد تشغيل الأداة بدون --apply للتحقق من التطابق.');
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
