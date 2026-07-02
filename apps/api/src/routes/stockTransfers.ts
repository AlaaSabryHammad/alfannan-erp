import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { requireAuth, requirePermission } from '../middleware/auth';
import { getPagination, paginatedResponse } from '../lib/paginate';

const router = Router();
router.use(requireAuth);

const transferItemSchema = z.object({
  productId: z.number().int().positive(),
  qty: z.number().positive(),
});

const createTransferSchema = z.object({
  fromWarehouseId: z.number().int().positive(),
  toWarehouseId: z.number().int().positive(),
  date: z.string().optional(),
  status: z.enum(['DONE', 'PENDING']).optional().default('PENDING'),
  notes: z.string().optional().nullable(),
  items: z.array(transferItemSchema).min(1),
});

function generateTransferNo(): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const seq = String((Date.now() % 1000) * 10 + Math.floor(Math.random() * 10)).padStart(4, '0');
  return `TRF-${y}${m}${d}-${seq}`;
}

// GET /api/stock-transfers
router.get('/', requirePermission('transfers.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { page, pageSize, search, skip } = getPagination(req);
    const status = req.query.status as string | undefined;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { transferNo: { contains: search } },
        { notes: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      prisma.stockTransfer.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { date: 'desc' },
        include: {
          fromWarehouse: { select: { id: true, nameAr: true } },
          toWarehouse: { select: { id: true, nameAr: true } },
          items: { include: { product: { select: { id: true, nameAr: true, sku: true } } } },
        },
      }),
      prisma.stockTransfer.count({ where }),
    ]);

    res.json(paginatedResponse(data, total, page, pageSize));
  } catch (err) {
    next(err);
  }
});

// GET /api/stock-transfers/:id
router.get('/:id', requirePermission('transfers.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const transfer = await prisma.stockTransfer.findUniqueOrThrow({
      where: { id: parseInt(req.params.id) },
      include: {
        fromWarehouse: true,
        toWarehouse: true,
        items: { include: { product: { include: { unit: true } } } },
      },
    });
    res.json(transfer);
  } catch (err) {
    next(err);
  }
});

// POST /api/stock-transfers
router.post('/', requirePermission('transfers.create'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createTransferSchema.parse(req.body);
    const userId = req.user!.userId;

    if (body.fromWarehouseId === body.toWarehouseId) {
      res.status(400).json({ error: 'لا يمكن التحويل من وإلى نفس المستودع' });
      return;
    }

    const transfer = await prisma.$transaction(async (tx) => {
      const transferNo = generateTransferNo();

      const tr = await tx.stockTransfer.create({
        data: {
          transferNo,
          fromWarehouseId: body.fromWarehouseId,
          toWarehouseId: body.toWarehouseId,
          date: body.date ? new Date(body.date) : new Date(),
          status: body.status ?? 'PENDING',
          notes: body.notes,
          items: {
            create: body.items.map(item => ({
              productId: item.productId,
              qty: item.qty,
            })),
          },
        },
        include: { items: true },
      });

      // If DONE → move stock atomically (decrement/increment, not read-then-write,
      // so concurrent transfers of the same product can't lose updates).
      if (body.status === 'DONE') {
        for (const item of body.items) {
          // OUT from source
          const srcBal = await tx.stockBalance.upsert({
            where: { productId_warehouseId: { productId: item.productId, warehouseId: body.fromWarehouseId } },
            update: { quantity: { decrement: item.qty } },
            create: { productId: item.productId, warehouseId: body.fromWarehouseId, quantity: -item.qty },
          });
          if (Number(srcBal.quantity) < 0) {
            throw new Error(`الكمية غير متوفرة بالمخزون للمنتج رقم ${item.productId}`);
          }
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              warehouseId: body.fromWarehouseId,
              type: 'TRANSFER',
              quantity: item.qty,
              balanceAfter: Number(srcBal.quantity),
              refType: 'TRANSFER',
              refId: tr.id,
              reason: `تحويل مخزون ${transferNo} (صادر)`,
              createdById: userId,
            },
          });

          // IN to destination
          const dstBal = await tx.stockBalance.upsert({
            where: { productId_warehouseId: { productId: item.productId, warehouseId: body.toWarehouseId } },
            update: { quantity: { increment: item.qty } },
            create: { productId: item.productId, warehouseId: body.toWarehouseId, quantity: item.qty },
          });
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              warehouseId: body.toWarehouseId,
              type: 'TRANSFER',
              quantity: item.qty,
              balanceAfter: Number(dstBal.quantity),
              refType: 'TRANSFER',
              refId: tr.id,
              reason: `تحويل مخزون ${transferNo} (وارد)`,
              createdById: userId,
            },
          });
        }
      }

      return tr;
    });

    const full = await prisma.stockTransfer.findUniqueOrThrow({
      where: { id: transfer.id },
      include: {
        fromWarehouse: true,
        toWarehouse: true,
        items: { include: { product: { include: { unit: true } } } },
      },
    });

    res.status(201).json(full);
  } catch (err: any) {
    if (err?.message?.includes('الكمية غير متوفرة بالمخزون')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

// DELETE /api/stock-transfers/:id
router.delete('/:id', requirePermission('transfers.delete'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id);

    const transfer = await prisma.stockTransfer.findUniqueOrThrow({
      where: { id },
      include: { items: true },
    });

    await prisma.$transaction(async (tx) => {
      // Reverse the stock movement that happened on creation (only if it was DONE):
      // give back to source, take back from destination. Refuse if the destination
      // stock was already consumed elsewhere, rather than corrupting it negative.
      if (transfer.status === 'DONE') {
        const userId = req.user!.userId;
        for (const item of transfer.items) {
          const dstBal = await tx.stockBalance.upsert({
            where: { productId_warehouseId: { productId: item.productId, warehouseId: transfer.toWarehouseId } },
            update: { quantity: { decrement: item.qty } },
            create: { productId: item.productId, warehouseId: transfer.toWarehouseId, quantity: -item.qty },
          });
          if (Number(dstBal.quantity) < 0) {
            throw new Error(`لا يمكن حذف التحويل: كمية المنتج رقم ${item.productId} تم استخدامها بالفعل من مخزون الوجهة`);
          }
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              warehouseId: transfer.toWarehouseId,
              type: 'TRANSFER',
              quantity: item.qty,
              balanceAfter: Number(dstBal.quantity),
              refType: 'TRANSFER',
              refId: transfer.id,
              reason: `حذف تحويل مخزون ${transfer.transferNo} (استرجاع من الوجهة)`,
              createdById: userId,
            },
          });

          const srcBal = await tx.stockBalance.upsert({
            where: { productId_warehouseId: { productId: item.productId, warehouseId: transfer.fromWarehouseId } },
            update: { quantity: { increment: item.qty } },
            create: { productId: item.productId, warehouseId: transfer.fromWarehouseId, quantity: item.qty },
          });
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              warehouseId: transfer.fromWarehouseId,
              type: 'TRANSFER',
              quantity: item.qty,
              balanceAfter: Number(srcBal.quantity),
              refType: 'TRANSFER',
              refId: transfer.id,
              reason: `حذف تحويل مخزون ${transfer.transferNo} (إعادة للمصدر)`,
              createdById: userId,
            },
          });
        }
      }

      await tx.stockTransfer.delete({ where: { id } });
    });
    res.json({ success: true });
  } catch (err: any) {
    if (err?.code === 'P2003' || err?.code === 'P2014') {
      res.status(400).json({ error: 'لا يمكن الحذف لارتباطه بسجلات أخرى' });
      return;
    }
    if (err?.message?.includes('لا يمكن حذف التحويل')) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err);
  }
});

export default router;
