import { Router, Request, Response, NextFunction } from 'express';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { parseDateRange } from '../lib/dateRange';

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('dashboard.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // Optional date-range filter: when provided, KPI aggregations are scoped to the range.
    const dateRange = parseDateRange(
      req.query.from as string | undefined,
      req.query.to   as string | undefined,
    );

    // Optional branch filter: document figures scope by branchId, stock figures
    // by the warehouses belonging to that branch. Expenses and receivables are
    // company-wide (not branch-attributable in the schema).
    const branchId = req.query.branchId ? parseInt(req.query.branchId as string) : undefined;
    const branchWarehouseIds = branchId
      ? (await prisma.warehouse.findMany({ where: { branchId }, select: { id: true } })).map((w) => w.id)
      : undefined;

    const dateWhere = {
      ...(dateRange ? { date: dateRange } : {}),
      ...(branchId ? { branchId } : {}),
    };
    const stockWhere = branchWarehouseIds ? { warehouseId: { in: branchWarehouseIds } } : {};

    // ── Net Sales (filtered or all-time)
    const salesAgg = await prisma.salesInvoice.aggregate({ where: dateWhere, _sum: { total: true } });
    const netSales = Number(salesAgg._sum.total ?? 0);

    // ── Inventory valuation (costPrice * totalQty per product) — always all-time
    const stockBalances = await prisma.stockBalance.findMany({
      where: stockWhere,
      include: { product: { select: { costPrice: true } } },
    });
    const inventoryValuation = stockBalances.reduce(
      (sum, sb) => sum + Number(sb.quantity) * Number(sb.product.costPrice),
      0
    );

    // ── Total item quantity
    const totalItemQty = stockBalances.reduce((sum, sb) => sum + Number(sb.quantity), 0);

    // ── Low-stock count (less than 10 units in any warehouse)
    const lowStockItems = stockBalances.filter(sb => Number(sb.quantity) < 10);
    const lowStockCount = lowStockItems.length;

    // ── Low-stock list (unique products)
    const lowStockProductIds = [...new Set(lowStockItems.map(sb => sb.productId))];
    const lowStockProducts = await prisma.product.findMany({
      where: { id: { in: lowStockProductIds } },
      include: {
        unit: true,
        stockBalances: { include: { warehouse: true } },
        brand: true,
      },
    });

    // ── Monthly sales + purchases series (current year — always year-scoped for chart)
    const [monthlyInvoices, monthlyPurchaseInvoices] = await Promise.all([
      prisma.salesInvoice.findMany({
        where: { date: { gte: startOfYear }, ...(branchId ? { branchId } : {}) },
        select: { date: true, total: true },
      }),
      prisma.purchaseInvoice.findMany({
        where: { date: { gte: startOfYear }, ...(branchId ? { branchId } : {}) },
        select: { date: true, total: true },
      }),
    ]);

    const monthlySales: Record<number, number> = {};
    const monthlyPurchases: Record<number, number> = {};
    for (let m = 1; m <= 12; m++) {
      monthlySales[m] = 0;
      monthlyPurchases[m] = 0;
    }
    for (const inv of monthlyInvoices) {
      const month = inv.date.getMonth() + 1;
      monthlySales[month] = (monthlySales[month] || 0) + Number(inv.total);
    }
    for (const po of monthlyPurchaseInvoices) {
      const month = po.date.getMonth() + 1;
      monthlyPurchases[month] = (monthlyPurchases[month] || 0) + Number(po.total);
    }

    const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                        'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    const chartSeries = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      monthName: monthNames[i],
      sales: monthlySales[i + 1],
      purchases: monthlyPurchases[i + 1],
    }));

    // ── Recent movements (last 10, not date-filtered — always show latest activity)
    const recentMovements = await prisma.stockMovement.findMany({
      where: stockWhere,
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        product: { select: { id: true, nameAr: true, sku: true } },
        warehouse: { select: { id: true, nameAr: true } },
        createdBy: { select: { id: true, name: true } },
      },
    });

    // ── Recent invoices (last 10, date-filtered when range is provided)
    const recentInvoices = await prisma.salesInvoice.findMany({
      where: dateWhere,
      orderBy: { date: 'desc' },
      take: 10,
      include: {
        customer: { select: { id: true, nameAr: true, company: true } },
        cashier: { select: { id: true, name: true } },
      },
    });

    // ── Purchases + expenses within range
    const [purchasesAgg, expensesAgg] = await Promise.all([
      prisma.purchaseInvoice.aggregate({ where: { ...dateWhere }, _sum: { total: true } }),
      prisma.expense.aggregate({
        where: dateRange ? { date: dateRange } : {},
        _sum: { amount: true },
      }),
    ]);
    const purchases = Number(purchasesAgg._sum.total ?? 0);
    const expenses  = Number(expensesAgg._sum.amount ?? 0);

    // Receivables are always all-time (balance sheet concept)
    const customerAgg = await prisma.customer.aggregate({ _sum: { currentBalance: true } });
    const totalReceivables = Number(customerAgg._sum.currentBalance ?? 0);

    // COGS estimate for the range: sum of (qty * costPrice) for sold items within range
    const soldItemsWhere = (dateRange || branchId)
      ? { invoice: { ...(dateRange ? { date: dateRange } : {}), ...(branchId ? { branchId } : {}) } }
      : {};
    const soldItems = await prisma.salesInvoiceItem.findMany({
      where: soldItemsWhere,
      include: { product: { select: { costPrice: true } } },
    });
    const cogs = soldItems.reduce(
      (sum, item) => sum + Number(item.qty) * Number(item.product.costPrice),
      0
    );
    const grossProfit = netSales - cogs;
    const netProfit = grossProfit - expenses;

    res.json({
      kpis: {
        netSales,
        purchases,
        expenses,
        netProfit,
        cashLiquidity: netSales - totalReceivables,
        inventoryValuation,
        totalItemQty,
        lowStockCount,
        totalReceivables,
      },
      chartSeries,
      recentMovements,
      recentInvoices,
      lowStockList: lowStockProducts,
    });
  } catch (err) {
    next(err);
  }
});

export default router;
