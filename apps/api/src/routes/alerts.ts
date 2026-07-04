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
      prisma.customer.findMany({
        where: { creditLimit: { gt: 0 } },
        select: { currentBalance: true, creditLimit: true },
      }),
    ]);

    const overLimitCustomersCount = customers.filter(
      (c) => Number(c.currentBalance) > Number(c.creditLimit),
    ).length;

    const total = lowStockCount + unpaidSalesCount + pendingPurchasesCount + pendingApprovalsCount + myRejectedEntriesCount + overLimitCustomersCount + expiringProductsCount;

    res.json({
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
