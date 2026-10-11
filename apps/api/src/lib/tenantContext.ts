/**
 * Tenant context — السياق الحالي للشركة (SaaS)
 *
 * The tenant of the current request travels in AsyncLocalStorage so every Prisma call made while
 * handling it (routes, services, transactions) is scoped without threading a parameter through.
 * The Prisma client extension (lib/prisma.ts) reads it to inject/filter `tenantId`.
 *
 * - runWithTenant(id, fn)   — normal path: requireAuth wraps each request, the scheduler wraps each tenant
 * - runUnscoped(fn)         — explicit cross-tenant access (login by e-mail, tenant registration, the
 *                             scheduler's tenant list). Never use it for request-scoped business data.
 * - TENANT_FALLBACK_ID      — set only by the test runner so fixture code that talks to prisma
 *                             directly (outside a request) lands in the seeded tenant.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface TenantStore {
  tenantId: number | null;
  unscoped: boolean;
}

const storage = new AsyncLocalStorage<TenantStore>();

// NOTE: Prisma queries are lazy thenables — they only hit the extension when awaited. The callback is
// therefore awaited *inside* the store, otherwise `runWithTenant(id, () => prisma.x.find())` would
// execute outside the context.
export function runWithTenant<T>(tenantId: number, fn: () => T): Promise<Awaited<T>> {
  return storage.run({ tenantId, unscoped: false }, async () => await fn()) as Promise<Awaited<T>>;
}

export function runUnscoped<T>(fn: () => T): Promise<Awaited<T>> {
  return storage.run({ tenantId: null, unscoped: true }, async () => await fn()) as Promise<Awaited<T>>;
}

/** Synchronous variant for Express middleware: runs `next` with the tenant bound to its async chain. */
export function enterTenant(tenantId: number, next: () => void): void {
  storage.run({ tenantId, unscoped: false }, next);
}

export function isUnscoped(): boolean {
  return storage.getStore()?.unscoped === true;
}

/** Tenant of the current context, or null when there is none (never throws). */
export function tryTenantId(): number | null {
  const store = storage.getStore();
  if (store) return store.tenantId;
  const fallback = process.env.TENANT_FALLBACK_ID;
  return fallback ? Number(fallback) : null;
}

/** Tenant of the current context; throws when called outside of one (fails closed). */
export function currentTenantId(): number {
  const id = tryTenantId();
  if (id == null) throw new Error('لا يوجد سياق شركة (tenant) لهذه العملية');
  return id;
}
