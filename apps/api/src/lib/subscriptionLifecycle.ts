/**
 * Subscription lifecycle — الدورة التلقائية للاشتراكات
 *
 * Runs from the in-process scheduler (hourly tick) and on demand from the platform console.
 * Entitlements are already *derived* from the dates at read time, so nothing is blocked late;
 * this job makes the stored state match reality and leaves a trail for the platform owner:
 *
 *   TRIALING  --trial ended-----------------> EXPIRED
 *   ACTIVE    --period ended---------------> PAST_DUE   (7-day grace)
 *   ACTIVE / PAST_DUE --grace over---------> EXPIRED
 *   reminders at 7 / 3 / 1 days before a trial or period ends (once each, recorded in the audit log)
 *
 * Idempotent: running it twice (or from two replicas) changes nothing the second time.
 * Uses the owner connection — the tenant application role cannot modify subscriptions.
 */
import { platformPrisma as db } from './platformPrisma';
import { invalidateEntitlements } from './entitlements';

const DAY = 24 * 3600 * 1000;
const GRACE_DAYS = 7;
const MILESTONES = [1, 3, 7];

export interface LifecycleResult {
  ranAt: string;
  trialsExpired: number;
  movedToPastDue: number;
  expired: number;
  reminders: number;
  errors: string[];
}

let lastResult: LifecycleResult | null = null;
export const getLastLifecycleResult = () => lastResult;

async function record(action: string, tenantId: number, detail: string): Promise<void> {
  await db.platformAuditLog.create({ data: { adminId: null, action, tenantId, detail } });
}

export async function runSubscriptionLifecycle(now: Date = new Date()): Promise<LifecycleResult> {
  const result: LifecycleResult = {
    ranAt: now.toISOString(), trialsExpired: 0, movedToPastDue: 0, expired: 0, reminders: 0, errors: [],
  };
  const graceCutoff = new Date(now.getTime() - GRACE_DAYS * DAY);
  const touched = new Set<number>();

  const step = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      result.errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // 1. trials that ran out
  await step('trials', async () => {
    const rows = await db.subscription.findMany({
      where: { status: 'TRIALING', trialEndsAt: { lt: now } },
      select: { tenantId: true },
    });
    for (const r of rows) {
      await db.subscription.update({ where: { tenantId: r.tenantId }, data: { status: 'EXPIRED' } });
      await record('SUB_AUTO_EXPIRE', r.tenantId, 'انتهت الفترة التجريبية');
      touched.add(r.tenantId);
      result.trialsExpired += 1;
    }
  });

  // 2. paid periods well past the grace window → expired (also catches a long outage of this job)
  await step('expire', async () => {
    const rows = await db.subscription.findMany({
      where: { status: { in: ['ACTIVE', 'PAST_DUE'] }, currentPeriodEnd: { lt: graceCutoff } },
      select: { tenantId: true },
    });
    for (const r of rows) {
      await db.subscription.update({ where: { tenantId: r.tenantId }, data: { status: 'EXPIRED' } });
      await record('SUB_AUTO_EXPIRE', r.tenantId, 'انتهت فترة السماح دون تجديد');
      touched.add(r.tenantId);
      result.expired += 1;
    }
  });

  // 3. paid periods that just ended → grace period
  await step('past-due', async () => {
    const rows = await db.subscription.findMany({
      where: { status: 'ACTIVE', currentPeriodEnd: { lt: now } },
      select: { tenantId: true },
    });
    for (const r of rows) {
      await db.subscription.update({ where: { tenantId: r.tenantId }, data: { status: 'PAST_DUE' } });
      await record('SUB_AUTO_PAST_DUE', r.tenantId, 'انتهت الفترة — بدأت فترة السماح (7 أيام)');
      touched.add(r.tenantId);
      result.movedToPastDue += 1;
    }
  });

  // 4. reminders before the end (7 / 3 / 1 days), once per milestone and period
  await step('reminders', async () => {
    const horizon = new Date(now.getTime() + 7 * DAY);
    const rows = await db.subscription.findMany({
      where: {
        OR: [
          { status: 'TRIALING', trialEndsAt: { gte: now, lte: horizon } },
          { status: 'ACTIVE', currentPeriodEnd: { gte: now, lte: horizon } },
        ],
      },
      select: { tenantId: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
    });
    for (const r of rows) {
      const endsAt = r.status === 'TRIALING' ? r.trialEndsAt! : r.currentPeriodEnd!;
      const daysLeft = Math.ceil((endsAt.getTime() - now.getTime()) / DAY);
      const milestone = MILESTONES.find((m) => daysLeft <= m);
      if (milestone === undefined) continue;

      const kind = r.status === 'TRIALING' ? 'trial' : 'period';
      const key = `${kind}:${endsAt.toISOString().slice(0, 10)}:${milestone}`;
      const already = await db.platformAuditLog.findFirst({
        where: { action: 'SUB_REMINDER', tenantId: r.tenantId, detail: { startsWith: key } },
        select: { id: true },
      });
      if (already) continue;

      const what = kind === 'trial' ? 'تنتهي الفترة التجريبية' : 'ينتهي الاشتراك';
      await record('SUB_REMINDER', r.tenantId, `${key} — ${what} خلال ${daysLeft} يوم`);
      result.reminders += 1;
    }
  });

  for (const id of touched) invalidateEntitlements(id);
  lastResult = result;
  return result;
}
