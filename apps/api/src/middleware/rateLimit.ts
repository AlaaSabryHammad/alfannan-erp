/**
 * Per-IP rate limiting — تحديد معدّل الطلبات
 *
 * In-memory sliding window, enough for a single API instance (same trade-off as loginThrottle).
 * Behind nginx/Tailscale `req.ip` is the real client because the app sets `trust proxy`.
 * Disabled under NODE_ENV=test unless RATE_LIMIT_ENABLED=true (the suite logs in hundreds of times
 * from one address).
 */
import { Request, Response, NextFunction } from 'express';

interface Options {
  /** namespace so different endpoints keep separate counters */
  name: string;
  windowMs: number;
  max: number;
  message?: string;
}

const hits = new Map<string, number[]>();

function enabled(): boolean {
  if (process.env.RATE_LIMIT_ENABLED === 'true') return true;
  if (process.env.RATE_LIMIT_ENABLED === 'false') return false;
  return process.env.NODE_ENV !== 'test';
}

export function rateLimit({ name, windowMs, max, message }: Options) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!enabled()) {
      next();
      return;
    }
    const key = `${name}:${req.ip ?? 'unknown'}`;
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      const retryAfter = Math.ceil((windowMs - (now - recent[0])) / 1000);
      hits.set(key, recent);
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: message ?? 'طلبات كثيرة — حاول لاحقًا' });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

/** Test helper: forget every counter. */
export function _resetRateLimits(): void {
  hits.clear();
}

// keep the map from growing forever
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [k, ts] of hits) {
    const recent = ts.filter((t) => t > cutoff);
    if (recent.length === 0) hits.delete(k);
    else hits.set(k, recent);
  }
}, 10 * 60 * 1000).unref();
