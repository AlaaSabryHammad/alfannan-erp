-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'RECURRING';

-- CreateTable
CREATE TABLE "RecurringEntry" (
    "id" SERIAL NOT NULL,
    "description" TEXT NOT NULL,
    "dayOfMonth" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "lastRunDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringEntryLine" (
    "id" SERIAL NOT NULL,
    "recurringEntryId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "costCenterId" INTEGER,
    "debit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "RecurringEntryLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringEntryLine_recurringEntryId_idx" ON "RecurringEntryLine"("recurringEntryId");

-- CreateIndex
CREATE INDEX "RecurringEntryLine_accountId_idx" ON "RecurringEntryLine"("accountId");

-- AddForeignKey
ALTER TABLE "RecurringEntryLine" ADD CONSTRAINT "RecurringEntryLine_recurringEntryId_fkey" FOREIGN KEY ("recurringEntryId") REFERENCES "RecurringEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringEntryLine" ADD CONSTRAINT "RecurringEntryLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringEntryLine" ADD CONSTRAINT "RecurringEntryLine_costCenterId_fkey" FOREIGN KEY ("costCenterId") REFERENCES "CostCenter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
