-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('RECEIPT', 'PAYMENT', 'DISCOUNT', 'DEPOSIT');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'ACCOUNT');

-- CreateEnum
CREATE TYPE "NoteType" AS ENUM ('RECEIVABLE', 'PAYABLE');

-- CreateEnum
CREATE TYPE "NoteStatus" AS ENUM ('PENDING', 'SETTLED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'VOUCHER';

-- CreateTable
CREATE TABLE "Voucher" (
    "id" SERIAL NOT NULL,
    "voucherNo" TEXT NOT NULL,
    "type" "VoucherType" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "treasuryAccountId" INTEGER NOT NULL,
    "partyType" "PartyType",
    "partyId" INTEGER,
    "description" TEXT,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "journalEntryId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoucherLine" (
    "id" SERIAL NOT NULL,
    "voucherId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "description" TEXT,

    CONSTRAINT "VoucherLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromissoryNote" (
    "id" SERIAL NOT NULL,
    "noteNo" TEXT NOT NULL,
    "type" "NoteType" NOT NULL,
    "partyType" "PartyType" NOT NULL,
    "partyId" INTEGER,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "NoteStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT,
    "settledVoucherId" INTEGER,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromissoryNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_voucherNo_key" ON "Voucher"("voucherNo");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_journalEntryId_key" ON "Voucher"("journalEntryId");

-- CreateIndex
CREATE INDEX "Voucher_type_idx" ON "Voucher"("type");

-- CreateIndex
CREATE INDEX "Voucher_date_idx" ON "Voucher"("date");

-- CreateIndex
CREATE INDEX "Voucher_treasuryAccountId_idx" ON "Voucher"("treasuryAccountId");

-- CreateIndex
CREATE INDEX "Voucher_partyType_partyId_idx" ON "Voucher"("partyType", "partyId");

-- CreateIndex
CREATE INDEX "VoucherLine_voucherId_idx" ON "VoucherLine"("voucherId");

-- CreateIndex
CREATE INDEX "VoucherLine_accountId_idx" ON "VoucherLine"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "PromissoryNote_noteNo_key" ON "PromissoryNote"("noteNo");

-- CreateIndex
CREATE INDEX "PromissoryNote_status_idx" ON "PromissoryNote"("status");

-- CreateIndex
CREATE INDEX "PromissoryNote_dueDate_idx" ON "PromissoryNote"("dueDate");

-- CreateIndex
CREATE INDEX "PromissoryNote_partyType_partyId_idx" ON "PromissoryNote"("partyType", "partyId");

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_treasuryAccountId_fkey" FOREIGN KEY ("treasuryAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voucher" ADD CONSTRAINT "Voucher_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "Voucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoucherLine" ADD CONSTRAINT "VoucherLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromissoryNote" ADD CONSTRAINT "PromissoryNote_settledVoucherId_fkey" FOREIGN KEY ("settledVoucherId") REFERENCES "Voucher"("id") ON DELETE SET NULL ON UPDATE CASCADE;
