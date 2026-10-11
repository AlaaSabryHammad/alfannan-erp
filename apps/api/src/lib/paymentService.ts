/**
 * Online subscription payments — الدفع الإلكتروني للاشتراك
 *
 *   startCheckout     (tenant context)  price from the plan, create the order, ask the gateway for a page
 *   settleOrder       (owner connection) ask the gateway what really happened, then — and only then —
 *                     activate the subscription. Idempotent: the order is claimed with a conditional update.
 *   reconcilePendingOrders                the safety net when a webhook never arrives
 *
 * Nothing the browser or a webhook body says is trusted: the amount is computed here, and "paid" is
 * whatever the gateway's own API answers for our invoice id.
 */
import crypto from 'crypto';
import prisma from './prisma';
import { platformPrisma as db } from './platformPrisma';
import { getProvider, paymentsEnabled } from './payments/provider';
import { applyPaidPeriod } from './subscriptionActions';
import { invalidateEntitlements } from './entitlements';

export const CHECKOUT_MONTHS = [1, 12] as const;
const MIN_AMOUNT_MINOR = 100; // the gateway's minimum: 1.00 SAR

export class CheckoutError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export function publicBaseUrl(): string {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  const firstOrigin = (process.env.CORS_ORIGIN ?? '').split(',')[0]?.trim();
  return (firstOrigin || 'http://localhost:5173').replace(/\/+$/, '');
}

// ── callback authenticity ─────────────────────────────────────────────────────

function callbackKey(): string {
  return `${process.env.JWT_SECRET ?? ''}:payment-callback`;
}

export function callbackSignature(orderId: number): string {
  return crypto.createHmac('sha256', callbackKey()).update(String(orderId)).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function verifyCallbackSignature(orderId: number, signature: string): boolean {
  return safeEqual(callbackSignature(orderId), signature);
}

// ── pricing ───────────────────────────────────────────────────────────────────

/** Plan prices are VAT-inclusive: what the plan says is what the customer pays. */
export function priceFor(plan: { priceMonthly: unknown; priceYearly: unknown }, months: number): number {
  const monthly = Number(plan.priceMonthly);
  const yearly = Number(plan.priceYearly);
  if (months === 12) return yearly > 0 ? yearly : monthly * 12;
  if (months === 1) return monthly;
  throw new CheckoutError('مدة الاشتراك غير مدعومة');
}

// ── checkout ──────────────────────────────────────────────────────────────────

export interface StartCheckoutInput {
  userId: number;
  planId: number;
  months: number;
}

/** Runs inside the tenant's request context (the order row is created as that tenant). */
export async function startCheckout(input: StartCheckoutInput) {
  if (!paymentsEnabled()) throw new CheckoutError('الدفع الإلكتروني غير مفعّل', 503);
  if (!(CHECKOUT_MONTHS as readonly number[]).includes(input.months)) {
    throw new CheckoutError('اختر اشتراكًا شهريًا أو سنويًا');
  }

  const plan = await prisma.plan.findFirst({ where: { id: input.planId, isActive: true, code: { not: 'trial' } } });
  if (!plan) throw new CheckoutError('الباقة غير متاحة');

  const amount = priceFor(plan, input.months);
  const amountMinor = Math.round(amount * 100);
  if (amountMinor < MIN_AMOUNT_MINOR) {
    throw new CheckoutError('هذه الباقة غير قابلة للدفع الإلكتروني — تواصل معنا لإتمام الاشتراك');
  }

  const provider = getProvider();
  const order = await prisma.paymentOrder.create({
    data: {
      planId: plan.id,
      months: input.months,
      amount,
      currency: plan.currency,
      provider: provider.name,
      requestedById: input.userId,
    },
  });

  const base = publicBaseUrl();
  try {
    const checkout = await provider.createCheckout({
      orderId: order.id,
      amountMinor,
      currency: plan.currency,
      description: `اشتراك ${plan.nameAr} — ${input.months === 12 ? 'سنة' : 'شهر'}`,
      successUrl: `${base}/subscription?payment=return&order=${order.id}`,
      backUrl: `${base}/subscription?payment=cancelled&order=${order.id}`,
      callbackUrl: `${base}/api/webhooks/moyasar?order=${order.id}&sig=${callbackSignature(order.id)}`,
      metadata: { orderId: String(order.id), tenantId: String(order.tenantId) },
    });
    await db.paymentOrder.update({
      where: { id: order.id },
      data: { providerInvoiceId: checkout.providerInvoiceId, checkoutUrl: checkout.checkoutUrl },
    });
    return { orderId: order.id, checkoutUrl: checkout.checkoutUrl };
  } catch (err) {
    await db.paymentOrder.update({
      where: { id: order.id },
      data: { status: 'FAILED', failureReason: 'gateway_unavailable' },
    });
    console.error('[payments] createCheckout failed:', err instanceof Error ? err.message : err);
    throw new CheckoutError('تعذّر الاتصال ببوابة الدفع — حاول لاحقًا', 502);
  }
}

// ── settlement ────────────────────────────────────────────────────────────────

export interface SettleResult {
  orderId: number;
  status: string;
  /** true only for the call that actually activated the subscription */
  activated: boolean;
}

export async function settleOrder(orderId: number): Promise<SettleResult | null> {
  const order = await db.paymentOrder.findUnique({ where: { id: orderId } });
  if (!order) return null;
  if (order.status !== 'PENDING') return { orderId, status: order.status, activated: false };
  if (!order.providerInvoiceId) return { orderId, status: order.status, activated: false };

  const provider = getProvider();
  if (provider.name !== order.provider) {
    throw new Error(`order ${orderId} was created with ${order.provider}, but ${provider.name} is configured`);
  }
  const invoice = await provider.fetchInvoice(order.providerInvoiceId);

  if (invoice.status === 'pending') return { orderId, status: 'PENDING', activated: false };

  if (invoice.status !== 'paid') {
    const status = invoice.status === 'expired' ? 'EXPIRED' : 'FAILED';
    await db.paymentOrder.updateMany({
      where: { id: orderId, status: 'PENDING' },
      data: { status, failureReason: invoice.failureReason ?? invoice.status },
    });
    return { orderId, status, activated: false };
  }

  // paid — but is it the payment we asked for?
  const expectedMinor = Math.round(Number(order.amount) * 100);
  if (invoice.amountMinor !== expectedMinor || invoice.currency !== order.currency) {
    await db.paymentOrder.updateMany({
      where: { id: orderId, status: 'PENDING' },
      data: {
        status: 'FAILED',
        failureReason: `amount_mismatch: paid ${invoice.amountMinor} ${invoice.currency}, expected ${expectedMinor} ${order.currency}`,
      },
    });
    console.error(`[payments] order ${orderId}: amount mismatch — needs manual review`);
    return { orderId, status: 'FAILED', activated: false };
  }

  const activated = await db.$transaction(async (tx) => {
    // claim the order: of two concurrent confirmations exactly one wins
    const claim = await tx.paymentOrder.updateMany({
      where: { id: orderId, status: 'PENDING' },
      data: { status: 'PAID', paidAt: new Date(), providerPaymentId: invoice.providerPaymentId },
    });
    if (claim.count !== 1) return false;

    const plan = await tx.plan.findUniqueOrThrow({ where: { id: order.planId } });
    await applyPaidPeriod(tx, {
      tenantId: order.tenantId,
      plan: { id: plan.id, currency: plan.currency },
      months: order.months,
      amount: Number(order.amount),
      method: 'CARD',
      reference: invoice.providerPaymentId ?? order.providerInvoiceId,
      note: `دفع إلكتروني — طلب #${order.id}`,
      recordedByName: 'بوابة الدفع',
    });
    await tx.platformAuditLog.create({
      data: {
        adminId: null,
        action: 'PAYMENT_ONLINE',
        tenantId: order.tenantId,
        detail: `${plan.code} × ${order.months} — ${Number(order.amount)} ${order.currency} (#${order.id})`,
      },
    });
    return true;
  });

  if (activated) invalidateEntitlements(order.tenantId);
  return { orderId, status: 'PAID', activated };
}

// ── reconciliation (webhook never arrived / browser closed) ───────────────────

export interface ReconcileResult {
  checked: number;
  paid: number;
  closed: number;
  errors: string[];
}

export async function reconcilePendingOrders(now: Date = new Date()): Promise<ReconcileResult> {
  const result: ReconcileResult = { checked: 0, paid: 0, closed: 0, errors: [] };
  if (!paymentsEnabled()) return result;

  const olderThan = new Date(now.getTime() - 2 * 60 * 1000);
  const abandonedBefore = new Date(now.getTime() - 24 * 3600 * 1000);
  const pending = await db.paymentOrder.findMany({
    where: { status: 'PENDING', createdAt: { lt: olderThan } },
    select: { id: true, createdAt: true },
    take: 200,
  });

  for (const o of pending) {
    result.checked += 1;
    try {
      const r = await settleOrder(o.id);
      if (r?.activated) result.paid += 1;
      else if (r?.status === 'PENDING' && o.createdAt < abandonedBefore) {
        await db.paymentOrder.updateMany({
          where: { id: o.id, status: 'PENDING' },
          data: { status: 'EXPIRED', failureReason: 'abandoned' },
        });
        result.closed += 1;
      } else if (r && r.status !== 'PENDING') result.closed += 1;
    } catch (err) {
      result.errors.push(`order ${o.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return result;
}
