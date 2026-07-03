-- CreateEnum
CREATE TYPE "ReconciliationStatus" AS ENUM ('DRAFT', 'COMPLETED');

-- CreateTable
CREATE TABLE "BankReconciliation" (
    "id" SERIAL NOT NULL,
    "reconNo" TEXT NOT NULL,
    "accountId" INTEGER NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "statementBalance" DECIMAL(12,2) NOT NULL,
    "clearedBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "difference" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "ReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdById" INTEGER,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankReconciliationLine" (
    "id" SERIAL NOT NULL,
    "reconciliationId" INTEGER NOT NULL,
    "journalLineId" INTEGER NOT NULL,

    CONSTRAINT "BankReconciliationLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BankReconciliation_reconNo_key" ON "BankReconciliation"("reconNo");

-- CreateIndex
CREATE INDEX "BankReconciliation_accountId_idx" ON "BankReconciliation"("accountId");

-- CreateIndex
CREATE INDEX "BankReconciliation_status_idx" ON "BankReconciliation"("status");

-- CreateIndex
CREATE UNIQUE INDEX "BankReconciliationLine_journalLineId_key" ON "BankReconciliationLine"("journalLineId");

-- CreateIndex
CREATE INDEX "BankReconciliationLine_reconciliationId_idx" ON "BankReconciliationLine"("reconciliationId");

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliation" ADD CONSTRAINT "BankReconciliation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationLine" ADD CONSTRAINT "BankReconciliationLine_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "BankReconciliation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankReconciliationLine" ADD CONSTRAINT "BankReconciliationLine_journalLineId_fkey" FOREIGN KEY ("journalLineId") REFERENCES "JournalLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

