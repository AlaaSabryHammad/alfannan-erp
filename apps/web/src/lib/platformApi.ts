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
}

export interface PlatformTenantDetail extends PlatformTenant {
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
