-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsAcceptedBy" TEXT,
ADD COLUMN     "termsAcceptedIp" TEXT,
ADD COLUMN     "termsVersion" TEXT;

