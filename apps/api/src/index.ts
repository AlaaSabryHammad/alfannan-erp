import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';

import authRouter from './routes/auth';
import productsRouter from './routes/products';
import uploadsRouter from './routes/uploads';
import departmentsRouter from './routes/departments';
import brandsRouter from './routes/brands';
import unitsRouter from './routes/units';
import warehousesRouter from './routes/warehouses';
import stockRouter from './routes/stock';
import customersRouter from './routes/customers';
import salesInvoicesRouter from './routes/salesInvoices';
import salesReturnsRouter from './routes/salesReturns';
import purchaseReturnsRouter from './routes/purchaseReturns';
import dashboardRouter from './routes/dashboard';
import suppliersRouter from './routes/suppliers';
import purchaseInvoicesRouter from './routes/purchaseInvoices';
import accountsRouter from './routes/accounts';
import partnersRouter from './routes/partners';
import stockTransfersRouter from './routes/stockTransfers';
import reportsRouter from './routes/reports';
import usersRouter from './routes/users';
import rolesRouter from './routes/roles';
import permissionsRouter from './routes/permissions';
import journalRouter from './routes/journal';
import expensesRouter from './routes/expenses';
import settingsRouter from './routes/settings';
import auditLogsRouter from './routes/auditLogs';
import vouchersRouter from './routes/vouchers';
import promissoryNotesRouter from './routes/promissoryNotes';
import treasuryRouter from './routes/treasury';
import fixedAssetsRouter from './routes/fixedAssets';
import payrollRouter, { payrollRunsRouter } from './routes/payroll';
import costCentersRouter from './routes/costCenters';
import budgetsRouter from './routes/budgets';
import recurringEntriesRouter from './routes/recurringEntries';
import journalApprovalsRouter from './routes/journalApprovals';
import fiscalPeriodsRouter from './routes/fiscalPeriods';
import alertsRouter from './routes/alerts';
import bomRouter from './routes/bom';
import workOrdersRouter from './routes/workOrders';
import couponsRouter from './routes/coupons';
import notificationsRouter from './routes/notifications';
import branchesRouter from './routes/branches';
import zatcaRouter from './routes/zatca';
import stockCountsRouter from './routes/stockCounts';
import { auditMiddleware } from './middleware/audit';
import { errorHandler } from './middleware/errorHandler';

const app = express();
const PORT = parseInt(process.env.PORT ?? '4000', 10);

// ── Uploads directory ─────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  // Allow any localhost/127.0.0.1 port in dev (Vite may fall back to 5174+ if 5173 is taken),
  // plus an optional explicit origin from CORS_ORIGIN for production.
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // non-browser clients (curl, server-to-server)
    const allowed =
      /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ||
      origin === process.env.CORS_ORIGIN;
    cb(null, allowed);
  },
  credentials: true,
}));
app.use(express.json());

// ── Audit middleware (registers res.on('finish') handler; reads req.user set by per-router requireAuth) ──
app.use(auditMiddleware);

// ── Static uploads ────────────────────────────────────────────────────────────
app.use('/uploads', express.static(uploadsDir));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', system: 'نظام الفنان للتوريدات والمخازن', timestamp: new Date().toISOString() });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRouter);
app.use('/api/products', productsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/departments', departmentsRouter);
app.use('/api/brands', brandsRouter);
app.use('/api/units', unitsRouter);
app.use('/api/warehouses', warehousesRouter);
app.use('/api/stock', stockRouter);
app.use('/api/customers', customersRouter);
app.use('/api/sales-invoices', salesInvoicesRouter);
app.use('/api/sales-returns', salesReturnsRouter);
app.use('/api/purchase-returns', purchaseReturnsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/purchase-invoices', purchaseInvoicesRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/partners', partnersRouter);
app.use('/api/stock-transfers', stockTransfersRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/users', usersRouter);
app.use('/api/roles', rolesRouter);
app.use('/api/permissions', permissionsRouter);
app.use('/api/journal', journalRouter);
app.use('/api/expenses', expensesRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/vouchers', vouchersRouter);
app.use('/api/promissory-notes', promissoryNotesRouter);
app.use('/api/treasury', treasuryRouter);
app.use('/api/fixed-assets', fixedAssetsRouter);
app.use('/api/employees', payrollRouter);
app.use('/api/payroll', payrollRunsRouter);
app.use('/api/cost-centers', costCentersRouter);
app.use('/api/budgets', budgetsRouter);
app.use('/api/recurring-entries', recurringEntriesRouter);
app.use('/api/journal-approvals', journalApprovalsRouter);
app.use('/api/fiscal-periods', fiscalPeriodsRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/stock-counts', stockCountsRouter);
app.use('/api/bom', bomRouter);
app.use('/api/work-orders', workOrdersRouter);
app.use('/api/coupons', couponsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/branches', branchesRouter);
app.use('/api/zatca', zatcaRouter);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'المسار غير موجود' });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ الفنان ERP API running on http://localhost:${PORT}`);
});

export default app;
