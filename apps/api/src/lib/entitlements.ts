/**
 * Entitlements — صلاحيات الباقة (SaaS)
 *
 * What a company is allowed to do right now, derived from its Subscription + Plan:
 *   - effective status (a trial/period that ran out counts as expired even before a job persists it)
 *   - limits (users, branches, …) — plan limits overridden per company; null = unlimited
 *   - features (zatca, manufacturing, …)
 *   - readOnly: expired/canceled companies can still read and export, but not write
 *
 * Enforcement mode (env SUBSCRIPTION_ENFORCEMENT):
 *   off      — nothing is checked
 *   log      — violations are logged ("would block") but allowed   ← default, for a safe roll-out
 *   enforce  — violations answer HTTP 402
 */
import prisma from './prisma';
import { runWithTenant } from './tenantContext';

export type LimitKey = 'users' | 'branches' | 'warehouses' | 'products' | 'salesInvoicesPerMonth';
export type FeatureKey = 'zatca' | 'manufacturing' | 'advancedReports';
export type EffectiveStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELED';
export type EnforcementMode = 'off' | 'log' | 'enforce';

export const LIMIT_LABELS: Record<LimitKey, string> = {
  users: 'المستخدمين',
  branches: 'الفروع',
  warehouses: 'المستودعات',
  products: 'الأصناف',
  salesInvoicesPerMonth: 'فواتير البيع الشهرية',
};

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  zatca: 'الفوترة الإلكترونية (ZATCA)',
  manufacturing: 'التصنيع وقوائم المكونات',
  advancedReports: 'التقارير المتقدمة',
};

const GRACE_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;
const CACHE_TTL_MS = 30_000;

export interface Entitlements {
  hasSubscription: boolean;
  planCode: string | null;
  planName: string | null;
  status: EffectiveStatus;
  storedStatus: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  /** days until the trial / period ends (negative = already over); null when open-ended */
  daysLeft: number | null;
  readOnly: boolean;
  limits: Record<LimitKey, number | null>;
  features: Record<FeatureKey, boolean>;
}

export function enforcementMode(): EnforcementMode {
  const v = process.env.SUBSCRIPTION_ENFORCEMENT;
  return v === 'off' || v === 'enforce' ? v : 'log';
}

const LIMIT_KEYS = Object.keys(LIMIT_LABELS) as LimitKey[];
const FEATURE_KEYS = Object.keys(FEATURE_LABELS) as FeatureKey[];

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Pure: turns the stored rows into what the company may do at `now`. */
export function computeEntitlements(
  sub: {
    status: string;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    limitOverrides: unknown;
    featureOverrides: unknown;
    plan: { code: string; nameAr: string; limits: unknown; features: unknown };
  } | null,
  now: Date = new Date(),
): Entitlements {
  const noLimits = Object.fromEntries(LIMIT_KEYS.map((k) => [k, 0])) as Record<LimitKey, number | null>;
  const noFeatures = Object.fromEntries(FEATURE_KEYS.map((k) => [k, false])) as Record<FeatureKey, boolean>;

  if (!sub) {
    // No subscription = something went wrong during sign-up; fail closed (read-only, nothing included).
    return {
      hasSubscription: false, planCode: null, planName: null, status: 'EXPIRED', storedStatus: null,
      trialEndsAt: null, currentPeriodEnd: null, daysLeft: null, readOnly: true,
      limits: noLimits, features: noFeatures,
    };
  }

  let status = sub.status as EffectiveStatus;
  const t = now.getTime();
  if (status === 'TRIALING' && sub.trialEndsAt && sub.trialEndsAt.getTime() < t) status = 'EXPIRED';
  if ((status === 'ACTIVE' || status === 'PAST_DUE') && sub.currentPeriodEnd) {
    const end = sub.currentPeriodEnd.getTime();
    if (t > end + GRACE_DAYS * DAY_MS) status = 'EXPIRED';
    else if (t > end) status = 'PAST_DUE';
  }

  const planLimits = asRecord(sub.plan.limits);
  const overrideLimits = asRecord(sub.limitOverrides);
  const limits = {} as Record<LimitKey, number | null>;
  for (const k of LIMIT_KEYS) {
    const raw = k in overrideLimits ? overrideLimits[k] : planLimits[k];
    limits[k] = typeof raw === 'number' ? raw : null; // missing/null = unlimited
  }

  const planFeatures = asRecord(sub.plan.features);
  const overrideFeatures = asRecord(sub.featureOverrides);
  const features = {} as Record<FeatureKey, boolean>;
  for (const k of FEATURE_KEYS) {
    const raw = k in overrideFeatures ? overrideFeatures[k] : planFeatures[k];
    features[k] = raw === true;
  }

  const endsAt = status === 'TRIALING' ? sub.trialEndsAt : sub.currentPeriodEnd;
  return {
    hasSubscription: true,
    planCode: sub.plan.code,
    planName: sub.plan.nameAr,
    status,
    storedStatus: sub.status,
    trialEndsAt: sub.trialEndsAt?.toISOString() ?? null,
    currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
    daysLeft: endsAt ? Math.ceil((endsAt.getTime() - t) / DAY_MS) : null,
    readOnly: status === 'EXPIRED' || status === 'CANCELED',
    limits,
    features,
  };
}

const cache = new Map<number, { value: Entitlements; at: number }>();

export function invalidateEntitlements(tenantId?: number): void {
  if (tenantId === undefined) cache.clear();
  else cache.delete(tenantId);
}

export async function getEntitlements(tenantId: number): Promise<Entitlements> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const sub = await runWithTenant(tenantId, () =>
    prisma.subscription.findFirst({ include: { plan: true } }),
  );
  const value = computeEntitlements(sub);
  cache.set(tenantId, { value, at: Date.now() });
  return value;
}

/** Current usage against each limit (scoped to the tenant of the calling context). */
export async function getUsage(tenantId: number): Promise<Record<LimitKey, number>> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  return runWithTenant(tenantId, async () => {
    const [users, branches, warehouses, products, salesInvoicesPerMonth] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.branch.count({ where: { isActive: true } }),
      prisma.warehouse.count({ where: { isActive: true } }),
      prisma.product.count({ where: { isActive: true } }),
      prisma.salesInvoice.count({ where: { date: { gte: monthStart } } }),
    ]);
    return { users, branches, warehouses, products, salesInvoicesPerMonth };
  });
}

export async function usageFor(tenantId: number, key: LimitKey): Promise<number> {
  return (await getUsage(tenantId))[key];
}
