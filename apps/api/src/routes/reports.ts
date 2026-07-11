import { Router, Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';

const router = Router();
router.use(requireAuth);
router.use(requirePermission('reports.view'));

// GET /api/reports/control-reconciliation — تسوية الدفتر المساعد مع الأستاذ العام
// Compares the customer/supplier subledger totals against the AR (3000) / AP
// (2000) control-account balances in the GL. They should always match now that
// opening balances post entries and manual postings to control accounts are
// blocked; any residual difference flags legacy data that needs correcting.
router.get('/control-reconciliation', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const [custAgg, suppAgg, ar, ap] = await Promise.all([
      prisma.customer.aggregate({ _sum: { currentBalance: true } }),
      prisma.supplier.aggregate({ _sum: { currentBalance: true } }),
      prisma.account.findUnique({ where: { code: '3000' }, select: { currentBalance: true } }),
      prisma.account.findUnique({ where: { code: '2000' }, select: { currentBalance: true } }),
    ]);
    const arSub = round2(Number(custAgg._sum.currentBalance ?? 0));
    const arGL = round2(Number(ar?.currentBalance ?? 0));
    const apSub = round2(Number(suppAgg._sum.currentBalance ?? 0));
    const apGL = round2(Number(ap?.currentBalance ?? 0));
    res.json({
      receivables: { subledger: arSub, generalLedger: arGL, difference: round2(arSub - arGL), balanced: Math.abs(arSub - arGL) < 0.01 },
      payables:    { subledger: apSub, generalLedger: apGL, difference: round2(apSub - apGL), balanced: Math.abs(apSub - apGL) < 0.01 },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/sales-log
router.get('/sales-log', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;

    const where: Record<string, unknown> = {};
    if (from || to) {
      where.date = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const invoices = await prisma.salesInvoice.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        customer: { select: { id: true, nameAr: true, company: true } },
        cashier: { select: { id: true, name: true } },
        warehouse: { select: { id: true, nameAr: true } },
        items: { include: { product: { select: { id: true, nameAr: true, sku: true } } } },
      },
    });

    const agg = await prisma.salesInvoice.aggregate({
      where,
      _sum: { total: true, subtotal: true, discount: true, tax: true },
      _count: true,
    });

    res.json({
      invoices,
      summary: {
        count: agg._count,
        total: Number(agg._sum.total ?? 0),
        subtotal: Number(agg._sum.subtotal ?? 0),
        discount: Number(agg._sum.discount ?? 0),
        tax: Number(agg._sum.tax ?? 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/purchases-log
router.get('/purchases-log', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;

    const where: Record<string, unknown> = {};
    if (from || to) {
      where.date = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const invoices = await prisma.purchaseInvoice.findMany({
      where,
      orderBy: { date: 'desc' },
      include: {
        supplier: { select: { id: true, nameAr: true, company: true } },
        warehouse: { select: { id: true, nameAr: true } },
        items: { include: { product: { select: { id: true, nameAr: true, sku: true } } } },
      },
    });

    const agg = await prisma.purchaseInvoice.aggregate({
      where,
      _sum: { total: true, subtotal: true, discount: true, tax: true },
      _count: true,
    });

    res.json({
      invoices,
      summary: {
        count: agg._count,
        total: Number(agg._sum.total ?? 0),
        subtotal: Number(agg._sum.subtotal ?? 0),
        discount: Number(agg._sum.discount ?? 0),
        tax: Number(agg._sum.tax ?? 0),
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── Helper: compute account balance from ledger ────────────────────────────────
async function computeCurrentBalance(accountId: number): Promise<number> {
  const account = await prisma.account.findUniqueOrThrow({
    where: { id: accountId },
    select: { openingBalance: true, type: true },
  });

  const agg = await prisma.journalLine.aggregate({
    where: { accountId },
    _sum: { debit: true, credit: true },
  });

  const totalDebit  = Number(agg._sum.debit  ?? 0);
  const totalCredit = Number(agg._sum.credit ?? 0);
  const opening     = Number(account.openingBalance);

  const isDebitNormal = account.type === 'ASSET' || account.type === 'EXPENSE';
  if (isDebitNormal) {
    return opening + totalDebit - totalCredit;
  } else {
    return opening + totalCredit - totalDebit;
  }
}

// GET /api/reports/trial-balance — ميزان المراجعة
router.get('/trial-balance', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accounts = await prisma.account.findMany({
      orderBy: { code: 'asc' },
    });

    const rows = await Promise.all(
      accounts.map(async (acct) => {
        const agg = await prisma.journalLine.aggregate({
          where: { accountId: acct.id },
          _sum: { debit: true, credit: true },
        });

        const totalDebit   = Number(agg._sum.debit  ?? 0);
        const totalCredit  = Number(agg._sum.credit ?? 0);
        const opening      = Number(acct.openingBalance);
        const isDebitNorm  = acct.type === 'ASSET' || acct.type === 'EXPENSE';
        const balance      = isDebitNorm
          ? opening + totalDebit - totalCredit
          : opening + totalCredit - totalDebit;

        // Trial balance columns reflect the account's closing balance (opening
        // balance included), not just ledger postings — a contra (negative)
        // balance flips to the opposite column.
        const debit  = isDebitNorm ? Math.max(balance, 0)  : Math.max(-balance, 0);
        const credit = isDebitNorm ? Math.max(-balance, 0) : Math.max(balance, 0);

        return {
          id:            acct.id,
          code:          acct.code,
          nameAr:        acct.nameAr,
          type:          acct.type,
          openingBalance: opening,
          totalDebit,
          totalCredit,
          balance,
          debit,
          credit,
        };
      }),
    );

    const grandTotalDebit  = rows.reduce((s, r) => s + r.debit,  0);
    const grandTotalCredit = rows.reduce((s, r) => s + r.credit, 0);
    const balanced         = Math.abs(grandTotalDebit - grandTotalCredit) < 0.01;

    res.json({
      accounts: rows,
      grandTotalDebit,
      grandTotalCredit,
      balanced,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/balance-sheet — الميزانية العمومية
router.get('/balance-sheet', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accounts = await prisma.account.findMany({
      orderBy: { code: 'asc' },
      include: { children: { select: { id: true } } },
    });

    // Identify parent account ids (those that have children)
    const parentIds = new Set(accounts.filter(a => a.children.length > 0).map(a => a.id));

    const withBalances = await Promise.all(
      accounts.map(async (acct) => {
        const balance = await computeCurrentBalance(acct.id);
        return { ...acct, balance, isParent: parentIds.has(acct.id) };
      }),
    );

    // For balance sheet totals: exclude parent accounts that have children
    // (their balances are included in children to avoid double-counting)
    const byType = (type: string) =>
      withBalances
        .filter(a => a.type === type)
        .map(a => ({ id: a.id, code: a.code, nameAr: a.nameAr, balance: a.balance, isParent: a.isParent }));

    const allAssets      = byType('ASSET');
    const allLiabilities = byType('LIABILITY');
    const allEquity      = byType('EQUITY');

    const leafOnly = <T extends { isParent: boolean }>(arr: T[]) => arr.filter(a => !a.isParent);

    const assets      = allAssets;       // Assets have no children in this chart
    const liabilities = allLiabilities;
    const equity      = allEquity;
    const revenues    = byType('REVENUE');
    const expenses    = byType('EXPENSE');

    const totalAssets      = assets.reduce((s, a) => s + a.balance, 0);
    const totalLiabilities = liabilities.reduce((s, a) => s + a.balance, 0);
    // Sum only leaf equity accounts to avoid double-counting parent+children
    const totalEquity      = leafOnly(equity).reduce((s, a) => s + a.balance, 0);

    // Net profit folds into equity side
    const totalRevenue  = revenues.reduce((s, a) => s + a.balance, 0);
    const totalExpenses = expenses.reduce((s, a) => s + a.balance, 0);
    const netProfit     = totalRevenue - totalExpenses;

    const totalLiabilitiesAndEquity = totalLiabilities + totalEquity + netProfit;

    res.json({
      assets: {
        accounts: assets,
        total: totalAssets,
      },
      liabilities: {
        accounts: liabilities,
        total: totalLiabilities,
      },
      equity: {
        accounts: equity,
        netProfit,
        total: totalEquity + netProfit,
      },
      totalLiabilitiesAndEquity,
      balanced: Math.abs(totalAssets - totalLiabilitiesAndEquity) < 0.01,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/income-statement — قائمة الدخل
// Also aliased as /pnl for backward compatibility
async function incomeStatementHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to   = req.query.to   ? new Date(req.query.to as string)   : undefined;

    // Date filter for journal lines
    const dateFilter = (from || to)
      ? { entry: { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } }
      : {};

    // Fetch all accounts with their ledger-based balances for the period
    const accounts = await prisma.account.findMany({
      where: { type: { in: ['REVENUE', 'EXPENSE'] } },
      orderBy: { code: 'asc' },
    });

    const rows = await Promise.all(
      accounts.map(async (acct) => {
        const agg = await prisma.journalLine.aggregate({
          where: { accountId: acct.id, ...dateFilter },
          _sum: { debit: true, credit: true },
        });

        const totalDebit  = Number(agg._sum.debit  ?? 0);
        const totalCredit = Number(agg._sum.credit ?? 0);
        const isDebitNorm = acct.type === 'EXPENSE';
        // For income statement we want the period movement only (no opening balance)
        const periodBalance = isDebitNorm
          ? totalDebit - totalCredit
          : totalCredit - totalDebit;

        return {
          id:      acct.id,
          code:    acct.code,
          nameAr:  acct.nameAr,
          type:    acct.type,
          balance: periodBalance,
        };
      }),
    );

    const revenues = rows.filter(r => r.type === 'REVENUE');
    const expenses = rows.filter(r => r.type === 'EXPENSE');

    const totalRevenue  = revenues.reduce((s, r) => s + r.balance, 0);
    const totalExpenses = expenses.reduce((s, r) => s + r.balance, 0);
    const cogsAccount   = expenses.find(e => e.code === '5000');
    const cogsBalance   = cogsAccount?.balance ?? 0;
    const grossProfit   = totalRevenue - cogsBalance;
    const netProfit     = totalRevenue - totalExpenses;
    const grossMarginPct = totalRevenue > 0
      ? Math.round((grossProfit / totalRevenue) * 100 * 10) / 10
      : 0;

    // Backward-compatible keys used by the dashboard (/reports/pnl)
    const generalExpense = expenses.filter(e => e.code !== '5000');

    res.json({
      // New structured keys (income-statement)
      revenues,
      expenses: rows.filter(r => r.type === 'EXPENSE'),
      totalRevenue,
      totalExpenses,
      netProfit,
      // Backward-compatible keys (pnl)
      revenue: totalRevenue,
      cogs: cogsAccount?.balance ?? 0,
      grossProfit,
      grossMarginPct,
      purchases: 0, // deprecated — use purchases-log
      expenses_total: totalExpenses, // alias
    });
  } catch (err) {
    next(err);
  }
}

router.get('/income-statement', incomeStatementHandler);
router.get('/pnl', incomeStatementHandler);

// GET /api/reports/customer-balances
router.get('/customer-balances', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const customers = await prisma.customer.findMany({
      where: { currentBalance: { gt: 0 } },
      orderBy: { currentBalance: 'desc' },
    });

    const agg = await prisma.customer.aggregate({ _sum: { currentBalance: true } });

    res.json({
      customers,
      totalReceivables: Number(agg._sum.currentBalance ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/supplier-balances
router.get('/supplier-balances', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const suppliers = await prisma.supplier.findMany({
      where: { currentBalance: { gt: 0 } },
      orderBy: { currentBalance: 'desc' },
    });

    const agg = await prisma.supplier.aggregate({ _sum: { currentBalance: true } });

    res.json({
      suppliers,
      totalPayables: Number(agg._sum.currentBalance ?? 0),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/top-products
router.get('/top-products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = parseInt(req.query.limit as string ?? '10');

    const rawItems = await prisma.salesInvoiceItem.groupBy({
      by: ['productId'],
      _sum: { qty: true, lineTotal: true },
      orderBy: { _sum: { lineTotal: 'desc' } },
      take: limit,
    });

    const productIds = rawItems.map(r => r.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { unit: true },
    });

    const result = rawItems.map(r => {
      const product = products.find(p => p.id === r.productId);
      return {
        productId: r.productId,
        nameAr: product?.nameAr ?? '',
        sku: product?.sku ?? '',
        unit: product?.unit?.nameAr ?? '',
        qtySold: Number(r._sum.qty ?? 0),
        totalRevenue: Number(r._sum.lineTotal ?? 0),
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/low-stock
router.get('/low-stock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const threshold = parseFloat(req.query.threshold as string ?? '10');

    const lowBalances = await prisma.stockBalance.findMany({
      where: { quantity: { lt: threshold } },
      include: {
        product: { include: { unit: true, brand: true } },
        warehouse: { select: { id: true, nameAr: true } },
      },
      orderBy: { quantity: 'asc' },
    });

    res.json(lowBalances);
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/expiring-products — منتجات قاربت على انتهاء الصلاحية أو منتهية
router.get('/expiring-products', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const daysAhead = parseInt(req.query.days as string) || 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + daysAhead);

    const products = await prisma.product.findMany({
      where: { expiryDate: { not: null, lte: cutoff } },
      include: {
        unit: true,
        brand: true,
        stockBalances: { include: { warehouse: { select: { id: true, nameAr: true } } } },
      },
      orderBy: { expiryDate: 'asc' },
    });

    const now = new Date();
    const rows = products.map((p) => {
      const totalQty = p.stockBalances.reduce((s, b) => s + Number(b.quantity), 0);
      return {
        id: p.id,
        nameAr: p.nameAr,
        sku: p.sku,
        unit: p.unit ? { nameAr: p.unit.nameAr } : null,
        brand: p.brand ? { nameAr: p.brand.nameAr } : null,
        expiryDate: p.expiryDate,
        isExpired: p.expiryDate! < now,
        totalQty,
        balances: p.stockBalances.map((b) => ({ warehouseId: b.warehouseId, warehouseName: b.warehouse.nameAr, quantity: Number(b.quantity) })),
      };
    });

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/vat — تقرير ضريبة القيمة المضافة
router.get('/vat', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;

    const dateWhere: Record<string, unknown> = {};
    if (from || to) {
      dateWhere.date = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    // ── Sales (output VAT) ────────────────────────────────────────────────────
    const salesInvoices = await prisma.salesInvoice.findMany({
      where: dateWhere,
      orderBy: { date: 'desc' },
      include: { customer: { select: { id: true, nameAr: true } } },
    });
    const salesTaxable = salesInvoices.filter((inv) => Number(inv.tax) > 0);
    const salesExempt = salesInvoices.filter((inv) => Number(inv.tax) === 0);

    const outputVAT = salesInvoices.reduce((s, inv) => s + Number(inv.tax ?? 0), 0);
    const salesTaxableNet = salesTaxable.reduce(
      (s, inv) => s + Number(inv.subtotal ?? 0) - Number(inv.discount ?? 0),
      0,
    );
    const salesExemptNet = salesExempt.reduce(
      (s, inv) => s + Number(inv.subtotal ?? 0) - Number(inv.discount ?? 0),
      0,
    );

    // ── Sales returns lower output VAT (إشعارات دائن) ─────────────────────────
    const salesReturns = await prisma.salesReturn.findMany({
      where: dateWhere,
      orderBy: { date: 'desc' },
      include: {
        customer: { select: { id: true, nameAr: true } },
        salesInvoice: { select: { refNo: true } },
      },
    });
    const salesReturnsVAT = salesReturns.reduce((s, r) => s + Number(r.tax ?? 0), 0);
    const salesReturnsNet = salesReturns.reduce(
      (s, r) => s + Number(r.subtotal ?? 0) - Number(r.discount ?? 0),
      0,
    );

    // ── Purchases (input VAT) ─────────────────────────────────────────────────
    const purchaseInvoices = await prisma.purchaseInvoice.findMany({
      where: dateWhere,
      orderBy: { date: 'desc' },
      include: { supplier: { select: { id: true, nameAr: true } } },
    });
    const purchaseTaxable = purchaseInvoices.filter((inv) => Number(inv.tax) > 0);

    const grossInputVAT = purchaseInvoices.reduce((s, inv) => s + Number(inv.tax ?? 0), 0);
    const purchasesTaxableNet = purchaseTaxable.reduce(
      (s, inv) => s + Number(inv.subtotal ?? 0) - Number(inv.discount ?? 0),
      0,
    );

    // ── Purchase returns lower input VAT (إشعارات مدين) ───────────────────────
    const purchaseReturns = await prisma.purchaseReturn.findMany({
      where: dateWhere,
      orderBy: { date: 'desc' },
      include: {
        supplier: { select: { id: true, nameAr: true } },
        purchaseInvoice: { select: { refNo: true } },
      },
    });
    const purchaseReturnsVAT = purchaseReturns.reduce((s, r) => s + Number(r.tax ?? 0), 0);
    const purchaseReturnsNet = purchaseReturns.reduce(
      (s, r) => s + Number(r.subtotal ?? 0) - Number(r.discount ?? 0),
      0,
    );

    // ── Net VAT (payable if positive / refundable if negative) ────────────────
    const netOutputVAT = outputVAT - salesReturnsVAT;
    const netInputVAT = grossInputVAT - purchaseReturnsVAT;
    const netVAT = netOutputVAT - netInputVAT;

    res.json({
      period: { from: from ?? null, to: to ?? null },
      sales: {
        taxableCount: salesTaxable.length,
        exemptCount: salesExempt.length,
        taxableNet: salesTaxableNet,
        exemptNet: salesExemptNet,
        outputVAT,
        returnsCount: salesReturns.length,
        returnsNet: salesReturnsNet,
        returnsVAT: salesReturnsVAT,
        invoices: salesTaxable.map((inv) => ({
          id: inv.id,
          refNo: inv.refNo,
          date: inv.date,
          customerName: inv.customer?.nameAr ?? '—',
          subtotal: Number(inv.subtotal),
          discount: Number(inv.discount),
          tax: Number(inv.tax),
          total: Number(inv.total),
        })),
        returns: salesReturns.map((r) => ({
          id: r.id,
          refNo: r.refNo,
          date: r.date,
          customerName: r.customer?.nameAr ?? '—',
          invoiceRefNo: r.salesInvoice?.refNo ?? '—',
          subtotal: Number(r.subtotal),
          discount: Number(r.discount),
          tax: Number(r.tax),
          total: Number(r.total),
        })),
      },
      purchases: {
        taxableCount: purchaseTaxable.length,
        taxableNet: purchasesTaxableNet,
        inputVAT: grossInputVAT,
        returnsCount: purchaseReturns.length,
        returnsNet: purchaseReturnsNet,
        returnsVAT: purchaseReturnsVAT,
        invoices: purchaseTaxable.map((inv) => ({
          id: inv.id,
          refNo: inv.refNo,
          date: inv.date,
          supplierName: inv.supplier?.nameAr ?? '—',
          subtotal: Number(inv.subtotal),
          discount: Number(inv.discount),
          tax: Number(inv.tax),
          total: Number(inv.total),
        })),
        returns: purchaseReturns.map((r) => ({
          id: r.id,
          refNo: r.refNo,
          date: r.date,
          supplierName: r.supplier?.nameAr ?? '—',
          invoiceRefNo: r.purchaseInvoice?.refNo ?? '—',
          subtotal: Number(r.subtotal),
          discount: Number(r.discount),
          tax: Number(r.tax),
          total: Number(r.total),
        })),
      },
      // Top-level figures are NET of returns — what actually goes on the VAT return
      outputVAT: netOutputVAT,
      inputVAT: netInputVAT,
      grossOutputVAT: outputVAT,
      grossInputVAT,
      netVAT,
      isPayable: netVAT >= 0, // true = must pay to authority; false = refundable
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/cash-flow — قائمة التدفقات النقدية (direct method)
// Classifies every journal line that touches CASH (1000) or BANK (1100) by the
// nature of its counter-account: EQUITY → financing, fixed-asset accounts →
// investing, everything else → operating. Opening/closing cash are derived
// purely from journal history (not from Account.currentBalance, which is
// always "as of now" and would be wrong for a report ending in the past).
router.get('/cash-flow', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;

    const cashAccounts = await prisma.account.findMany({
      where: { code: { in: ['1000', '1100'] } },
      select: { id: true },
    });
    const cashAccountIds = cashAccounts.map((a) => a.id);

    if (cashAccountIds.length === 0) {
      res.json({
        period: { from: from ?? null, to: to ?? null },
        openingCash: 0, closingCash: 0,
        operating: { lines: [], total: 0 },
        investing: { lines: [], total: 0 },
        financing: { lines: [], total: 0 },
        netChange: 0,
      });
      return;
    }

    // Opening cash = net cash effect of every journal line strictly before `from`
    const openingAgg = from
      ? await prisma.journalLine.aggregate({
          where: { accountId: { in: cashAccountIds }, entry: { date: { lt: from } } },
          _sum: { debit: true, credit: true },
        })
      : { _sum: { debit: new Prisma.Decimal(0), credit: new Prisma.Decimal(0) } };
    const openingCash = Number(openingAgg._sum.debit ?? 0) - Number(openingAgg._sum.credit ?? 0);

    // All cash-touching lines within the period, with their entry's other lines
    // (the counter-accounts) so we can classify the activity.
    const dateFilter: Record<string, unknown> = {};
    if (from) dateFilter.gte = from;
    if (to) dateFilter.lte = to;

    const cashLines = await prisma.journalLine.findMany({
      where: {
        accountId: { in: cashAccountIds },
        ...(from || to ? { entry: { date: dateFilter } } : {}),
      },
      include: {
        entry: {
          include: {
            lines: { include: { account: { select: { id: true, code: true, type: true } } } },
          },
        },
      },
      orderBy: { entry: { date: 'asc' } },
    });

    type Category = 'operating' | 'investing' | 'financing';
    const buckets: Record<Category, { lines: Array<{ date: Date; description: string | null; amount: number }>; total: number }> = {
      operating: { lines: [], total: 0 },
      investing: { lines: [], total: 0 },
      financing: { lines: [], total: 0 },
    };

    for (const line of cashLines) {
      const amount = Number(line.debit) - Number(line.credit); // cash is debit-normal
      if (amount === 0) continue;

      const counterLines = line.entry.lines.filter((l) => !cashAccountIds.includes(l.accountId));
      let category: Category = 'operating';
      if (counterLines.some((l) => l.account.type === 'EQUITY')) {
        category = 'financing';
      } else if (counterLines.some((l) => l.account.code === '1400' || l.account.code === '1450')) {
        category = 'investing';
      }

      buckets[category].lines.push({ date: line.entry.date, description: line.entry.description, amount });
      buckets[category].total += amount;
    }

    const netChange = buckets.operating.total + buckets.investing.total + buckets.financing.total;
    const closingCash = openingCash + netChange;

    res.json({
      period: { from: from ?? null, to: to ?? null },
      openingCash,
      closingCash,
      operating: buckets.operating,
      investing: buckets.investing,
      financing: buckets.financing,
      netChange,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/cost-centers — ربحية مراكز التكلفة
// Sums every journal line tagged with a cost center, grouped by center,
// split into revenue vs expense (incl. COGS) so each center's net result shows.
router.get('/cost-centers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;

    const dateFilter: Record<string, unknown> = {};
    if (from) dateFilter.gte = from;
    if (to) dateFilter.lte = to;

    const costCenters = await prisma.costCenter.findMany({ orderBy: { code: 'asc' } });

    const lines = await prisma.journalLine.findMany({
      where: {
        costCenterId: { not: null },
        ...(from || to ? { entry: { date: dateFilter } } : {}),
      },
      include: { account: { select: { type: true } } },
    });

    const byCenteredId = new Map<number, { revenue: number; expense: number }>();
    for (const line of lines) {
      if (!line.costCenterId) continue;
      const bucket = byCenteredId.get(line.costCenterId) ?? { revenue: 0, expense: 0 };
      if (line.account.type === 'REVENUE') {
        bucket.revenue += Number(line.credit) - Number(line.debit);
      } else if (line.account.type === 'EXPENSE') {
        bucket.expense += Number(line.debit) - Number(line.credit);
      }
      byCenteredId.set(line.costCenterId, bucket);
    }

    const rows = costCenters.map((cc) => {
      const bucket = byCenteredId.get(cc.id) ?? { revenue: 0, expense: 0 };
      return {
        id: cc.id,
        code: cc.code,
        nameAr: cc.nameAr,
        revenue: bucket.revenue,
        expense: bucket.expense,
        net: bucket.revenue - bucket.expense,
      };
    });

    const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
    const totalExpense = rows.reduce((s, r) => s + r.expense, 0);

    res.json({
      period: { from: from ?? null, to: to ?? null },
      centers: rows,
      totalRevenue,
      totalExpense,
      totalNet: totalRevenue - totalExpense,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/budget-vs-actual?year=2026&month=6 — الموازنة التقديرية مقابل الفعلي
// month is optional; when omitted the whole year is compared.
router.get('/budget-vs-actual', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const year = parseInt(req.query.year as string) || new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month as string) : undefined;

    const rangeStart = new Date(Date.UTC(year, month ? month - 1 : 0, 1));
    const rangeEnd = month
      ? new Date(Date.UTC(year, month, 1))
      : new Date(Date.UTC(year + 1, 0, 1));

    const budgetRows = await prisma.budget.findMany({
      where: {
        year,
        costCenterId: null,
        ...(month ? { month } : {}),
      },
      include: { account: { select: { id: true, code: true, nameAr: true, type: true } } },
    });

    const budgetByAccount = new Map<number, { code: string; nameAr: string; type: string; amount: number }>();
    for (const b of budgetRows) {
      const entry = budgetByAccount.get(b.accountId) ?? {
        code: b.account.code, nameAr: b.account.nameAr, type: b.account.type, amount: 0,
      };
      entry.amount += Number(b.amount);
      budgetByAccount.set(b.accountId, entry);
    }

    const accountIds = [...budgetByAccount.keys()];
    const actualLines = accountIds.length
      ? await prisma.journalLine.findMany({
          where: { accountId: { in: accountIds }, entry: { date: { gte: rangeStart, lt: rangeEnd } } },
        })
      : [];

    const actualByAccount = new Map<number, number>();
    for (const line of actualLines) {
      const acct = budgetByAccount.get(line.accountId)!;
      const net = acct.type === 'EXPENSE'
        ? Number(line.debit) - Number(line.credit)
        : Number(line.credit) - Number(line.debit);
      actualByAccount.set(line.accountId, (actualByAccount.get(line.accountId) ?? 0) + net);
    }

    const rows = accountIds.map((id) => {
      const b = budgetByAccount.get(id)!;
      const actual = actualByAccount.get(id) ?? 0;
      const variance = actual - b.amount;
      const variancePct = b.amount !== 0 ? (variance / b.amount) * 100 : 0;
      return {
        accountId: id,
        code: b.code,
        nameAr: b.nameAr,
        type: b.type,
        budget: b.amount,
        actual,
        variance,
        variancePct,
      };
    });

    res.json({
      year, month: month ?? null,
      rows,
      totalBudget: rows.reduce((s, r) => s + r.budget, 0),
      totalActual: rows.reduce((s, r) => s + r.actual, 0),
    });
  } catch (err) {
    next(err);
  }
});

// ── Aging buckets shared by AR/AP ───────────────────────────────────────────────
type AgingBucketKey = 'current' | 'b31_60' | 'b61_90' | 'over90';
function ageBucket(ageDays: number): AgingBucketKey {
  if (ageDays <= 30) return 'current';
  if (ageDays <= 60) return 'b31_60';
  if (ageDays <= 90) return 'b61_90';
  return 'over90';
}
function emptyAgingRow() {
  return { current: 0, b31_60: 0, b61_90: 0, over90: 0 };
}

// GET /api/reports/ar-aging — تعمير ذمم العملاء
router.get('/ar-aging', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asOf = req.query.asOf ? new Date(req.query.asOf as string) : new Date();

    const invoices = await prisma.salesInvoice.findMany({
      where: { paidStatus: { not: 'PAID' } },
      include: { customer: { select: { id: true, nameAr: true } } },
    });
    const invoiceIds = invoices.map((i) => i.id);
    const [paidAgg, returnAgg] = invoiceIds.length
      ? await Promise.all([
          prisma.voucher.groupBy({
            by: ['salesInvoiceId'],
            where: { salesInvoiceId: { in: invoiceIds } },
            _sum: { totalAmount: true },
          }),
          prisma.salesReturn.groupBy({
            by: ['salesInvoiceId'],
            where: { salesInvoiceId: { in: invoiceIds }, refundMethod: 'BALANCE' },
            _sum: { total: true },
          }),
        ])
      : [[], []];
    const paidMap = new Map(paidAgg.map((v) => [v.salesInvoiceId, Number(v._sum.totalAmount ?? 0)]));
    const returnMap = new Map(returnAgg.map((r) => [r.salesInvoiceId, Number(r._sum.total ?? 0)]));

    const byCustomer = new Map<number, { id: number; nameAr: string } & ReturnType<typeof emptyAgingRow>>();
    for (const inv of invoices) {
      const paid = paidMap.get(inv.id) ?? 0;
      const returned = returnMap.get(inv.id) ?? 0; // BALANCE returns settle the receivable
      const remaining = Number(inv.total) - paid - returned;
      if (remaining <= 0.01) continue;

      const ageDays = Math.floor((asOf.getTime() - inv.date.getTime()) / 86400000);
      const entry = byCustomer.get(inv.customerId) ?? { id: inv.customerId, nameAr: inv.customer.nameAr, ...emptyAgingRow() };
      entry[ageBucket(ageDays)] += remaining;
      byCustomer.set(inv.customerId, entry);
    }

    const rows = [...byCustomer.values()]
      .map((r) => ({ ...r, total: r.current + r.b31_60 + r.b61_90 + r.over90 }))
      .sort((a, b) => b.total - a.total);

    const totals = rows.reduce(
      (acc, r) => ({
        current: acc.current + r.current,
        b31_60: acc.b31_60 + r.b31_60,
        b61_90: acc.b61_90 + r.b61_90,
        over90: acc.over90 + r.over90,
        total: acc.total + r.total,
      }),
      { current: 0, b31_60: 0, b61_90: 0, over90: 0, total: 0 },
    );

    res.json({ asOfDate: asOf, rows, totals });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/ap-aging — تعمير ذمم الموردين
router.get('/ap-aging', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asOf = req.query.asOf ? new Date(req.query.asOf as string) : new Date();

    // Only RECEIVED invoices are actual payables — a PENDING order isn't owed
    // yet and never hit AP/the supplier balance, so it must not be aged either.
    const invoices = await prisma.purchaseInvoice.findMany({
      where: { paymentStatus: { not: 'PAID' }, receiveStatus: 'RECEIVED' },
      include: { supplier: { select: { id: true, nameAr: true } } },
    });
    const invoiceIds = invoices.map((i) => i.id);
    const [paidAgg, returnAgg] = invoiceIds.length
      ? await Promise.all([
          prisma.voucher.groupBy({
            by: ['purchaseInvoiceId'],
            where: { purchaseInvoiceId: { in: invoiceIds } },
            _sum: { totalAmount: true },
          }),
          prisma.purchaseReturn.groupBy({
            by: ['purchaseInvoiceId'],
            where: { purchaseInvoiceId: { in: invoiceIds }, refundMethod: 'BALANCE' },
            _sum: { total: true },
          }),
        ])
      : [[], []];
    const paidMap = new Map(paidAgg.map((v) => [v.purchaseInvoiceId, Number(v._sum.totalAmount ?? 0)]));
    const returnMap = new Map(returnAgg.map((r) => [r.purchaseInvoiceId, Number(r._sum.total ?? 0)]));

    const bySupplier = new Map<number, { id: number; nameAr: string } & ReturnType<typeof emptyAgingRow>>();
    for (const inv of invoices) {
      const paid = paidMap.get(inv.id) ?? 0;
      const returned = returnMap.get(inv.id) ?? 0; // BALANCE returns settle the payable
      const remaining = Number(inv.total) - paid - returned;
      if (remaining <= 0.01) continue;

      const ageDays = Math.floor((asOf.getTime() - inv.date.getTime()) / 86400000);
      const entry = bySupplier.get(inv.supplierId) ?? { id: inv.supplierId, nameAr: inv.supplier.nameAr, ...emptyAgingRow() };
      entry[ageBucket(ageDays)] += remaining;
      bySupplier.set(inv.supplierId, entry);
    }

    const rows = [...bySupplier.values()]
      .map((r) => ({ ...r, total: r.current + r.b31_60 + r.b61_90 + r.over90 }))
      .sort((a, b) => b.total - a.total);

    const totals = rows.reduce(
      (acc, r) => ({
        current: acc.current + r.current,
        b31_60: acc.b31_60 + r.b31_60,
        b61_90: acc.b61_90 + r.b61_90,
        over90: acc.over90 + r.over90,
        total: acc.total + r.total,
      }),
      { current: 0, b31_60: 0, b61_90: 0, over90: 0, total: 0 },
    );

    res.json({ asOfDate: asOf, rows, totals });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/dead-stock — الأصناف الراكدة (لديها مخزون ولم تُبع منذ فترة)
router.get('/dead-stock', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsedDays = parseInt(req.query.days as string);
    const days = Number.isNaN(parsedDays) ? 90 : parsedDays;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const products = await prisma.product.findMany({
      where: { isActive: true },
      include: {
        unit: true,
        brand: true,
        stockBalances: { include: { warehouse: { select: { id: true, nameAr: true } } } },
      },
    });

    const candidates = products
      .map((p) => ({ product: p, totalQty: p.stockBalances.reduce((s, b) => s + Number(b.quantity), 0) }))
      .filter((c) => c.totalQty > 0);

    const candidateIds = candidates.map((c) => c.product.id);
    const items = candidateIds.length
      ? await prisma.salesInvoiceItem.findMany({
          where: { productId: { in: candidateIds } },
          select: { productId: true, invoice: { select: { date: true } } },
        })
      : [];

    const lastSaleMap = new Map<number, Date>();
    for (const it of items) {
      const prev = lastSaleMap.get(it.productId);
      if (!prev || it.invoice.date > prev) lastSaleMap.set(it.productId, it.invoice.date);
    }

    const now = new Date();
    const rows = candidates
      .map(({ product: p, totalQty }) => {
        const lastSaleDate = lastSaleMap.get(p.id) ?? null;
        return {
          id: p.id,
          nameAr: p.nameAr,
          sku: p.sku,
          unit: p.unit ? { nameAr: p.unit.nameAr } : null,
          brand: p.brand ? { nameAr: p.brand.nameAr } : null,
          totalQty,
          stockValue: totalQty * Number(p.costPrice),
          lastSaleDate,
          daysSinceLastSale: lastSaleDate ? Math.floor((now.getTime() - lastSaleDate.getTime()) / 86400000) : null,
          balances: p.stockBalances.map((b) => ({ warehouseId: b.warehouseId, warehouseName: b.warehouse.nameAr, quantity: Number(b.quantity) })),
        };
      })
      .filter((r) => r.lastSaleDate === null || r.lastSaleDate < cutoff)
      .sort((a, b) => (b.daysSinceLastSale ?? Infinity) - (a.daysSinceLastSale ?? Infinity));

    res.json({ days, rows, totalStockValue: rows.reduce((s, r) => s + r.stockValue, 0) });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/reorder-suggestions — الكميات المقترحة لإعادة الطلب
router.get('/reorder-suggestions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const products = await prisma.product.findMany({
      where: { isActive: true, reorderPoint: { not: null } },
      include: {
        unit: true,
        brand: true,
        stockBalances: true,
      },
    });

    const rows = products
      .map((p) => {
        const totalQty = p.stockBalances.reduce((s, b) => s + Number(b.quantity), 0);
        const reorderPoint = Number(p.reorderPoint);
        const reorderQty = p.reorderQty ? Number(p.reorderQty) : Math.max(reorderPoint * 2 - totalQty, 0);
        return {
          id: p.id,
          nameAr: p.nameAr,
          sku: p.sku,
          unit: p.unit ? { nameAr: p.unit.nameAr } : null,
          brand: p.brand ? { nameAr: p.brand.nameAr } : null,
          totalQty,
          reorderPoint,
          suggestedQty: reorderQty,
          estimatedCost: reorderQty * Number(p.costPrice),
        };
      })
      .filter((r) => r.totalQty <= r.reorderPoint)
      .sort((a, b) => a.totalQty - a.reorderPoint - (b.totalQty - b.reorderPoint));

    res.json({ rows, totalEstimatedCost: rows.reduce((s, r) => s + r.estimatedCost, 0) });
  } catch (err) {
    next(err);
  }
});

export default router;
