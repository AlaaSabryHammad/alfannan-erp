import { useQuery } from '@tanstack/react-query';
import apiClient from '../lib/api';

export type LimitKey = 'users' | 'branches' | 'warehouses' | 'products' | 'salesInvoicesPerMonth';
export type FeatureKey = 'zatca' | 'manufacturing' | 'advancedReports';
export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELED';

export interface SubscriptionInfo {
  hasSubscription: boolean;
  planCode: string | null;
  planName: string | null;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  daysLeft: number | null;
  readOnly: boolean;
  limits: Record<LimitKey, number | null>;
  features: Record<FeatureKey, boolean>;
  usage: Record<LimitKey, number>;
  enforcement: 'off' | 'log' | 'enforce';
  /** online checkout is configured on the server */
  paymentsEnabled: boolean;
}

export const LIMIT_LABELS: Record<LimitKey, string> = {
  users: 'المستخدمون',
  branches: 'الفروع',
  warehouses: 'المستودعات',
  products: 'الأصناف',
  salesInvoicesPerMonth: 'فواتير البيع هذا الشهر',
};

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  zatca: 'الفوترة الإلكترونية (ZATCA)',
  manufacturing: 'التصنيع وقوائم المكونات',
  advancedReports: 'التقارير المتقدمة',
};

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  TRIALING: 'فترة تجريبية',
  ACTIVE: 'اشتراك فعّال',
  PAST_DUE: 'متأخر — فترة سماح',
  EXPIRED: 'منتهٍ',
  CANCELED: 'ملغى',
};

/** Arabic day count: يوم / يومين / 3 أيام / 12 يومًا */
export function daysLabel(n: number): string {
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومين';
  if (n >= 3 && n <= 10) return `${n} أيام`;
  return `${n} يومًا`;
}

export function useSubscription() {
  return useQuery({
    queryKey: ['subscription'],
    staleTime: 60_000,
    queryFn: async () => (await apiClient.get<SubscriptionInfo>('/subscription')).data,
  });
}
