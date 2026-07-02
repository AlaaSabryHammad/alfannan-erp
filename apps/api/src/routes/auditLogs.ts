/**
 * Audit log route — سجل التدقيق
 *
 * GET /api/audit-logs   requirePermission('users.view')
 *   Query params (all optional):
 *     page, pageSize   — pagination
 *     from, to         — YYYY-MM-DD range on createdAt
 *     userId           — filter by userId (number)
 */

import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { parseDateRange } from '../lib/dateRange';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('users.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, skip } = getPagination(req);

    const dateRange = parseDateRange(
      req.query.from as string | undefined,
      req.query.to   as string | undefined,
    );

    const userIdRaw = req.query.userId ? parseInt(req.query.userId as string, 10) : undefined;
    const userId    = userIdRaw && !Number.isNaN(userIdRaw) ? userIdRaw : undefined;

    const where: Record<string, unknown> = {};
    if (dateRange)  where.createdAt = dateRange;
    if (userId)     where.userId    = userId;

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

export default router;
