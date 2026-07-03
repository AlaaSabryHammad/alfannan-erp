/**
 * حماية من محاولات الدخول المتكررة — Login throttle
 *
 * Account-based lockout (keyed by email, not IP) so a shared office IP behind
 * one NAT never locks out the whole office. After MAX_FAILURES failed attempts
 * for an email within WINDOW, that account is locked for LOCK_DURATION. A
 * successful login clears the counter. In-memory (no external dependency),
 * matching the in-process scheduler; state resets on server restart, which is
 * acceptable — a restart is not an attack vector.
 */

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;      // failures older than this don't count
const LOCK_DURATION_MS = 15 * 60 * 1000;

interface Attempt {
  failures: number[];   // timestamps of recent failures
  lockedUntil: number;  // epoch ms, 0 = not locked
}

const attempts = new Map<string, Attempt>();

function key(email: string): string {
  return email.trim().toLowerCase();
}

/** Remaining lock time in seconds, or 0 if the account may attempt a login. */
export function lockRemainingSeconds(email: string): number {
  const a = attempts.get(key(email));
  if (!a) return 0;
  const now = Date.now();
  if (a.lockedUntil > now) return Math.ceil((a.lockedUntil - now) / 1000);
  return 0;
}

/** Record a failed login. Returns the resulting lock time in seconds (0 if not locked). */
export function recordFailure(email: string): number {
  const k = key(email);
  const now = Date.now();
  const a = attempts.get(k) ?? { failures: [], lockedUntil: 0 };

  // drop failures outside the sliding window
  a.failures = a.failures.filter((t) => now - t < WINDOW_MS);
  a.failures.push(now);

  if (a.failures.length >= MAX_FAILURES) {
    a.lockedUntil = now + LOCK_DURATION_MS;
    a.failures = []; // reset the window; the lock itself now gates attempts
  }
  attempts.set(k, a);
  return a.lockedUntil > now ? Math.ceil((a.lockedUntil - now) / 1000) : 0;
}

/** Clear the counter after a successful login. */
export function recordSuccess(email: string): void {
  attempts.delete(key(email));
}

/** Test-only: wipe all throttle state. */
export function _resetThrottle(): void {
  attempts.clear();
}
