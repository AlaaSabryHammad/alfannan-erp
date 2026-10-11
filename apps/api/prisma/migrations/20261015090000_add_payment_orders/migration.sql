-- CreateTable
CREATE TABLE "PaymentOrder" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
    "planId" INTEGER NOT NULL,
    "months" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "providerInvoiceId" TEXT,
    "providerPaymentId" TEXT,
    "checkoutUrl" TEXT,
    "failureReason" TEXT,
    "requestedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_providerInvoiceId_key" ON "PaymentOrder"("providerInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_providerPaymentId_key" ON "PaymentOrder"("providerPaymentId");

-- CreateIndex
CREATE INDEX "PaymentOrder_tenantId_idx" ON "PaymentOrder"("tenantId");

-- CreateIndex
CREATE INDEX "PaymentOrder_status_createdAt_idx" ON "PaymentOrder"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-Level Security: a company can start a checkout (INSERT) and read its own orders, never change them.
ALTER TABLE "PaymentOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PaymentOrder" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PaymentOrder";
CREATE POLICY tenant_isolation ON "PaymentOrder"
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
REVOKE UPDATE, DELETE ON "PaymentOrder" FROM alfannan_app;
