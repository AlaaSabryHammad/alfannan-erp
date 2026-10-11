import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api';

/** Separate token + client: the platform console is not a tenant session. */
export const PLATFORM_TOKEN_KEY = 'platform_token';
export const PLATFORM_ADMIN_KEY = 'platform_admin';

export const platformApi = axios.create({
  baseURL: `${API_BASE}/platform`,
  headers: { 'Content-Type': 'application/json' },
});

platformApi.interceptors.request.use((config) => {
  const token = localStorage.getItem(PLATFORM_TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

platformApi.interceptors.response.use(
  (r) => r,
  (error) => {
    const isLogin = String(error.config?.url ?? '').includes('/auth/login');
    if (error.response?.status === 401 && !isLogin) {
      localStorage.removeItem(PLATFORM_TOKEN_KEY);
      localStorage.removeItem(PLATFORM_ADMIN_KEY);
      if (window.location.pathname !== '/platform/login') window.location.href = '/platform/login';
    }
    return Promise.reject(error);
  },
);

export interface PlatformUsage {
  users: number;
  products: number;
  customers: number;
  salesInvoices: number;
  journalEntries: number;
  invoicesLast30Days: number;
  salesLast30Days: number;
  lastActivityAt: string | null;
}

export interface PlatformTenant {
  id: number;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  usage: PlatformUsage;
  subscription: PlatformSubscription | null;
}

export interface PlatformTenantDetail extends PlatformTenant {
  payments: PlatformPayment[];
  users: Array<{
    id: number;
    name: string;
    email: string;
    isActive: boolean;
    createdAt: string;
    role: { code: string; nameAr: string };
  }>;
}

export interface PlatformStats {
  pendingUpgradeRequests: number;
  revenue: PlatformRevenue;
  tenants: { total: number; active: number; suspended: number; newLast7Days: number; newLast30Days: number };
  users: number;
  signupsByDay: Array<{ date: string; count: number }>;
}

export interface PlatformAuditRow {
  id: number;
  action: string;
  tenantId: number | null;
  detail: string | null;
  createdAt: string;
  admin: { name: string; email: string } | null;
}

// ── plans, subscriptions, payments ───────────────────────────────────────────────

export type LimitKey = 'users' | 'branches' | 'warehouses' | 'products' | 'salesInvoicesPerMonth';
export type FeatureKey = 'zatca' | 'manufacturing' | 'advancedReports';

export const LIMIT_LABELS: Record<LimitKey, string> = {
  users: 'المستخدمون',
  branches: 'الفروع',
  warehouses: 'المستودعات',
  products: 'الأصناف',
  salesInvoicesPerMonth: 'فواتير البيع / شهر',
};

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  zatca: 'الفوترة الإلكترونية (ZATCA)',
  manufacturing: 'التصنيع',
  advancedReports: 'التقارير المتقدمة',
};

export interface PlatformPlan {
  id: number;
  code: string;
  nameAr: string;
  priceMonthly: number | string;
  priceYearly: number | string;
  currency: string;
  trialDays: number;
  limits: Record<LimitKey, number | null>;
  features: Record<FeatureKey, boolean>;
  isActive: boolean;
  sortOrder: number;
  subscribers: number;
}

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'CANCELED';

export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  TRIALING: 'تجربة',
  ACTIVE: 'مشترك',
  PAST_DUE: 'متأخر (سماح)',
  EXPIRED: 'منتهٍ',
  CANCELED: 'ملغى',
};

export interface PlatformSubscription {
  planId: number;
  planCode: string;
  planName: string;
  priceMonthly: number;
  status: SubscriptionStatus;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  daysLeft: number | null;
  limitOverrides: Partial<Record<LimitKey, number | null>> | null;
  featureOverrides: Partial<Record<FeatureKey, boolean>> | null;
  notes: string | null;
}

export interface PlatformPayment {
  id: number;
  tenantId: number;
  tenantName?: string;
  planId: number;
  amount: number;
  currency: string;
  method: string;
  reference: string | null;
  months: number;
  periodStart: string;
  periodEnd: string;
  note: string | null;
  recordedByName: string | null;
  createdAt: string;
}

export interface PlatformRevenue {
  mrr: number;
  payingTenants: number;
  trialingTenants: number;
  paidLast30Days: number;
  attention: Array<{
    tenantId: number;
    name: string;
    planName: string;
    status: SubscriptionStatus;
    endsAt: string | null;
    daysLeft: number | null;
  }>;
}

export interface PlatformPaymentOrder {
  id: number;
  tenantId: number;
  tenantName: string;
  planName: string;
  months: number;
  amount: number;
  currency: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED';
  provider: string;
  providerInvoiceId: string | null;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
}

export interface PlatformUpgradeRequest {
  id: number;
  tenantId: number;
  tenantName: string;
  planName: string;
  message: string | null;
  status: 'PENDING' | 'HANDLED';
  requestedByName: string | null;
  requestedByEmail: string | null;
  createdAt: string;
  handledAt: string | null;
  handledByName: string | null;
}
