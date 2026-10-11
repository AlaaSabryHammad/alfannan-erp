-- Row-Level Security — the database enforces tenant isolation (SaaS)
--
-- The application connects as `alfannan_app`, a role that is neither superuser nor BYPASSRLS.
-- Every statement runs with the transaction-local settings
--     app.tenant_id  — the tenant of the request
--     app.unscoped   — 'on' only for explicit cross-tenant lookups (login by e-mail)
-- (set by apps/api/src/lib/prisma.ts). Migrations keep running as the owner/superuser.

-- 1. application role (login + password are applied by the deploy step, see src/ensureAppRole.ts)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alfannan_app') THEN
    CREATE ROLE alfannan_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO alfannan_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO alfannan_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO alfannan_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO alfannan_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO alfannan_app;

-- 2. current tenant as an integer (NULL when unset → no row matches: fails closed)
CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS integer
LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::integer $$;

-- 3. one isolation policy per tenant table (every table with a "tenantId" column)
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.column_name = 'tenantId'
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())',
      t
    );
  END LOOP;
END
$$;

-- 4. login resolves the tenant from the e-mail, so it must read users across tenants — nothing else may.
DROP POLICY IF EXISTS user_unscoped_lookup ON "User";
CREATE POLICY user_unscoped_lookup ON "User" FOR SELECT
  USING (current_setting('app.unscoped', true) = 'on');
