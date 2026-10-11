-- CreateTable
CREATE TABLE "UpgradeRequest" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
    "requestedPlanId" INTEGER NOT NULL,
    "message" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requestedByName" TEXT,
    "requestedByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" TIMESTAMP(3),
    "handledByName" TEXT,

    CONSTRAINT "UpgradeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UpgradeRequest_tenantId_idx" ON "UpgradeRequest"("tenantId");

-- CreateIndex
CREATE INDEX "UpgradeRequest_status_idx" ON "UpgradeRequest"("status");

-- AddForeignKey
ALTER TABLE "UpgradeRequest" ADD CONSTRAINT "UpgradeRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-Level Security: a company can file and read its own upgrade requests, never change them.
ALTER TABLE "UpgradeRequest" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "UpgradeRequest" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "UpgradeRequest";
CREATE POLICY tenant_isolation ON "UpgradeRequest"
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
REVOKE UPDATE, DELETE ON "UpgradeRequest" FROM alfannan_app;
