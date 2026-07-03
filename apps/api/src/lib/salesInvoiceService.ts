/**
 * إنشاء فاتورة بيع — الخدمة المشتركة
 *
 * The full sales-invoice creation logic (coupons, loyalty, credit limit,
 * atomic stock decrement, customer balance, ledger posting) extracted from the
 * route so that order fulfillment can create an invoice inside ITS OWN
 * transaction atomically with marking the order fulfilled.
 *
 * Throws Arabic Error messages for business rejections — callers map the known
 * ones to HTTP 400.
 */
import { Prisma, JournalSource } from '@prisma/client';
import { postJournalEntry, ACCT } from './ledger';
import { validateCoupon, computeCouponDiscount } from '../routes/coupons';

export interface SalesInvoiceItemInput {
  productId: number;
  qty: number;
  unitPrice: number;
}

export interface CreateSalesInvoiceInput {
  customerId: number;
  warehouseId: number;
  discount?: number;
  tax?: number;
  paidStatus?: 'PAID' | 'UNPAID' | 'PARTIAL';
  paymentMethod?: 'CASH' | 'CARD' | 'CREDIT';
  couponCode?: string | null;
  redeemPoints?: number;
  items: SalesInvoiceItemInput[];
  cashierId: number;
}

/** Messages that are business rejections (HTTP 400), not server errors. */
export const SALES_INVOICE_USER_ERRORS = [
  'الكمية غير متوفرة بالمخزون',
  'تجاوز الحد الائتماني',
  'الكوبون',
  'نقاط الولاء',
  'قيمة الخصم الإجمالية',
];

function generateRefNo(): string {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  // Combine sub-second time with randomness so concurrent requests in the same
  // second don't collide on the same 4-digit sequence.
  const seq = String((Date.now() % 1000) * 10 + Math.floor(Math.random() * 10)).padStart(4, '0');
  return `INV-${y}${m}${d}-${seq}`;
}

export async function createSalesInvoiceInTx(tx: Prisma.TransactionClient, body: CreateSalesInvoiceInput) {
  const cashierId = body.cashierId;

  // Calculate totals
  const subtotal = body.items.reduce((s, item) => s + item.qty * item.unitPrice, 0);
  const refNo = generateRefNo();

  const customer = await tx.customer.findUniqueOrThrow({
    where: { id: body.customerId },
    select: { currentBalance: true, creditLimit: true, nameAr: true, loyaltyPoints: true },
  });

  // ── Coupon validation & discount ─────────────────────────────────────────
  let coupon: { id: number; usedCount: number } | null = null;
  let couponDiscount = 0;
  if (body.couponCode) {
    const found = await tx.coupon.findUnique({ where: { code: body.couponCode.trim().toUpperCase() } });
    const invalidReason = validateCoupon(found, subtotal);
    if (invalidReason) throw new Error(invalidReason);
    coupon = found!;
    couponDiscount = computeCouponDiscount(found!, subtotal);
  }

  // ── Loyalty points redemption ────────────────────────────────────────────
  const redeemPoints = body.redeemPoints ?? 0;
  let pointsValue = 0;
  if (redeemPoints > 0) {
    if (redeemPoints > Number(customer.loyaltyPoints)) {
      throw new Error(`نقاط الولاء غير كافية — الرصيد الحالي ${Number(customer.loyaltyPoints)} نقطة`);
    }
    const pointValueSetting = await tx.setting.findUnique({ where: { key: 'loyaltyPointValue' } });
    pointsValue = redeemPoints * parseFloat(pointValueSetting?.value ?? '0.05');
  }

  const finalDiscount = (body.discount ?? 0) + couponDiscount + pointsValue;
  const total = subtotal - finalDiscount + (body.tax ?? 0);
  if (total < 0) {
    throw new Error('قيمة الخصم الإجمالية (يدوي + كوبون + نقاط الولاء) تتجاوز إجمالي الفاتورة');
  }

  // Credit limit enforcement — only when this sale would actually raise the
  // receivable (credit or not fully paid) and the customer has a limit set
  // (creditLimit === 0 means "no limit configured yet", not "zero credit").
  const willRaiseBalance = body.paymentMethod === 'CREDIT' || body.paidStatus !== 'PAID';
  if (willRaiseBalance) {
    const creditLimit = Number(customer.creditLimit);
    if (creditLimit > 0) {
      const projectedBalance = Number(customer.currentBalance) + total;
      if (projectedBalance > creditLimit) {
        throw new Error(
          `تجاوز الحد الائتماني للعميل ${customer.nameAr}: الرصيد الحالي ${Number(customer.currentBalance).toFixed(2)} + هذه الفاتورة ${total.toFixed(2)} = ${projectedBalance.toFixed(2)}، ويتجاوز الحد المسموح ${creditLimit.toFixed(2)}`
        );
      }
    }
  }

  // ── Loyalty points earned on this sale ───────────────────────────────────
  const loyaltyEnabledSetting = await tx.setting.findUnique({ where: { key: 'loyaltyEnabled' } });
  const loyaltyEarnRateSetting = await tx.setting.findUnique({ where: { key: 'loyaltyEarnRate' } });
  const loyaltyEnabled = (loyaltyEnabledSetting?.value ?? 'true') === 'true';
  const pointsEarned = loyaltyEnabled ? Math.floor(total * parseFloat(loyaltyEarnRateSetting?.value ?? '0.1')) : 0;

  // The document belongs to its warehouse's branch
  const saleWarehouse = await tx.warehouse.findUniqueOrThrow({
    where: { id: body.warehouseId },
    select: { branchId: true },
  });

  // Fetch products for costPrice
  const productIds = body.items.map(i => i.productId);
  const productMap = await tx.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, costPrice: true },
  }).then(rows => new Map(rows.map(r => [r.id, r])));

  // Create invoice
  const inv = await tx.salesInvoice.create({
    data: {
      refNo,
      customerId: body.customerId,
      warehouseId: body.warehouseId,
      cashierId,
      branchId: saleWarehouse.branchId,
      subtotal,
      discount: finalDiscount,
      tax: body.tax ?? 0,
      total,
      paidStatus: body.paidStatus ?? 'PAID',
      paymentMethod: body.paymentMethod ?? 'CASH',
      couponId: coupon?.id ?? null,
      pointsEarned,
      pointsRedeemed: redeemPoints,
      items: {
        create: body.items.map(item => ({
          productId: item.productId,
          qty: item.qty,
          unitPrice: item.unitPrice,
          lineTotal: item.qty * item.unitPrice,
        })),
      },
    },
    include: { items: true },
  });

  if (coupon) {
    await tx.coupon.update({ where: { id: coupon.id }, data: { usedCount: { increment: 1 } } });
  }

  if (redeemPoints > 0) {
    await tx.loyaltyTransaction.create({
      data: { customerId: body.customerId, type: 'REDEEM', points: -redeemPoints, salesInvoiceId: inv.id, description: `استبدال نقاط — فاتورة ${refNo}` },
    });
  }
  if (pointsEarned > 0) {
    await tx.loyaltyTransaction.create({
      data: { customerId: body.customerId, type: 'EARN', points: pointsEarned, salesInvoiceId: inv.id, description: `نقاط مكتسبة — فاتورة ${refNo}` },
    });
  }
  if (pointsEarned !== redeemPoints) {
    await tx.customer.update({
      where: { id: body.customerId },
      data: { loyaltyPoints: { increment: pointsEarned - redeemPoints } },
    });
  }

  // Decrement stock atomically & write OUT movements.
  // Using {decrement} (not read-then-write) makes this safe under concurrent
  // requests for the same product/warehouse — Postgres serializes the row update.
  for (const item of body.items) {
    const balance = await tx.stockBalance.upsert({
      where: { productId_warehouseId: { productId: item.productId, warehouseId: body.warehouseId } },
      update: { quantity: { decrement: item.qty } },
      create: { productId: item.productId, warehouseId: body.warehouseId, quantity: -item.qty },
    });
    const newQty = Number(balance.quantity);

    if (newQty < 0) {
      throw new Error(`الكمية غير متوفرة بالمخزون للمنتج رقم ${item.productId}`);
    }

    await tx.stockMovement.create({
      data: {
        productId: item.productId,
        warehouseId: body.warehouseId,
        type: 'OUT',
        quantity: item.qty,
        balanceAfter: newQty,
        refType: 'INVOICE',
        refId: inv.id,
        reason: `فاتورة بيع ${refNo}`,
        createdById: cashierId,
      },
    });
  }

  // Update customer balance if credit
  if (willRaiseBalance) {
    await tx.customer.update({
      where: { id: body.customerId },
      data: { currentBalance: { increment: total } },
    });
  }

  // ── Ledger posting ───────────────────────────────────────────────────────
  // The debit side must mirror the customer-balance decision above: whenever
  // the sale raises a receivable (credit / not fully paid) the ledger debits
  // AR — otherwise GL and the customer subledger drift apart. Money only hits
  // cash/bank when the invoice is fully paid at creation; partial payments
  // arrive later as receipt vouchers (Dr treasury / Cr AR).
  const debitAccountCode =
    willRaiseBalance                ? ACCT.AR :
    body.paymentMethod === 'CARD'   ? ACCT.BANK :
    ACCT.CASH;

  // COGS = Σ product.costPrice × qty
  const cogs = body.items.reduce((sum, item) => {
    const prod = productMap.get(item.productId);
    return sum + (prod ? Number(prod.costPrice) * item.qty : 0);
  }, 0);

  const revenueAmount = subtotal - finalDiscount;
  const taxAmount = Number(body.tax ?? 0);

  const ledgerLines = [
    // Dr: cash/bank/AR = total
    { accountCode: debitAccountCode, debit: total, credit: 0, description: `مبيعات ${refNo}` },
    // Cr: 4000 revenue = subtotal - discount
    { accountCode: ACCT.REVENUE, debit: 0, credit: revenueAmount, description: `إيرادات ${refNo}` },
  ];

  // Cr: 2100 output VAT = tax (only if tax > 0)
  if (taxAmount > 0) {
    ledgerLines.push({ accountCode: ACCT.OUTPUT_VAT, debit: 0, credit: taxAmount, description: `ضريبة مبيعات ${refNo}` });
  }

  // Dr: 5000 COGS; Cr: 1200 inventory (only if cogs > 0)
  if (cogs > 0) {
    ledgerLines.push({ accountCode: ACCT.COGS,      debit: cogs, credit: 0,    description: `تكلفة بضاعة ${refNo}` });
    ledgerLines.push({ accountCode: ACCT.INVENTORY, debit: 0,    credit: cogs, description: `تخفيض مخزون ${refNo}` });
  }

  await postJournalEntry(tx, {
    date: new Date(),
    description: `فاتورة بيع ${refNo}`,
    sourceType: JournalSource.SALES_INVOICE,
    sourceId: inv.id,
    createdById: cashierId,
    lines: ledgerLines,
  });

  return inv;
}
