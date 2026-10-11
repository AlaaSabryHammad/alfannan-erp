/**
 * Live session state — حالة الجلسة الحيّة
 *
 * A JWT alone would keep a deactivated user, a demoted role or a stolen token alive for 24h.
 * Every request therefore re-reads (cached for a few seconds) the user's current state:
 *   - isActive: a deactivated user is locked out immediately
 *   - sessionsValidAfter: set on password change/reset; older tokens stop working
 *   - role + permissions: always the current ones, never the ones frozen into the token
 */
import prisma from './prisma';
import { runWithTenant } from './tenantContext';

export interface SessionState {
  isActive: boolean;
  /** epoch ms, or null when no password change has happened */
  sessionsValidAfter: number | null;
  roleCode: string;
  permissions: string[];
}

const TTL_MS = 15_000;
const cache = new Map<string, { value: SessionState | null; at: number }>();
const keyOf = (tenantId: number, userId: number) => `${tenantId}:${userId}`;

export async function getSessionState(tenantId: number, userId: number): Promise<SessionState | null> {
  const k = keyOf(tenantId, userId);
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const user = await runWithTenant(tenantId, () =>
    prisma.user.findFirst({
      where: { id: userId },
      select: {
        isActive: true,
        sessionsValidAfter: true,
        role: {
          select: {
            code: true,
            permissions: { select: { permission: { select: { code: true } } } },
          },
        },
      },
    }),
  );

  const value: SessionState | null = user
    ? {
        isActive: user.isActive,
        sessionsValidAfter: user.sessionsValidAfter ? user.sessionsValidAfter.getTime() : null,
        roleCode: user.role.code,
        permissions: user.role.permissions.map((rp) => rp.permission.code),
      }
    : null;
  cache.set(k, { value, at: Date.now() });
  return value;
}

/** Drop cached state after a user/role change so it takes effect on the very next request. */
export function invalidateUserSessions(tenantId?: number, userId?: number): void {
  if (tenantId !== undefined && userId !== undefined) cache.delete(keyOf(tenantId, userId));
  else cache.clear();
}
