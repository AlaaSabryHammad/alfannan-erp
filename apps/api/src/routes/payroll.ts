import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma, JournalSource } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { postJournalEntry, reverseJournalEntryBySource, ACCT } from '../lib/ledger';

// Two routers: one for employees CRUD, one for payroll runs.
export const employeeRouter = Router();
employeeRouter.use(requireAuth);

export const payrollRouter = Router();
payrollRouter.use(requireAuth);

const router = employeeRouter; // alias so the employee routes below attach to employeeRouter

// ── Zod schemas ───────────────────────────────────────────────────────────────
const employeeSchema = z.object({
  nameAr: z.string().min(1),
  nationalId: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  position: z.string().optional().nullable(),
  department: z.string().optional().nullable(),
  managerId: z.number().int().positive().optional().nullable(),
  basicSalary: z.number().min(0).optional().default(0),
  allowances: z.number().min(0).optional().default(0),
  deductions: z.number().min(0).optional().default(0),
  bankAccount: z.string().optional().nullable(),
  hireDate: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

const runPayrollSchema = z.object({
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000),
  payVia: z.enum(['CASH', 'PAYABLE']).optional().default('CASH'),
  date: z.string().optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// EMPLOYEES
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/employees
router.get('/', requirePermission('hr.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, skip, search } = getPagination(req);
    const statusFilter = req.query.status as string | undefined;

    const where: Record<string, unknown> = {};
    if (statusFilter) where.status = statusFilter;
    if (search) {
      where.OR = [
        { nameAr: { contains: search, mode: 'insensitive' } },
        { position: { contains: search, mode: 'insensitive' } },
        { nationalId: { contains: search } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.employee.findMany({ where, skip, take: pageSize, orderBy: { id: 'desc' } }),
      prisma.employee.count({ where }),
    ]);

    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/org-chart — بيانات الهيكل التنظيمي (كل الموظفين النشطين مع مسؤولهم المباشر)
// Must be registered before GET /:id, otherwise Express would match "org-chart" as an :id param.
router.get('/org-chart', requirePermission('hr.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const employees = await prisma.employee.findMany({
      where: { status: 'ACTIVE' },
      select: { id: true, nameAr: true, position: true, department: true, managerId: true },
      orderBy: { id: 'asc' },
    });
    res.json(employees);
  } catch (err) {
    next(err);
  }
});

// GET /api/employees/:id
router.get('/:id', requirePermission('hr.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const emp = await prisma.employee.findUniqueOrThrow({ where: { id: parseInt(req.params.id) } });
    res.json(emp);
  } catch (err) {
    next(err);
  }
});

// POST /api/employees
router.post('/', requirePermission('hr.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = employeeSchema.parse(req.body);
    const emp = await prisma.employee.create({
      data: {
        nameAr: body.nameAr,
        nationalId: body.nationalId ?? null,
        phone: body.phone ?? null,
        position: body.position ?? null,
        department: body.department ?? null,
        managerId: body.managerId ?? null,
        basicSalary: new Prisma.Decimal(body.basicSalary ?? 0),
        allowances: new Prisma.Decimal(body.allowances ?? 0),
        deductions: new Prisma.Decimal(body.deductions ?? 0),
        bankAccount: body.bankAccount ?? null,
        hireDate: body.hireDate ? new Date(body.hireDate) : new Date(),
        status: (body.status ?? 'ACTIVE') as 'ACTIVE' | 'INACTIVE',
      },
    });
    res.status(201).json(emp);
  } catch (err) {
    next(err);
  }
});

// PUT /api/employees/:id
router.put('/:id', requirePermission('hr.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const body = employeeSchema.partial().parse(req.body);
    if (body.managerId === id) {
      res.status(400).json({ error: 'لا يمكن أن يكون الموظف مسؤوله المباشر' });
      return;
    }
    const data: Record<string, unknown> = { ...body };
    if (body.basicSalary != null) data.basicSalary = new Prisma.Decimal(body.basicSalary);
    if (body.allowances != null) data.allowances = new Prisma.Decimal(body.allowances);
    if (body.deductions != null) data.deductions = new Prisma.Decimal(body.deductions);
    if (body.hireDate != null) data.hireDate = new Date(body.hireDate);
    // Only overwrite status when the caller actually sent one — a partial update
    // (e.g. editing salary) must not silently reactivate an INACTIVE employee.
    if (body.status !== undefined) data.status = body.status;

    const emp = await prisma.employee.update({ where: { id }, data });
    res.json(emp);
  } catch (err: any) {
    if (typeof err?.message === 'string' && err.message.includes('لا يمكن أن يكون')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// DELETE /api/employees/:id
router.delete('/:id', requirePermission('hr.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    await prisma.employee.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
  } catch (err: any) {
    if (err?.code === 'P2003' || err?.code === 'P2014') {
      res.status(400).json({ error: 'لا يمكن الحذف لارتباطه بسجلات رواتب أو بموظفين يتبعونه في الهيكل التنظيمي' });
      return;
    }
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PAYROLL RUNS (mounted at /api/payroll)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/payroll/runs — list payroll runs
payrollRouter.get('/runs', requirePermission('hr.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, skip } = getPagination(req);
    const [data, total] = await Promise.all([
      prisma.payrollRun.findMany({
        skip,
        take: pageSize,
        orderBy: { id: 'desc' },
        include: { _count: { select: { items: true } } },
      }),
      prisma.payrollRun.count(),
    ]);
    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/payroll/runs/:id — run detail with items
payrollRouter.get('/runs/:id', requirePermission('hr.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const run = await prisma.payrollRun.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: { items: { include: { employee: { select: { id: true, nameAr: true, position: true, bankAccount: true } } } } },
    });
    res.json(run);
  } catch (err) {
    next(err);
  }
});

// POST /api/payroll/run — generate + post a payroll run
payrollRouter.post('/run', requirePermission('hr.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = runPayrollSchema.parse(req.body);
    const userId = req.user!.userId;
    const payDate = body.date ? new Date(body.date) : new Date();

    const result = await prisma.$transaction(async (tx) => {
      // Prevent duplicate runs for the same month/year
      const existing = await tx.payrollRun.findFirst({ where: { month: body.month, year: body.year } });
      if (existing) {
        throw new Error(`تم تشغيل الرواتب للفترة ${body.month}/${body.year} مسبقاً`);
      }

      const employees = await tx.employee.findMany({ where: { status: 'ACTIVE' } });
      if (employees.length === 0) {
        throw new Error('لا يوجد موظفون نشطون');
      }

      // Build payroll items
      let totalGross = 0;
      let totalDeductions = 0;
      let totalNet = 0;
      const items = employees.map((emp) => {
        const basic = Number(emp.basicSalary);
        const allow = Number(emp.allowances);
        const deduct = Number(emp.deductions);
        const gross = basic + allow;
        const net = gross - deduct;
        totalGross += gross;
        totalDeductions += deduct;
        totalNet += net;
        return {
          employeeId: emp.id,
          basic,
          allowances: allow,
          deductions: deduct,
          net,
        };
      });

      // Generate run number — max + 1 (not count + 1): runs are deletable, and a
      // count-based sequence would re-issue a number that still exists.
      const runPrefix = `PR-${body.year}${String(body.month).padStart(2, '0')}-`;
      const lastRun = await tx.payrollRun.findFirst({
        where: { runNo: { startsWith: runPrefix } },
        orderBy: { runNo: 'desc' },
        select: { runNo: true },
      });
      const lastRunSeq = lastRun ? parseInt(lastRun.runNo.slice(runPrefix.length), 10) || 0 : 0;
      const runNo = `${runPrefix}${String(lastRunSeq + 1).padStart(4, '0')}`;

      const run = await tx.payrollRun.create({
        data: {
          runNo,
          month: body.month,
          year: body.year,
          totalGross: new Prisma.Decimal(totalGross),
          totalDeductions: new Prisma.Decimal(totalDeductions),
          totalNet: new Prisma.Decimal(totalNet),
          status: 'POSTED',
          createdById: userId,
          items: {
            create: items.map((it) => ({
              employeeId: it.employeeId,
              basic: new Prisma.Decimal(it.basic),
              allowances: new Prisma.Decimal(it.allowances),
              deductions: new Prisma.Decimal(it.deductions),
              net: new Prisma.Decimal(it.net),
            })),
          },
        },
        include: { items: true },
      });

      // Post payroll journal entry: Dr 6200 Salaries (gross) / Cr 1000 Cash or 2200 Payable (net) + Cr 2200 deductions
      const creditAccount = body.payVia === 'PAYABLE' ? ACCT.SALARIES_PAYABLE : ACCT.CASH;
      const lines: Array<{ accountCode: string; debit: number; credit: number; description?: string }> = [
        { accountCode: ACCT.SALARIES_EXP, debit: totalGross, credit: 0, description: `رواتب ${body.month}/${body.year}` },
      ];
      // Net pay
      lines.push({ accountCode: creditAccount, debit: 0, credit: totalNet, description: `صافي الرواتب ${runNo}` });
      // Deductions (if any) → credited to salaries payable
      if (totalDeductions > 0) {
        lines.push({ accountCode: ACCT.SALARIES_PAYABLE, debit: 0, credit: totalDeductions, description: `خصومات الرواتب ${runNo}` });
      }

      const entry = await postJournalEntry(tx, {
        date: payDate,
        description: `تشغيل رواتب ${runNo}`,
        sourceType: JournalSource.PAYROLL,
        sourceId: run.id,
        createdById: userId,
        lines,
      });
      await tx.payrollRun.update({ where: { id: run.id }, data: { journalEntryId: entry.id } });

      return run;
    });

    res.status(201).json(result);
  } catch (err: any) {
    if (typeof err?.message === 'string' && (err.message.includes('مسبقاً') || err.message.includes('نشطون'))) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// DELETE /api/payroll/runs/:id — reverse + delete
payrollRouter.delete('/runs/:id', requirePermission('hr.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.$transaction(async (tx) => {
      await reverseJournalEntryBySource(tx, JournalSource.PAYROLL, id);
      await tx.payrollRun.delete({ where: { id } });
    });
    res.json({ success: true });
  } catch (err: any) {
    if (err?.code === 'P2003' || err?.code === 'P2014') {
      res.status(400).json({ error: 'لا يمكن الحذف لارتباطه بسجلات أخرى' });
      return;
    }
    next(err);
  }
});

export default employeeRouter;
export { payrollRouter as payrollRunsRouter };
