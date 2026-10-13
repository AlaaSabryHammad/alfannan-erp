-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN "settledAtSale" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "SalesInvoiceItem" ADD COLUMN "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseInvoice" ADD COLUMN "settledAtPurchase" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- Backfill: sales whose debit went straight to cash / bank were collected at the sale
UPDATE "SalesInvoice" si SET "settledAtSale" = si."total"
WHERE EXISTS (
  SELECT 1 FROM "JournalEntry" je
  JOIN "JournalLine" jl ON jl."entryId" = je."id"
  JOIN "Account" a ON a."id" = jl."accountId"
  WHERE je."sourceType" = 'SALES_INVOICE' AND je."sourceId" = si."id"
    AND jl."debit" > 0 AND a."code" IN ('1000', '1100')
);

-- Backfill: purchases whose credit went straight to cash / bank were paid at creation
UPDATE "PurchaseInvoice" pi SET "settledAtPurchase" = pi."total"
WHERE EXISTS (
  SELECT 1 FROM "JournalEntry" je
  JOIN "JournalLine" jl ON jl."entryId" = je."id"
  JOIN "Account" a ON a."id" = jl."accountId"
  WHERE je."sourceType" = 'PURCHASE_INVOICE' AND je."sourceId" = pi."id"
    AND jl."credit" > 0 AND a."code" IN ('1000', '1100')
);
UPDATE "PurchaseInvoice" SET "settledAtPurchase" = "total"
WHERE "receiveStatus" = 'PENDING' AND "paymentStatus" = 'PAID';

-- Invoices that a later return had flipped from PAID back to UNPAID
UPDATE "SalesInvoice" SET "paidStatus" = 'PAID' WHERE "settledAtSale" > 0 AND "paidStatus" <> 'PAID';
UPDATE "PurchaseInvoice" SET "paymentStatus" = 'PAID' WHERE "settledAtPurchase" > 0 AND "paymentStatus" <> 'PAID';

-- Backfill the VAT carried by each existing line: the invoice tax, weighted by line value × the product's rate
WITH w AS (
  SELECT sii."id", sii."invoiceId", sii."lineTotal" AS lt, sii."lineTotal" * GREATEST(p."taxRate", 0) AS wt
  FROM "SalesInvoiceItem" sii JOIN "Product" p ON p."id" = sii."productId"
), s AS (
  SELECT "invoiceId", SUM(wt) AS swt, SUM(lt) AS slt FROM w GROUP BY "invoiceId"
)
UPDATE "SalesInvoiceItem" sii
SET "taxAmount" = ROUND(si."tax" * CASE
      WHEN s.swt > 0 THEN w.wt / s.swt
      WHEN s.slt > 0 THEN w.lt / s.slt
      ELSE 0 END, 2)
FROM w, s, "SalesInvoice" si
WHERE w."id" = sii."id" AND s."invoiceId" = sii."invoiceId" AND si."id" = sii."invoiceId" AND si."tax" > 0;
