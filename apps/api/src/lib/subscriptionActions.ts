/**
 * Shared subscription actions (owner connection).
 *
 * One place decides what "a paid period starts or is renewed" means, so a payment recorded by hand in
 * the platform console and a payment confirmed by the gateway behave exactly the same.
 */
import type { Prisma } from '@prisma/client';

export function addMonths(from: Date, months: number): Date {
  const d = new Date(from);
  const day = d.getDate();
  d.setMonth(d.getMonth() + months);
  if (d.getDate() < day) d.setDate(0); // 31 Jan + 1 month -> 28/29 Feb, not 3 Mar
  return d;
}

export interface PaidPeriodInput {
  tenantId: number;
  plan: { id: number; currency: string };
  months: number;
  amount: number;
  method: 'CASH' | 'BANK_TRANSFER' | 'CARD' | 'OTHER';
  reference?: string | null;
  note?: string | null;
  recordedByName?: string | null;
  now?: Date;
}

/**
 * Starts or renews a paid period and records the payment. Renewing before the running period ends
 * adds to it (no lost days). Must run inside a transaction when atomicity with other writes matters.
 */
export async function applyPaidPeriod(tx: Prisma.TransactionClient, input: PaidPeriodInput) {
  const now = input.now ?? new Date();
  const current = await tx.subscription.findUnique({ where: { tenantId: input.tenantId } });
  if (!current) throw new Error('لا يوجد اشتراك لهذه الشركة');

  const stillRunning = current.status === 'ACTIVE' && !!current.currentPeriodEnd && current.currentPeriodEnd > now;
  const periodStart = stillRunning ? current.currentPeriodEnd! : now;
  const periodEnd = addMonths(periodStart, input.months);

  const subscription = await tx.subscription.update({
    where: { tenantId: input.tenantId },
    data: {
      planId: input.plan.id,
      status: 'ACTIVE',
      trialEndsAt: null,
      currentPeriodStart: stillRunning ? current.currentPeriodStart ?? now : now,
      currentPeriodEnd: periodEnd,
    },
  });

  const payment = await tx.subscriptionPayment.create({
    data: {
      tenantId: input.tenantId,
      planId: input.plan.id,
      amount: input.amount,
      currency: input.plan.currency,
      method: input.method,
      reference: input.reference ?? null,
      months: input.months,
      periodStart,
      periodEnd,
      note: input.note ?? null,
      recordedByName: input.recordedByName ?? null,
    },
  });

  return { subscription, payment };
}
