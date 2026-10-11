-- Multi-tenancy (SaaS) — phase 1: schema.
-- Every row that exists today belongs to tenant 1 (الفنان). New rows take their tenant from the
-- per-request GUC `app.tenant_id` via the column default; a missing GUC fails closed (NOT NULL).

-- CreateTable
CREATE TABLE "Tenant" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Tenant" ("id", "name", "slug") VALUES (1, 'الفنان للتوريدات العمومية', 'alfannan');
SELECT setval(pg_get_serial_sequence('"Tenant"', 'id'), 1);

-- DropIndex
DROP INDEX "Role_code_key";

-- DropIndex
DROP INDEX "Unit_code_key";

-- DropIndex
DROP INDEX "Product_sku_key";

-- DropIndex
DROP INDEX "StockCount_countNo_key";

-- DropIndex
DROP INDEX "WorkOrder_orderNo_key";

-- DropIndex
DROP INDEX "SalesInvoice_refNo_key";

-- DropIndex
DROP INDEX "Coupon_code_key";

-- DropIndex
DROP INDEX "Quotation_refNo_key";

-- DropIndex
DROP INDEX "SalesOrder_orderNo_key";

-- DropIndex
DROP INDEX "PurchaseOrder_orderNo_key";

-- DropIndex
DROP INDEX "SalesReturn_refNo_key";

-- DropIndex
DROP INDEX "PurchaseReturn_refNo_key";

-- DropIndex
DROP INDEX "PurchaseInvoice_refNo_key";

-- DropIndex
DROP INDEX "Account_code_key";

-- DropIndex
DROP INDEX "FiscalPeriod_year_month_key";

-- DropIndex
DROP INDEX "JournalEntry_entryNo_key";

-- DropIndex
DROP INDEX "CostCenter_code_key";

-- DropIndex
DROP INDEX "BankReconciliation_reconNo_key";

-- DropIndex
DROP INDEX "StockTransfer_transferNo_key";

-- DropIndex
DROP INDEX "Voucher_voucherNo_key";

-- DropIndex
DROP INDEX "PromissoryNote_noteNo_key";

-- DropIndex
DROP INDEX "FixedAsset_assetCode_key";

-- DropIndex
DROP INDEX "PayrollRun_runNo_key";

-- AlterTable
ALTER TABLE "Role" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Brand" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "StockBalance" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "StockMovement" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "StockCount" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "StockCountLine" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "BillOfMaterial" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "BOMLine" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "WorkOrderLine" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "LoyaltyTransaction" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "SalesInvoiceItem" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Quotation" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "QuotationItem" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "SalesOrder" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "SalesOrderItem" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PurchaseOrder" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PurchaseOrderItem" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "SalesReturn" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "SalesReturnItem" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PurchaseReturn" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PurchaseReturnItem" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PurchaseInvoice" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PurchaseInvoiceItem" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "FiscalPeriod" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "JournalEntry" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "CostCenter" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Budget" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "RecurringEntry" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "RecurringEntryLine" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "JournalEntryApproval" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "JournalEntryApprovalLine" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "BankReconciliation" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "BankReconciliationLine" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "StockTransfer" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "StockTransferItem" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Setting" DROP CONSTRAINT "Setting_pkey",
ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1,
ADD CONSTRAINT "Setting_pkey" PRIMARY KEY ("tenantId", "key");

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Voucher" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "VoucherLine" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PromissoryNote" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "FixedAsset" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PayrollItem" ADD COLUMN     "tenantId" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Role_tenantId_idx" ON "Role"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_tenantId_code_key" ON "Role"("tenantId", "code");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "Branch_tenantId_idx" ON "Branch"("tenantId");

-- CreateIndex
CREATE INDEX "Department_tenantId_idx" ON "Department"("tenantId");

-- CreateIndex
CREATE INDEX "Brand_tenantId_idx" ON "Brand"("tenantId");

-- CreateIndex
CREATE INDEX "Unit_tenantId_idx" ON "Unit"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_tenantId_code_key" ON "Unit"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Product_tenantId_idx" ON "Product"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Product_tenantId_sku_key" ON "Product"("tenantId", "sku");

-- CreateIndex
CREATE INDEX "Warehouse_tenantId_idx" ON "Warehouse"("tenantId");

-- CreateIndex
CREATE INDEX "StockBalance_tenantId_idx" ON "StockBalance"("tenantId");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_idx" ON "StockMovement"("tenantId");

-- CreateIndex
CREATE INDEX "StockCount_tenantId_idx" ON "StockCount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_tenantId_countNo_key" ON "StockCount"("tenantId", "countNo");

-- CreateIndex
CREATE INDEX "StockCountLine_tenantId_idx" ON "StockCountLine"("tenantId");

-- CreateIndex
CREATE INDEX "BillOfMaterial_tenantId_idx" ON "BillOfMaterial"("tenantId");

-- CreateIndex
CREATE INDEX "BOMLine_tenantId_idx" ON "BOMLine"("tenantId");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantId_idx" ON "WorkOrder"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_tenantId_orderNo_key" ON "WorkOrder"("tenantId", "orderNo");

-- CreateIndex
CREATE INDEX "WorkOrderLine_tenantId_idx" ON "WorkOrderLine"("tenantId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_idx" ON "Customer"("tenantId");

-- CreateIndex
CREATE INDEX "SalesInvoice_tenantId_idx" ON "SalesInvoice"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesInvoice_tenantId_refNo_key" ON "SalesInvoice"("tenantId", "refNo");

-- CreateIndex
CREATE INDEX "Coupon_tenantId_idx" ON "Coupon"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_tenantId_code_key" ON "Coupon"("tenantId", "code");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_tenantId_idx" ON "LoyaltyTransaction"("tenantId");

-- CreateIndex
CREATE INDEX "SalesInvoiceItem_tenantId_idx" ON "SalesInvoiceItem"("tenantId");

-- CreateIndex
CREATE INDEX "Quotation_tenantId_idx" ON "Quotation"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Quotation_tenantId_refNo_key" ON "Quotation"("tenantId", "refNo");

-- CreateIndex
CREATE INDEX "QuotationItem_tenantId_idx" ON "QuotationItem"("tenantId");

-- CreateIndex
CREATE INDEX "SalesOrder_tenantId_idx" ON "SalesOrder"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesOrder_tenantId_orderNo_key" ON "SalesOrder"("tenantId", "orderNo");

-- CreateIndex
CREATE INDEX "SalesOrderItem_tenantId_idx" ON "SalesOrderItem"("tenantId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_idx" ON "PurchaseOrder"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_orderNo_key" ON "PurchaseOrder"("tenantId", "orderNo");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_tenantId_idx" ON "PurchaseOrderItem"("tenantId");

-- CreateIndex
CREATE INDEX "SalesReturn_tenantId_idx" ON "SalesReturn"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesReturn_tenantId_refNo_key" ON "SalesReturn"("tenantId", "refNo");

-- CreateIndex
CREATE INDEX "SalesReturnItem_tenantId_idx" ON "SalesReturnItem"("tenantId");

-- CreateIndex
CREATE INDEX "PurchaseReturn_tenantId_idx" ON "PurchaseReturn"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseReturn_tenantId_refNo_key" ON "PurchaseReturn"("tenantId", "refNo");

-- CreateIndex
CREATE INDEX "PurchaseReturnItem_tenantId_idx" ON "PurchaseReturnItem"("tenantId");

-- CreateIndex
CREATE INDEX "Supplier_tenantId_idx" ON "Supplier"("tenantId");

-- CreateIndex
CREATE INDEX "PurchaseInvoice_tenantId_idx" ON "PurchaseInvoice"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseInvoice_tenantId_refNo_key" ON "PurchaseInvoice"("tenantId", "refNo");

-- CreateIndex
CREATE INDEX "PurchaseInvoiceItem_tenantId_idx" ON "PurchaseInvoiceItem"("tenantId");

-- CreateIndex
CREATE INDEX "Account_tenantId_idx" ON "Account"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_tenantId_code_key" ON "Account"("tenantId", "code");

-- CreateIndex
CREATE INDEX "FiscalPeriod_tenantId_idx" ON "FiscalPeriod"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalPeriod_tenantId_year_month_key" ON "FiscalPeriod"("tenantId", "year", "month");

-- CreateIndex
CREATE INDEX "JournalEntry_tenantId_idx" ON "JournalEntry"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_tenantId_entryNo_key" ON "JournalEntry"("tenantId", "entryNo");

-- CreateIndex
CREATE INDEX "JournalLine_tenantId_idx" ON "JournalLine"("tenantId");

-- CreateIndex
CREATE INDEX "CostCenter_tenantId_idx" ON "CostCenter"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "CostCenter_tenantId_code_key" ON "CostCenter"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Budget_tenantId_idx" ON "Budget"("tenantId");

-- CreateIndex
CREATE INDEX "RecurringEntry_tenantId_idx" ON "RecurringEntry"("tenantId");

-- CreateIndex
CREATE INDEX "RecurringEntryLine_tenantId_idx" ON "RecurringEntryLine"("tenantId");

-- CreateIndex
CREATE INDEX "JournalEntryApproval_tenantId_idx" ON "JournalEntryApproval"("tenantId");

-- CreateIndex
CREATE INDEX "JournalEntryApprovalLine_tenantId_idx" ON "JournalEntryApprovalLine"("tenantId");

-- CreateIndex
CREATE INDEX "BankReconciliation_tenantId_idx" ON "BankReconciliation"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "BankReconciliation_tenantId_reconNo_key" ON "BankReconciliation"("tenantId", "reconNo");

-- CreateIndex
CREATE INDEX "BankReconciliationLine_tenantId_idx" ON "BankReconciliationLine"("tenantId");

-- CreateIndex
CREATE INDEX "Partner_tenantId_idx" ON "Partner"("tenantId");

-- CreateIndex
CREATE INDEX "StockTransfer_tenantId_idx" ON "StockTransfer"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_tenantId_transferNo_key" ON "StockTransfer"("tenantId", "transferNo");

-- CreateIndex
CREATE INDEX "StockTransferItem_tenantId_idx" ON "StockTransferItem"("tenantId");

-- CreateIndex
CREATE INDEX "Setting_tenantId_idx" ON "Setting"("tenantId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "Expense_tenantId_idx" ON "Expense"("tenantId");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_idx" ON "Voucher"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_tenantId_voucherNo_key" ON "Voucher"("tenantId", "voucherNo");

-- CreateIndex
CREATE INDEX "VoucherLine_tenantId_idx" ON "VoucherLine"("tenantId");

-- CreateIndex
CREATE INDEX "PromissoryNote_tenantId_idx" ON "PromissoryNote"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PromissoryNote_tenantId_noteNo_key" ON "PromissoryNote"("tenantId", "noteNo");

-- CreateIndex
CREATE INDEX "FixedAsset_tenantId_idx" ON "FixedAsset"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "FixedAsset_tenantId_assetCode_key" ON "FixedAsset"("tenantId", "assetCode");

-- CreateIndex
CREATE INDEX "Employee_tenantId_idx" ON "Employee"("tenantId");

-- CreateIndex
CREATE INDEX "PayrollRun_tenantId_idx" ON "PayrollRun"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_tenantId_runNo_key" ON "PayrollRun"("tenantId", "runNo");

-- CreateIndex
CREATE INDEX "PayrollItem_tenantId_idx" ON "PayrollItem"("tenantId");

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Branch" ADD CONSTRAINT "Branch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Brand" ADD CONSTRAINT "Brand_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockBalance" ADD CONSTRAINT "StockBalance_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillOfMaterial" ADD CONSTRAINT "BillOfMaterial_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BOMLine" ADD CONSTRAINT "BOMLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderLine" ADD CONSTRAINT "WorkOrderLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesInvoiceItem" ADD CONSTRAINT "SalesInvoiceItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotationItem" ADD CONSTRAINT "QuotationItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrder" ADD CONSTRAINT "SalesOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesOrderItem" ADD CONSTRAINT "SalesOrderItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturn" ADD CONSTRAINT "SalesReturn_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesReturnItem" ADD CONSTRAINT "SalesReturnItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturn" ADD CONSTRAINT "PurchaseReturn_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseReturnItem" ADD CONSTRAINT "PurchaseReturnItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoice" ADD CONSTRAINT "PurchaseInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseInvoiceItem" ADD CONSTRAINT "PurchaseInvoiceItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalPeriod" ADD CONSTRAINT "FiscalPeriod_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostCenter" ADD CONSTRAINT "CostCenter_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringEntry" ADD CONSTRAINT "RecurringEntry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringEntryLine" ADD CONSTRAINT "RecurringEntryLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryApproval" ADD CONSTRAINT "JournalEntryApproval_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryApprovalLine" ADD CONSTRAINT "JournalEntryApprovalLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationLine" ADD CONSTRAINT "BankReconciliationLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferItem" ADD CONSTRAINT "StockTransferItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromissoryNote" ADD CONSTRAINT "PromissoryNote_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FixedAsset" ADD CONSTRAINT "FixedAsset_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Switch the column defaults to the per-request tenant (existing rows were backfilled with 1 above)
ALTER TABLE "Role" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "User" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Branch" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Department" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Brand" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Unit" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Product" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Warehouse" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "StockBalance" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "StockMovement" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "StockCount" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "StockCountLine" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "BillOfMaterial" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "BOMLine" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "WorkOrder" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "WorkOrderLine" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Customer" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "SalesInvoice" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Coupon" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "LoyaltyTransaction" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "SalesInvoiceItem" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Quotation" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "QuotationItem" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "SalesOrder" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "SalesOrderItem" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "PurchaseOrder" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "PurchaseOrderItem" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "SalesReturn" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "SalesReturnItem" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "PurchaseReturn" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "PurchaseReturnItem" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Supplier" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "PurchaseInvoice" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "PurchaseInvoiceItem" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Account" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "FiscalPeriod" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "JournalEntry" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "JournalLine" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "CostCenter" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Budget" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "RecurringEntry" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "RecurringEntryLine" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "JournalEntryApproval" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "JournalEntryApprovalLine" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "BankReconciliation" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "BankReconciliationLine" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Partner" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "StockTransfer" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "StockTransferItem" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Setting" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "AuditLog" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Expense" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Voucher" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "VoucherLine" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "PromissoryNote" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "FixedAsset" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "Employee" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "PayrollRun" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
ALTER TABLE "PayrollItem" ALTER COLUMN "tenantId" SET DEFAULT (current_setting('app.tenant_id'::text))::integer;
