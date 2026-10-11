/**
 * Alerts summary — لوحة تنبيهات موحدة
 *
 * GET /api/alerts/summary — lightweight counts (not full detail) across the
 * system used for the notification bell badge and the alerts page header KPIs.
 */

import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

const LOW_STOCK_THRESHOLD = 10;
const EXPIRY_WARNING_DAYS = 30;

router.get('/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.userId;

    // «تفعيل الإشعارات» off → the bell counter shows nothing. The detailed
    // alerts page and the underlying data are untouched.
    const notif = await prisma.setting.findUnique({ where: { key: 'enableNotifications' } });
    if (notif?.value === 'false') {
      res.json({
        enabled: false,
        lowStockCount: 0,
        unpaidSalesCount: 0,
        pendingPurchasesCount: 0,
        pendingApprovalsCount: 0,
        myRejectedEntriesCount: 0,
        overLimitCustomersCount: 0,
        expiringProductsCount: 0,
        total: 0,
      });
      return;
    }

    const expiryCutoff = new Date();
    expiryCutoff.setDate(expiryCutoff.getDate() + EXPIRY_WARNING_DAYS);

    const [lowStockCount, unpaidSalesCount, pendingPurchasesCount, pendingApprovalsCount, myRejectedEntriesCount, expiringProductsCount, customers] = await Promise.all([
      prisma.stockBalance.count({ where: { quantity: { lt: LOW_STOCK_THRESHOLD } } }),
      prisma.salesInvoice.count({ where: { paidStatus: { not: 'PAID' } } }),
      prisma.purchaseInvoice.count({ where: { receiveStatus: 'PENDING' } }),
      prisma.journalEntryApproval.count({ where: { status: 'PENDING' } }),
      // my own journal entries that were rejected and are waiting for me to fix/resubmit
      prisma.journalEntryApproval.count({ where: { status: 'REJECTED', createdById: userId } }),
      prisma.product.count({ where: { expiryDate: { not: null, lte: expiryCutoff } } }),
      // Any customer owing money counts as over limit when the balance exceeds
      // the limit — a limit of 0 (cash-only) means any balance is over it.
      prisma.customer.findMany({
        where: { currentBalance: { gt: 0 } },
        select: { currentBalance: true, creditLimit: true },
      }),
    ]);

    const overLimitCustomersCount = customers.filter(
      (c) => Number(c.currentBalance) > Number(c.creditLimit),
    ).length;

    const total = lowStockCount + unpaidSalesCount + pendingPurchasesCount + pendingApprovalsCount + myRejectedEntriesCount + overLimitCustomersCount + expiringProductsCount;

    res.json({
      enabled: true,
      lowStockCount,
      unpaidSalesCount,
      pendingPurchasesCount,
      pendingApprovalsCount,
      myRejectedEntriesCount,
      overLimitCustomersCount,
      expiringProductsCount,
      total,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
