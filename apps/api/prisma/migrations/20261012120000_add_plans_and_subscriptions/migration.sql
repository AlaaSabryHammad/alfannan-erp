-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELED');

-- CreateTable
CREATE TABLE "Plan" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "nameAr" TEXT NOT NULL,
    "priceMonthly" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "priceYearly" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'SAR',
    "trialDays" INTEGER NOT NULL DEFAULT 0,
    "limits" JSONB NOT NULL,
    "features" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL DEFAULT (current_setting('app.tenant_id'::text))::integer,
    "planId" INTEGER NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "limitOverrides" JSONB,
    "featureOverrides" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Plan_code_key" ON "Plan"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_tenantId_key" ON "Subscription"("tenantId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Row-Level Security + privileges ──────────────────────────────────────────────────────────
-- Subscription: a company can read its own row (and the registration flow can create the first one),
-- but never change its plan, period or limits — only the owner console (owner connection) does.
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Subscription";
CREATE POLICY tenant_isolation ON "Subscription"
  USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant());
REVOKE UPDATE, DELETE ON "Subscription" FROM alfannan_app;

-- Plan: global catalogue, read-only for the application.
REVOKE INSERT, UPDATE, DELETE ON "Plan" FROM alfannan_app;

-- ── Default plans (prices in SAR are placeholders — editable from the owner console) ─────────
INSERT INTO "Plan" ("code", "nameAr", "priceMonthly", "priceYearly", "trialDays", "limits", "features", "sortOrder") VALUES
 ('trial', 'تجربة مجانية', 0, 0, 14,
  '{"users":10,"branches":3,"warehouses":3,"products":500,"salesInvoicesPerMonth":300}',
  '{"zatca":true,"manufacturing":true,"advancedReports":true}', 0),
 ('basic', 'أساسي', 149, 1490, 0,
  '{"users":3,"branches":1,"warehouses":1,"products":200,"salesInvoicesPerMonth":100}',
  '{"zatca":false,"manufacturing":false,"advancedReports":false}', 1),
 ('pro', 'احترافي', 399, 3990, 0,
  '{"users":10,"branches":3,"warehouses":5,"products":5000,"salesInvoicesPerMonth":1000}',
  '{"zatca":true,"manufacturing":true,"advancedReports":true}', 2),
 ('enterprise', 'مؤسسات', 0, 0, 0,
  '{"users":null,"branches":null,"warehouses":null,"products":null,"salesInvoicesPerMonth":null}',
  '{"zatca":true,"manufacturing":true,"advancedReports":true}', 3);

-- Companies that exist today keep working exactly as before: active, unlimited.
INSERT INTO "Subscription" ("tenantId", "planId", "status", "currentPeriodStart", "notes", "updatedAt")
SELECT t."id", (SELECT p."id" FROM "Plan" p WHERE p."code" = 'enterprise'), 'ACTIVE', now(),
       'Migrated from the pre-subscription system', now()
FROM "Tenant" t;
