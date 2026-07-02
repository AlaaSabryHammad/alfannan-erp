-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "purchaseInvoiceId" INTEGER,
ADD COLUMN     "salesInvoiceId" INTEGER;

-- CreateIndex
CREATE INDEX "Voucher_salesInvoiceId_idx" ON "Voucher"("salesInvoiceId");

-- CreateIndex
CREATE INDEX "Voucher_purchaseInvoiceId_idx" ON "Voucher"("purchaseInvoiceId");

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_salesInvoiceId_fkey" FOREIGN KEY ("salesInvoiceId") REFERENCES "SalesInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_purchaseInvoiceId_fkey" FOREIGN KEY ("purchaseInvoiceId") REFERENCES "PurchaseInvoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
