-- CreateEnum
CREATE TYPE "NoteInstrumentType" AS ENUM ('PROMISSORY_NOTE', 'CHEQUE');

-- AlterEnum
ALTER TYPE "NoteStatus" ADD VALUE 'BOUNCED';

-- AlterTable
ALTER TABLE "PromissoryNote" ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "instrumentType" "NoteInstrumentType" NOT NULL DEFAULT 'PROMISSORY_NOTE';
