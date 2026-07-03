/**
 * المجدول التلقائي — تشغيل يدوي وحالة آخر تشغيل
 *
 * POST /api/scheduler/run  — يشغّل المهام المجدولة الآن (settings.edit)
 *                            body اختياري: { minDepreciationDay } لتقديم موعد
 *                            الإهلاك عن اليوم 28 (مفيد للاختبار ونهاية شهر مبكرة)
 * GET  /api/scheduler/status — نتيجة آخر تشغيل (منذ إقلاع الخادم)
 */
import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth';
import { runScheduledJobs, getLastRun } from '../lib/scheduler';

const router = Router();
router.use(requireAuth);

const runSchema = z.object({
  minDepreciationDay: z.number().int().min(1).max(31).optional(),
});

router.post('/run', requirePermission('settings.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = runSchema.parse(req.body ?? {});
    const result = await runScheduledJobs({ minDepreciationDay: body.minDepreciationDay });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/status', requirePermission('settings.edit'), async (_req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ lastRun: getLastRun() });
  } catch (err) {
    next(err);
  }
});

export default router;
