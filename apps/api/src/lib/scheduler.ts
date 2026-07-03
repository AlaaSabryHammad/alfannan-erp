/**
 * المهام المجدولة — In-process scheduler
 *
 * A lightweight hourly tick (no external cron dependency) that automates the
 * two accounting chores that were manual buttons until now:
 *
 *   1. القيود المتكررة — active RecurringEntry templates post themselves once
 *      per calendar month, on/after their dayOfMonth.
 *   2. الإهلاك الشهري — every ACTIVE fixed asset gets its straight-line
 *      depreciation entry near month-end (on/after day 28 by default), once
 *      per calendar month, never in the month it was purchased.
 *
 * Every posting goes through postJournalEntry, so fiscal-period locks apply.
 * Each action is recorded in AuditLog (method CRON) for visibility, and a
 * failure in one item never blocks the others. The whole scheduler can be
 * switched off with the `schedulerEnabled` setting.
 */
import { Prisma, JournalSource } from '@prisma/client';
import prisma from './prisma';
import { postJournalEntry, ACCT } from './ledger';

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface JobRunResult {
  ranAt: Date;
  recurringPosted: number;
  depreciationPosted: number;
  errors: string[];
}

// Kept in memory for the /status endpoint — resets on server restart.
let lastRun: JobRunResult | null = null;
let running = false;

export function getLastRun(): JobRunResult | null {
  return lastRun;
}

async function isSchedulerEnabled(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: 'schedulerEnabled' } });
  return (row?.value ?? 'true') === 'true';
}

async function auditCron(action: string, entity: string, detail: string): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userName: 'المجدول التلقائي',
      method: 'CRON',
      path: detail,
      action,
      entity,
      statusCode: 200,
    },
  }).catch(() => { /* audit failure must never break the job */ });
}

function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

// ── Job 1: recurring journal entries ──────────────────────────────────────────

export async function runDueRecurringEntries(now: Date, errors: string[]): Promise<number> {
  const templates = await prisma.recurringEntry.findMany({
    where: { isActive: true },
    include: { lines: true },
  });

  let posted = 0;
  for (const t of templates) {
    try {
      if (t.lines.length === 0) continue;
      if (t.startDate > now) continue;
      if (t.endDate && t.endDate < now) continue;
      if (now.getDate() < t.dayOfMonth) continue; // not due yet this month
      if (t.lastRunDate && sameMonth(t.lastRunDate, now)) continue; // already ran (auto or manual)

      await prisma.$transaction(async (tx) => {
        const entry = await postJournalEntry(tx, {
          date: now,
          description: t.description,
          sourceType: JournalSource.RECURRING,
          sourceId: t.id,
          createdById: t.createdById ?? null,
          lines: t.lines.map((l) => ({
            accountId: l.accountId,
            costCenterId: l.costCenterId,
            debit: Number(l.debit),
            credit: Number(l.credit),
            description: l.description,
          })),
        });
        await tx.recurringEntry.update({ where: { id: t.id }, data: { lastRunDate: now } });
        await auditCron('auto-post', 'RECURRING', `قيد متكرر «${t.description}» → ${entry.entryNo}`);
      });
      posted++;
    } catch (err: any) {
      errors.push(`قيد متكرر #${t.id} (${t.description}): ${err?.message ?? 'خطأ غير معروف'}`);
    }
  }
  return posted;
}

// ── Job 2: monthly straight-line depreciation ─────────────────────────────────

export async function runMonthlyDepreciation(
  now: Date,
  errors: string[],
  opts: { minDay?: number } = {},
): Promise<number> {
  const minDay = opts.minDay ?? 28;
  if (now.getDate() < minDay) return 0; // only near month-end

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const assets = await prisma.fixedAsset.findMany({ where: { status: 'ACTIVE' } });

  let posted = 0;
  for (const asset of assets) {
    try {
      // never in the purchase month — the first depreciation belongs to the next month
      if (sameMonth(asset.purchaseDate, now)) continue;

      const cost = Number(asset.purchaseCost);
      const salvage = Number(asset.salvageValue);
      const monthlyDep = (cost - salvage) / asset.usefulLifeMonths;
      const currentBook = Number(asset.bookValue);
      const actualDep = round2(Math.min(monthlyDep, Math.max(0, currentBook - salvage)));
      if (actualDep <= 0) continue; // fully depreciated

      // once per calendar month — a manual run from the assets screen counts too.
      // The purchase entry shares sourceType DEPRECIATION, so match on the
      // depreciation description prefix.
      const already = await prisma.journalEntry.findFirst({
        where: {
          sourceType: JournalSource.DEPRECIATION,
          sourceId: asset.id,
          date: { gte: monthStart },
          description: { startsWith: 'إهلاك شهري' },
        },
        select: { id: true },
      });
      if (already) continue;

      await prisma.$transaction(async (tx) => {
        await tx.fixedAsset.update({
          where: { id: asset.id },
          data: {
            accumulatedDepreciation: { increment: new Prisma.Decimal(actualDep) },
            bookValue: { decrement: new Prisma.Decimal(actualDep) },
          },
        });
        const entry = await postJournalEntry(tx, {
          date: now,
          description: `إهلاك شهري — ${asset.assetCode} ${asset.nameAr}`,
          sourceType: JournalSource.DEPRECIATION,
          sourceId: asset.id,
          createdById: null,
          lines: [
            { accountCode: ACCT.DEPRECIATION_EXP, debit: actualDep, credit: 0, description: `مصروف إهلاك: ${asset.nameAr}` },
            { accountCode: ACCT.ACC_DEPRECIATION, debit: 0, credit: actualDep, description: `مجمع الإهلاك: ${asset.nameAr}` },
          ],
        });
        await auditCron('auto-depreciate', 'DEPRECIATION', `إهلاك ${asset.assetCode} بمبلغ ${actualDep} → ${entry.entryNo}`);
      });
      posted++;
    } catch (err: any) {
      errors.push(`إهلاك الأصل ${asset.assetCode}: ${err?.message ?? 'خطأ غير معروف'}`);
    }
  }
  return posted;
}

// ── Orchestration ─────────────────────────────────────────────────────────────

export async function runScheduledJobs(opts: { minDepreciationDay?: number } = {}): Promise<JobRunResult> {
  const now = new Date();
  const result: JobRunResult = { ranAt: now, recurringPosted: 0, depreciationPosted: 0, errors: [] };

  if (running) {
    result.errors.push('تشغيل سابق ما يزال قيد التنفيذ');
    return result;
  }
  running = true;
  try {
    if (!(await isSchedulerEnabled())) {
      result.errors.push('المجدول التلقائي معطّل من الإعدادات (schedulerEnabled)');
      return result;
    }
    result.recurringPosted = await runDueRecurringEntries(now, result.errors);
    result.depreciationPosted = await runMonthlyDepreciation(now, result.errors, { minDay: opts.minDepreciationDay });
  } finally {
    running = false;
    lastRun = result;
  }
  return result;
}

const HOUR_MS = 60 * 60 * 1000;

/** Start the hourly tick. First run happens shortly after boot. */
export function startScheduler(): void {
  const tick = () => {
    runScheduledJobs()
      .then((r) => {
        if (r.recurringPosted || r.depreciationPosted || r.errors.length) {
          console.log(
            `⏰ المجدول التلقائي: قيود متكررة ${r.recurringPosted} · إهلاك ${r.depreciationPosted}` +
            (r.errors.length ? ` · أخطاء: ${r.errors.join(' | ')}` : ''),
          );
        }
      })
      .catch((err) => console.error('⏰ فشل تشغيل المجدول التلقائي:', err));
  };
  setTimeout(tick, 15_000); // shortly after boot
  setInterval(tick, HOUR_MS);
}
