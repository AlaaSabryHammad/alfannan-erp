import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';

const router = Router();
router.use(requireAuth);

const accountSchema = z.object({
  code: z.string().min(1),
  nameAr: z.string().min(1),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
  parentId: z.number().int().positive().optional().nullable(),
  openingBalance: z.number().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

// currentBalance is always derived (opening balance + ledger activity), never
// set directly by the client — recalculated here after every create/update.
async function recalcAccountBalance(accountId: number) {
  const acct = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
  const agg = await prisma.journalLine.aggregate({
    where: { accountId },
    _sum: { debit: true, credit: true },
  });

  const totalDebit  = Number(agg._sum.debit  ?? 0);
  const totalCredit = Number(agg._sum.credit ?? 0);
  const opening     = Number(acct.openingBalance);
  const isDebitNorm = acct.type === 'ASSET' || acct.type === 'EXPENSE';

  const newBalance = isDebitNorm
    ? opening + totalDebit - totalCredit
    : opening + totalCredit - totalDebit;

  return prisma.account.update({
    where: { id: accountId },
    data: { currentBalance: new Prisma.Decimal(newBalance) },
  });
}

// GET /api/accounts — returns flat list (paginated)
router.get('/', requirePermission('accounts.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const typeFilter = req.query.type as string | undefined;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { nameAr: { contains: search, mode: 'insensitive' } },
        { code: { contains: search } },
      ];
    }
    if (typeFilter) where.type = typeFilter;

    const [data, total] = await Promise.all([
      prisma.account.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { code: 'asc' },
        include: { parent: { select: { id: true, code: true, nameAr: true } } },
      }),
      prisma.account.count({ where }),
    ]);

    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/accounts/tree — hierarchical tree grouped by type (any depth)
router.get('/tree', requirePermission('accounts.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accounts = await prisma.account.findMany({ orderBy: { code: 'asc' } });

    type Node = (typeof accounts)[number] & { children: Node[] };
    const nodeById = new Map<number, Node>();
    for (const a of accounts) nodeById.set(a.id, { ...a, children: [] });

    const roots: Node[] = [];
    for (const a of accounts) {
      const node = nodeById.get(a.id)!;
      const parent = a.parentId !== null ? nodeById.get(a.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }

    // A parent/group account (e.g. "الاصول الثابتة") usually has no postings of
    // its own — its displayed balance should roll up everything under it, not
    // just its own ledger balance.
    const rollup = (node: Node): number =>
      Number(node.currentBalance) + node.children.reduce((s, c) => s + rollup(c), 0);

    const withRollup = (node: Node): Node => ({
      ...node,
      currentBalance: new Prisma.Decimal(rollup(node)),
      children: node.children.map(withRollup),
    });

    // Group by type with totals
    const typeOrder = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const;
    const tree = typeOrder.map(type => {
      const typeRoots = roots.filter(a => a.type === type).map(withRollup);
      const total = typeRoots.reduce((sum, a) => sum + Number(a.currentBalance), 0);
      return { type, accounts: typeRoots, total };
    });

    res.json(tree);
  } catch (err) {
    next(err);
  }
});

// POST /api/accounts/recompute — rebuild all account balances from ledger
// Must come BEFORE /:id route so it's not matched as an id
router.post('/recompute', requirePermission('accounts.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accounts = await prisma.account.findMany({ select: { id: true } });
    for (const acct of accounts) {
      await recalcAccountBalance(acct.id);
    }
    res.json({ success: true, accountsUpdated: accounts.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/accounts/:id/ledger — كشف حساب
router.get('/:id/ledger', requirePermission('accounts.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const accountId = parseInt(req.params.id);
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to   = req.query.to   ? new Date(req.query.to as string)   : undefined;

    const account = await prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      select: { id: true, code: true, nameAr: true, type: true, openingBalance: true },
    });

    const isDebitNorm = account.type === 'ASSET' || account.type === 'EXPENSE';

    // Lines ordered chronologically
    const lines = await prisma.journalLine.findMany({
      where: {
        accountId,
        ...(from || to
          ? { entry: { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } }
          : {}),
      },
      include: {
        entry: { select: { id: true, entryNo: true, date: true, description: true, sourceType: true } },
      },
      orderBy: [{ entry: { date: 'asc' } }, { id: 'asc' }],
    });

    // Build running balance
    let runningBalance = Number(account.openingBalance);
    const ledgerLines = lines.map(line => {
      const debit  = Number(line.debit);
      const credit = Number(line.credit);
      const effect = isDebitNorm ? debit - credit : credit - debit;
      runningBalance += effect;

      return {
        journalLineId: line.id,
        entryId:       line.entry.id,
        entryNo:       line.entry.entryNo,
        date:          line.entry.date,
        description:   line.description ?? line.entry.description,
        sourceType:    line.entry.sourceType,
        debit,
        credit,
        balance:       runningBalance,
      };
    });

    res.json({
      account: {
        id:            account.id,
        code:          account.code,
        nameAr:        account.nameAr,
        type:          account.type,
        openingBalance: Number(account.openingBalance),
      },
      lines: ledgerLines,
      closingBalance: runningBalance,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/accounts/:id
router.get('/:id', requirePermission('accounts.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const account = await prisma.account.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: {
        parent: { select: { id: true, code: true, nameAr: true } },
        children: { orderBy: { code: 'asc' } },
      },
    });
    res.json(account);
  } catch (err) {
    next(err);
  }
});

// POST /api/accounts
router.post('/', requirePermission('accounts.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = accountSchema.parse(req.body);
    const account = await prisma.account.create({ data });
    const updated = await recalcAccountBalance(account.id);
    res.status(201).json(updated);
  } catch (err) {
    next(err);
  }
});

// PUT /api/accounts/:id
router.put('/:id', requirePermission('accounts.edit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const data = accountSchema.partial().parse(req.body);
    const id = parseInt(req.params.id);
    await prisma.account.update({ where: { id }, data });
    const updated = await recalcAccountBalance(id);
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/accounts/:id
router.delete('/:id', requirePermission('accounts.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Check for children
    const childCount = await prisma.account.count({ where: { parentId: parseInt(req.params.id) } });
    if (childCount > 0) {
      res.status(400).json({ error: 'لا يمكن حذف حساب له حسابات فرعية' });
      return;
    }
    await prisma.account.delete({ where: { id: parseInt(req.params.id) } });
    res.json({ success: true });
  } catch (err: any) {
    if (err?.code === 'P2003' || err?.code === 'P2014') {
      res.status(400).json({ error: 'لا يمكن الحذف لارتباطه بسجلات أخرى' });
      return;
    }
    next(err);
  }
});

export default router;
