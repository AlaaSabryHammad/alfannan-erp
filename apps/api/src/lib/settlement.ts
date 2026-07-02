/**
 * Invoice settlement math — حالة سداد الفواتير
 *
 * What an invoice still "owes" is its total minus everything applied against
 * it: receipt/discount vouchers AND balance-refund returns (a BALANCE return
 * lowers the receivable exactly like a payment; a CASH return refunds money
 * directly and leaves the receivable untouched).
 *
 * Shared by vouchers, returns, and the invoice detail endpoints so every
 * caller agrees on the same definition of "remaining".
 */
import { Prisma } from '@prisma/client';

export interface InvoiceSettlement {
  total: number;
  paidAmount: number;      // Σ vouchers linked to the invoice
  returnedAmount: number;  // Σ BALANCE returns linked to the invoice
  remaining: number;       // total − paid − returned
}

export async function getSalesInvoiceSettlement(
  tx: Prisma.TransactionClient,
  salesInvoiceId: number,
): Promise<InvoiceSettlement> {
  const [invoice, paidAgg, returnAgg] = await Promise.all([
    tx.salesInvoice.findUniqueOrThrow({ where: { id: salesInvoiceId }, select: { total: true } }),
    tx.voucher.aggregate({ where: { salesInvoiceId }, _sum: { totalAmount: true } }),
    tx.salesReturn.aggregate({ where: { salesInvoiceId, refundMethod: 'BALANCE' }, _sum: { total: true } }),
  ]);
  const total = Number(invoice.total);
  const paidAmount = Number(paidAgg._sum.totalAmount ?? 0);
  const returnedAmount = Number(returnAgg._sum.total ?? 0);
  return { total, paidAmount, returnedAmount, remaining: total - paidAmount - returnedAmount };
}

export async function getPurchaseInvoiceSettlement(
  tx: Prisma.TransactionClient,
  purchaseInvoiceId: number,
): Promise<InvoiceSettlement> {
  const [invoice, paidAgg, returnAgg] = await Promise.all([
    tx.purchaseInvoice.findUniqueOrThrow({ where: { id: purchaseInvoiceId }, select: { total: true } }),
    tx.voucher.aggregate({ where: { purchaseInvoiceId }, _sum: { totalAmount: true } }),
    tx.purchaseReturn.aggregate({ where: { purchaseInvoiceId, refundMethod: 'BALANCE' }, _sum: { total: true } }),
  ]);
  const total = Number(invoice.total);
  const paidAmount = Number(paidAgg._sum.totalAmount ?? 0);
  const returnedAmount = Number(returnAgg._sum.total ?? 0);
  return { total, paidAmount, returnedAmount, remaining: total - paidAmount - returnedAmount };
}

function statusFor(s: InvoiceSettlement): 'PAID' | 'PARTIAL' | 'UNPAID' {
  const effectiveTotal = s.total - s.returnedAmount;
  return s.paidAmount >= effectiveTotal - 0.01 ? 'PAID' : s.paidAmount > 0 ? 'PARTIAL' : 'UNPAID';
}

/** Re-derive a sales invoice's paidStatus after any voucher or return change. */
export async function recomputeSalesInvoiceStatus(
  tx: Prisma.TransactionClient,
  salesInvoiceId: number,
): Promise<void> {
  const settlement = await getSalesInvoiceSettlement(tx, salesInvoiceId);
  await tx.salesInvoice.update({ where: { id: salesInvoiceId }, data: { paidStatus: statusFor(settlement) } });
}

/** Re-derive a purchase invoice's paymentStatus after any voucher or return change. */
export async function recomputePurchaseInvoiceStatus(
  tx: Prisma.TransactionClient,
  purchaseInvoiceId: number,
): Promise<void> {
  const settlement = await getPurchaseInvoiceSettlement(tx, purchaseInvoiceId);
  await tx.purchaseInvoice.update({ where: { id: purchaseInvoiceId }, data: { paymentStatus: statusFor(settlement) } });
}
