/**
 * إنشاء فاتورة شراء — الخدمة المشتركة
 *
 * The purchase-invoice creation logic (branch stamping, moving-average
 * costing, atomic stock receipt, supplier balance, ledger posting) extracted
 * from the route so purchase-order conversion can create an invoice inside
 * ITS OWN transaction atomically with marking the order converted.
 */
import { Prisma, JournalSource } from '@prisma/client';
import { postJournalEntry, ACCT } from './ledger';
import { applyMovingAverageCost } from './costing';

export interface PurchaseInvoiceItemInput {
  productId: number;
  qty: number;
  unitCost: number;
}

export interface CreatePurchaseInvoiceInput {
  supplierId: number;
  warehouseId: number;
  date?: string;
  discount?: number;
  tax?: number;
  paymentStatus?: 'PAID' | 'UNPAID' | 'PARTIAL';
  receiveStatus?: 'RECEIVED' | 'PENDING';
  notes?: string | null;
  items: PurchaseInvoiceItemInput[];
  userId: number;
}

function generatePoNo(): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const seq = String((Date.now() % 1000) * 10 + Math.floor(Math.random() * 10)).padStart(4, '0');
  return `PO-${y}${m}${d}-${seq}`;
}

export async function createPurchaseInvoiceInTx(tx: Prisma.TransactionClient, body: CreatePurchaseInvoiceInput) {
  const userId = body.userId;
  const subtotal = body.items.reduce((s, item) => s + item.qty * item.unitCost, 0);
  const total = subtotal - (body.discount ?? 0) + (body.tax ?? 0);
  const refNo = generatePoNo();

  // The document belongs to its warehouse's branch
  const poWarehouse = await tx.warehouse.findUniqueOrThrow({
    where: { id: body.warehouseId },
    select: { branchId: true },
  });

  const inv = await tx.purchaseInvoice.create({
    data: {
      refNo,
      supplierId: body.supplierId,
      warehouseId: body.warehouseId,
      branchId: poWarehouse.branchId,
      date: body.date ? new Date(body.date) : new Date(),
      subtotal,
      discount: body.discount ?? 0,
      tax: body.tax ?? 0,
      total,
      paymentStatus: body.paymentStatus ?? 'UNPAID',
      receiveStatus: body.receiveStatus ?? 'PENDING',
      notes: body.notes,
      items: {
        create: body.items.map(item => ({
          productId: item.productId,
          qty: item.qty,
          unitCost: item.unitCost,
          lineTotal: item.qty * item.unitCost,
        })),
      },
    },
    include: { items: true },
  });

  // If RECEIVED → increment stock atomically & write IN movements
  if (body.receiveStatus === 'RECEIVED') {
    // The invoice-level discount lowers the effective unit cost of every
    // line proportionally — that net cost feeds the moving average.
    const netFactor = subtotal > 0 ? (subtotal - (body.discount ?? 0)) / subtotal : 1;
    for (const item of body.items) {
      // Re-average BEFORE incrementing the stock (reads on-hand qty)
      await applyMovingAverageCost(tx, item.productId, item.qty, item.unitCost * netFactor);

      const balance = await tx.stockBalance.upsert({
        where: { productId_warehouseId: { productId: item.productId, warehouseId: body.warehouseId } },
        update: { quantity: { increment: item.qty } },
        create: { productId: item.productId, warehouseId: body.warehouseId, quantity: item.qty },
      });

      await tx.stockMovement.create({
        data: {
          productId: item.productId,
          warehouseId: body.warehouseId,
          type: 'IN',
          quantity: item.qty,
          balanceAfter: Number(balance.quantity),
          refType: 'PURCHASE',
          refId: inv.id,
          reason: `فاتورة شراء ${refNo}`,
          createdById: userId,
        },
      });
    }
  }

  // Increment supplier balance only if this invoice actually creates a payable
  // (matches the sales-invoice side, which only touches customer balance for
  // CREDIT/unpaid invoices — an invoice paid in full at creation owes nothing).
  if (body.paymentStatus !== 'PAID') {
    await tx.supplier.update({
      where: { id: body.supplierId },
      data: { currentBalance: { increment: total } },
    });
  }

  // ── Ledger posting (only when RECEIVED) ──────────────────────────────────
  if (body.receiveStatus === 'RECEIVED') {
    const creditAccountCode =
      body.paymentStatus === 'PAID' ? ACCT.CASH : ACCT.AP;

    const taxAmount = Number(body.tax ?? 0);
    // Inventory is booked at NET cost (after discount) — booking the gross
    // subtotal while crediting the discounted total leaves the entry
    // unbalanced and postJournalEntry rejects it.
    const inventoryAmount = subtotal - (body.discount ?? 0);

    const ledgerLines = [
      // Dr: 1200 inventory = subtotal
      { accountCode: ACCT.INVENTORY, debit: inventoryAmount, credit: 0, description: `مخزون ${refNo}` },
      // Cr: cash or AP = total
      { accountCode: creditAccountCode, debit: 0, credit: total, description: `مشتريات ${refNo}` },
    ];

    // Dr: 1300 input VAT = tax (only if tax > 0)
    if (taxAmount > 0) {
      ledgerLines.push({ accountCode: ACCT.INPUT_VAT, debit: taxAmount, credit: 0, description: `ضريبة شراء ${refNo}` });
    }

    await postJournalEntry(tx, {
      date: body.date ? new Date(body.date) : new Date(),
      description: `فاتورة شراء ${refNo}`,
      sourceType: JournalSource.PURCHASE_INVOICE,
      sourceId: inv.id,
      createdById: userId,
      lines: ledgerLines,
    });
  }

  return inv;
}
