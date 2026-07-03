-- AlterTable
ALTER TABLE "PurchaseInvoice" ADD COLUMN     "branchId" INTEGER;

-- AlterTable
ALTER TABLE "PurchaseReturn" ADD COLUMN     "branchId" INTEGER;

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN     "branchId" INTEGER;

-- AlterTable
ALTER TABLE "SalesReturn" ADD COLUMN     "branchId" INTEGER;

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "branchId" INTEGER;

-- CreateIndex
CREATE INDEX "PurchaseInvoice_branchId_idx" ON "PurchaseInvoice"("branchId");

-- CreateIndex
CREATE INDEX "PurchaseReturn_branchId_idx" ON "PurchaseReturn"("branchId");

-- CreateIndex
CREATE INDEX "SalesInvoice_branchId_idx" ON "SalesInvoice"("branchId");

-- CreateIndex
CREATE INDEX "SalesReturn_branchId_idx" ON "SalesReturn"("branchId");

-- CreateIndex
CREATE INDEX "Voucher_branchId_idx" ON "Voucher"("branchId");

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Backfill: derive each document's branch from its warehouse (invoices and
-- returns) or from its creator's branch (vouchers).
UPDATE "SalesInvoice" si SET "branchId" = w."branchId"
FROM "Warehouse" w WHERE si."warehouseId" = w.id AND w."branchId" IS NOT NULL;

UPDATE "PurchaseInvoice" pi SET "branchId" = w."branchId"
FROM "Warehouse" w WHERE pi."warehouseId" = w.id AND w."branchId" IS NOT NULL;

UPDATE "SalesReturn" sr SET "branchId" = w."branchId"
FROM "Warehouse" w WHERE sr."warehouseId" = w.id AND w."branchId" IS NOT NULL;

UPDATE "PurchaseReturn" pr SET "branchId" = w."branchId"
FROM "Warehouse" w WHERE pr."warehouseId" = w.id AND w."branchId" IS NOT NULL;

UPDATE "Voucher" v SET "branchId" = u."branchId"
FROM "User" u WHERE v."createdById" = u.id AND u."branchId" IS NOT NULL;
