-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "JournalEntryApproval" (
    "id" SERIAL NOT NULL,
    "description" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "createdById" INTEGER NOT NULL,
    "reviewedById" INTEGER,
    "reviewedAt" TIMESTAMP(3),
    "rejectReason" TEXT,
    "journalEntryId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntryApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntryApprovalLine" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "costCenterId" INTEGER,
    "debit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "JournalEntryApprovalLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntryApproval_journalEntryId_key" ON "JournalEntryApproval"("journalEntryId");

-- CreateIndex
CREATE INDEX "JournalEntryApproval_status_idx" ON "JournalEntryApproval"("status");

-- CreateIndex
CREATE INDEX "JournalEntryApprovalLine_requestId_idx" ON "JournalEntryApprovalLine"("requestId");

-- CreateIndex
CREATE INDEX "JournalEntryApprovalLine_accountId_idx" ON "JournalEntryApprovalLine"("accountId");

-- AddForeignKey
ALTER TABLE "JournalEntryApproval" ADD CONSTRAINT "JournalEntryApproval_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryApprovalLine" ADD CONSTRAINT "JournalEntryApprovalLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "JournalEntryApproval"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryApprovalLine" ADD CONSTRAINT "JournalEntryApprovalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntryApprovalLine" ADD CONSTRAINT "JournalEntryApprovalLine_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
