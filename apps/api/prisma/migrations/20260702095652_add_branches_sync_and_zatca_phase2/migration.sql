-- CreateEnum
CREATE TYPE "ZatcaStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'REPORTED', 'CLEARED', 'FAILED');

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "address" TEXT,
ADD COLUMN     "code" TEXT,
ADD COLUMN     "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN     "invoiceHash" TEXT,
ADD COLUMN     "previousInvoiceHash" TEXT,
ADD COLUMN     "zatcaResponse" TEXT,
ADD COLUMN     "zatcaStatus" "ZatcaStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
ADD COLUMN     "zatcaSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "zatcaUuid" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "branchId" INTEGER;

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "branchId" INTEGER;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
