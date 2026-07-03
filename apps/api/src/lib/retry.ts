/**
 * إعادة المحاولة عند تصادم الترقيم — Retry on unique-constraint collision
 *
 * Document numbers (INV-, PO-, RV-, JE-…) are generated as max+1 inside the
 * transaction. Two requests in the same millisecond can compute the same next
 * number; the DB's unique index rejects the loser with Prisma error P2002.
 * That's a transient, safe-to-retry condition: re-running regenerates a fresh
 * number. This wraps such an operation and retries a few times before giving up.
 */
import { Prisma } from '@prisma/client';

function isUniqueCollision(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export async function runWithRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isUniqueCollision(err) || attempt === maxAttempts) throw err;
      lastErr = err;
      // brief jittered backoff so the retriers don't collide again in lockstep
      await new Promise((r) => setTimeout(r, 15 * attempt + Math.floor(Math.random() * 20)));
    }
  }
  throw lastErr;
}
