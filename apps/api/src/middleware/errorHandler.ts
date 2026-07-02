import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { PeriodLockedError } from '../lib/ledger';

function isFKViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  // Prisma P2003 / P2014
  if (e.code === 'P2003' || e.code === 'P2014') return true;
  // Postgres error codes surfaced through Prisma ConnectorError in message
  const msg = typeof e.message === 'string' ? e.message : '';
  if (msg.includes('23001') || msg.includes('23503') || msg.includes('foreign key') || msg.includes('violates')) return true;
  return false;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'بيانات غير صالحة',
      details: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
    });
    return;
  }

  if (isFKViolation(err)) {
    res.status(400).json({ error: 'لا يمكن الحذف لارتباطه بسجلات أخرى' });
    return;
  }

  // Posting/deleting a document dated inside a locked fiscal period — a user
  // decision problem, not a server fault, so surface the Arabic message as 400.
  if (err instanceof PeriodLockedError) {
    res.status(400).json({ error: err.message });
    return;
  }

  if (err instanceof Error) {
    console.error('[API Error]', err.message);
    res.status(500).json({ error: 'خطأ في الخادم', message: err.message });
    return;
  }

  res.status(500).json({ error: 'خطأ غير متوقع في الخادم' });
}
