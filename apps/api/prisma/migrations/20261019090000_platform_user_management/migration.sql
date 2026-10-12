-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "platformNote" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "lastLoginAt" TIMESTAMP(3);
