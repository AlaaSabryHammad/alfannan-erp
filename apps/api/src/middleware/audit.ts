/**
 * Audit middleware — سجل التدقيق
 *
 * For every non-GET request to /api/* (except /api/auth/login) we write an
 * AuditLog row AFTER the response finishes.  Uses res.on('finish') so it
 * never blocks or throws into the request pipeline.
 *
 * req.user is set by requireAuth inside each router, which runs BEFORE the
 * route handler.  Because we capture inside 'finish' (not synchronously at
 * request start), req.user is already populated by the time we read it.
 */

import { Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';

/** Map method + path prefix → friendly Arabic action label */
function deriveAction(method: string, path: string): { action: string; entity: string } {
  const seg = path.replace(/^\/api\//, '').split('/');
  const resource = seg[0] ?? '';
  const hasId = seg.length > 1;

  const resourceMap: Record<string, string> = {
    'products':          'الأصناف',
    'departments':       'الأقسام',
    'brands':            'العلامات التجارية',
    'units':             'وحدات القياس',
    'warehouses':        'المستودعات',
    'stock':             'المخزون',
    'customers':         'العملاء',
    'sales-invoices':    'فواتير البيع',
    'suppliers':         'الموردين',
    'purchase-invoices': 'فواتير الشراء',
    'accounts':          'الحسابات',
    'partners':          'الشركاء',
    'stock-transfers':   'تحويلات المخزون',
    'users':             'المستخدمين',
    'roles':             'الأدوار',
    'journal':           'اليومية',
    'expenses':          'المصروفات',
    'settings':          'الإعدادات',
    'audit-logs':        'سجل التدقيق',
    'auth':              'المصادقة',
  };

  const entity = resourceMap[resource] ?? resource;

  let action: string;
  switch (method.toUpperCase()) {
    case 'POST':   action = hasId ? 'تحديث' : 'إضافة';  break;
    case 'PUT':
    case 'PATCH':  action = 'تعديل'; break;
    case 'DELETE': action = 'حذف';   break;
    default:       action = method;
  }

  return { action, entity };
}

export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Use originalUrl for accurate path (req.path is sub-router relative)
  const fullPath = req.originalUrl.split('?')[0]; // strip query string

  // Only audit non-GET requests to /api/*
  if (
    req.method.toUpperCase() === 'GET' ||
    !fullPath.startsWith('/api/') ||
    fullPath === '/api/auth/login'
  ) {
    next();
    return;
  }

  res.on('finish', () => {
    // Fire-and-forget — must not throw
    try {
      const user = req.user;
      const { action, entity } = deriveAction(req.method, fullPath);

      prisma.auditLog.create({
        data: {
          userId:     user?.userId  ?? null,
          userName:   user?.email   ?? null,
          method:     req.method,
          path:       fullPath,
          action,
          entity,
          statusCode: res.statusCode,
          ip:         req.ip ?? null,
        },
      }).catch(() => {
        // Silently swallow DB errors — audit must never affect the response
      });
    } catch {
      // Silently swallow any synchronous errors
    }
  });

  next();
}
