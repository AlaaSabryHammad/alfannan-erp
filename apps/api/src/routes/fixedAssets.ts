import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma, JournalSource, AssetCategory } from '@prisma/client';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';
import { postJournalEntry, reverseJournalEntryBySource, ACCT } from '../lib/ledger';

const router = Router();
router.use(requireAuth);

// ── Zod schemas ───────────────────────────────────────────────────────────────
const createAssetSchema = z.object({
  assetCode: z.string().optional(), // auto-generated if omitted
  nameAr: z.string().min(1),
  category: z.enum(['EQUIPMENT', 'VEHICLE', 'FURNITURE', 'BUILDING', 'OTHER']).optional(),
  purchaseDate: z.string().optional(),
  purchaseCost: z.number().positive(),
  salvageValue: z.number().min(0).optional().default(0),
  usefulLifeMonths: z.number().int().positive(),
  description: z.string().optional().nullable(),
});

/** Build asset code: FA-NNNN (count-based). */
async function generateAssetCode(tx: Prisma.TransactionClient): Promise<string> {
  const count = await tx.fixedAsset.count();
  return `FA-${String(count + 1).padStart(4, '0')}`;
}

// ── GET /api/fixed-assets — list + KPIs ───────────────────────────────────────
router.get('/', requirePermission('assets.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, skip, search } = getPagination(req);
    const categoryFilter = req.query.category as AssetCategory | undefined;

    const where: Record<string, unknown> = {};
    if (categoryFilter) where.category = categoryFilter;
    if (search) {
      where.OR = [
        { nameAr: { contains: search, mode: 'insensitive' } },
        { assetCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.fixedAsset.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ id: 'desc' }],
      }),
      prisma.fixedAsset.count({ where }),
    ]);

    // KPIs across ALL assets (not just the current page)
    const allAssets = await prisma.fixedAsset.findMany({ where: { status: 'ACTIVE' } });
    const totalCost = allAssets.reduce((s, a) => s + Number(a.purchaseCost), 0);
    const totalAccumDep = allAssets.reduce((s, a) => s + Number(a.accumulatedDepreciation), 0);
    const totalBookValue = allAssets.reduce((s, a) => s + Number(a.bookValue), 0);

    res.json({
      data,
      pagination: { total, page, pageSize, totalPages: Math.ceil(total / pageSize) },
      kpis: {
        totalCost,
        totalAccumulatedDepreciation: totalAccumDep,
        totalBookValue,
        count: allAssets.length,
      },
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/fixed-assets/:id ─────────────────────────────────────────────────
router.get('/:id', requirePermission('assets.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asset = await prisma.fixedAsset.findUniqueOrThrow({ where: { id: parseInt(req.params.id) } });
    res.json(asset);
  } catch (err) {
    next(err);
  }
});

// ── POST /api/fixed-assets — create + post purchase journal entry ─────────────
router.post('/', requirePermission('assets.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createAssetSchema.parse(req.body);
    const userId = req.user!.userId;
    const purchaseDate = body.purchaseDate ? new Date(body.purchaseDate) : new Date();
    const salvage = body.salvageValue ?? 0;

    const asset = await prisma.$transaction(async (tx) => {
      const assetCode = body.assetCode?.trim() || (await generateAssetCode(tx));
      const bookValue = new Prisma.Decimal(body.purchaseCost);

      const created = await tx.fixedAsset.create({
        data: {
          assetCode,
          nameAr: body.nameAr,
          category: (body.category ?? 'OTHER') as AssetCategory,
          purchaseDate,
          purchaseCost: new Prisma.Decimal(body.purchaseCost),
          salvageValue: new Prisma.Decimal(salvage),
          usefulLifeMonths: body.usefulLifeMonths,
          accumulatedDepreciation: new Prisma.Decimal(0),
          bookValue,
          description: body.description ?? null,
          createdById: userId,
        },
      });

      // Post purchase entry: Dr 1400 Fixed Assets / Cr 1000 Cash
      await postJournalEntry(tx, {
        date: purchaseDate,
        description: `شراء أصل ثابت ${assetCode} — ${body.nameAr}`,
        sourceType: JournalSource.DEPRECIATION,
        sourceId: created.id,
        createdById: userId,
        lines: [
          { accountCode: ACCT.FIXED_ASSETS, debit: body.purchaseCost, credit: 0, description: `أصل ثابت: ${body.nameAr}` },
          { accountCode: ACCT.CASH, debit: 0, credit: body.purchaseCost, description: `سداد شراء أصل` },
        ],
      });

      return created;
    });

    res.status(201).json(asset);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      res.status(400).json({ error: 'رمز الأصل مستخدم مسبقاً' });
      return;
    }
    next(err);
  }
});

// ── POST /api/fixed-assets/:id/depreciate — monthly depreciation ──────────────
router.post('/:id/depreciate', requirePermission('assets.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    const userId = req.user!.userId;
    const bodyDate = req.body?.date as string | undefined;
    const depDate = bodyDate ? new Date(bodyDate) : new Date();

    const result = await prisma.$transaction(async (tx) => {
      const asset = await tx.fixedAsset.findUniqueOrThrow({ where: { id } });
      if (asset.status !== 'ACTIVE') {
        throw new Error('الأصل غير نشط (تم التخلص منه)');
      }

      const cost = Number(asset.purchaseCost);
      const salvage = Number(asset.salvageValue);
      const lifeMonths = asset.usefulLifeMonths;
      const monthlyDep = (cost - salvage) / lifeMonths;

      const currentBook = Number(asset.bookValue);
      // Don't depreciate below salvage value
      const actualDep = Math.min(monthlyDep, Math.max(0, currentBook - salvage));
      if (actualDep <= 0) {
        throw new Error('الأصل وصل إلى قيمته المتبقية ولا يمكن إهلاكه أكثر');
      }

      const newAccum = Number(asset.accumulatedDepreciation) + actualDep;
      const newBook = currentBook - actualDep;

      const updated = await tx.fixedAsset.update({
        where: { id },
        data: {
          accumulatedDepreciation: new Prisma.Decimal(newAccum),
          bookValue: new Prisma.Decimal(newBook),
        },
      });

      // Post depreciation entry: Dr 6100 Depreciation Expense / Cr 1450 Accumulated Depreciation
      await postJournalEntry(tx, {
        date: depDate,
        description: `إهلاك شهري — ${asset.assetCode} ${asset.nameAr}`,
        sourceType: JournalSource.DEPRECIATION,
        sourceId: asset.id,
        createdById: userId,
        lines: [
          { accountCode: ACCT.DEPRECIATION_EXP, debit: actualDep, credit: 0, description: `مصروف إهلاك: ${asset.nameAr}` },
          { accountCode: ACCT.ACC_DEPRECIATION, debit: 0, credit: actualDep, description: `مجمع الإهلاك: ${asset.nameAr}` },
        ],
      });

      return { asset: updated, depreciationAmount: actualDep, monthlyDep, newBookValue: newBook };
    });

    res.json(result);
  } catch (err: any) {
    if (typeof err?.message === 'string' && (err.message.includes('غير نشط') || err.message.includes('قيمته المتبقية'))) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// ── DELETE /api/fixed-assets/:id — reverse journal + delete ───────────────────
router.delete('/:id', requirePermission('assets.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);
    await prisma.$transaction(async (tx) => {
      // Reverse ALL journal entries linked to this asset (purchase + all depreciation runs)
      // reverseJournalEntryBySource reverses the FIRST matching entry; loop to catch all.
      // Strategy: gather all JE ids for this source, reverse each's balances manually.
      const entries = await tx.journalEntry.findMany({
        where: { sourceType: JournalSource.DEPRECIATION, sourceId: id },
        include: { lines: { include: { account: { select: { id: true, type: true } } } } },
      });

      for (const entry of entries) {
        for (const line of entry.lines) {
          const debit = Number(line.debit);
          const credit = Number(line.credit);
          const isDebitNorm = line.account.type === 'ASSET' || line.account.type === 'EXPENSE';
          const net = isDebitNorm ? debit - credit : credit - debit;
          if (net !== 0) {
            await tx.account.update({
              where: { id: line.accountId },
              data: { currentBalance: { decrement: new Prisma.Decimal(net) } },
            });
          }
        }
        await tx.journalEntry.delete({ where: { id: entry.id } });
      }

      await tx.fixedAsset.delete({ where: { id } });
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

export default router;
