-- Tenant reference integrity
--
-- Row-Level Security decides which rows a tenant can *see and write*, but a foreign key is checked
-- by the database engine itself, ignoring RLS: a tenant could INSERT a row of its own that points at
-- another tenant's customer/product/warehouse id. Nothing would leak through RLS, but the data would
-- be inconsistent and ids of other tenants could be probed. These triggers close that gap:
-- every foreign key to a tenant-scoped table must point at a row the current tenant can see.
-- (SQLSTATE TN001 is used on purpose: a plain 23503 would be indistinguishable from an ordinary
-- "cannot delete, still referenced" violation for the API's error mapping.)

-- 1. RolePermission has no tenantId; it belongs to a tenant through its Role (which has RLS).
ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RolePermission" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "RolePermission";
CREATE POLICY tenant_isolation ON "RolePermission"
  USING (EXISTS (SELECT 1 FROM "Role" r WHERE r."id" = "RolePermission"."roleId"))
  WITH CHECK (EXISTS (SELECT 1 FROM "Role" r WHERE r."id" = "RolePermission"."roleId"));
-- the owner connection (platform console, migrations) is not subject to RLS; the app role is.

-- 2. (Re)generates one trigger per table that references tenant-scoped tables.
--    Call it again from any future migration that adds a foreign key.
CREATE OR REPLACE FUNCTION app_regenerate_tenant_ref_triggers() RETURNS integer
LANGUAGE plpgsql AS
$fn$
DECLARE
  t record;
  fk record;
  body text;
  n integer := 0;
BEGIN
  FOR t IN
    SELECT DISTINCT con.conrelid AS relid, cl.relname AS relname
    FROM pg_constraint con
    JOIN pg_class cl  ON cl.oid  = con.conrelid
    JOIN pg_class ref ON ref.oid = con.confrelid
    WHERE con.contype = 'f'
      AND con.connamespace = 'public'::regnamespace
      AND array_length(con.conkey, 1) = 1
      AND EXISTS (
        SELECT 1 FROM information_schema.columns c
        WHERE c.table_schema = 'public' AND c.table_name = ref.relname AND c.column_name = 'tenantId'
      )
  LOOP
    body := '';
    FOR fk IN
      SELECT a.attname AS col, ref.relname AS reftable, ra.attname AS refcol
      FROM pg_constraint con
      JOIN pg_attribute a   ON a.attrelid  = con.conrelid  AND a.attnum  = con.conkey[1]
      JOIN pg_class ref     ON ref.oid     = con.confrelid
      JOIN pg_attribute ra  ON ra.attrelid = con.confrelid AND ra.attnum = con.confkey[1]
      WHERE con.contype = 'f'
        AND con.conrelid = t.relid
        AND array_length(con.conkey, 1) = 1
        AND EXISTS (
          SELECT 1 FROM information_schema.columns c
          WHERE c.table_schema = 'public' AND c.table_name = ref.relname AND c.column_name = 'tenantId'
        )
    LOOP
      body := body || format(
        $b$
        IF NEW.%1$I IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.%1$I IS DISTINCT FROM OLD.%1$I) THEN
          IF NOT EXISTS (SELECT 1 FROM %2$I WHERE %3$I = NEW.%1$I) THEN
            RAISE EXCEPTION 'cross-tenant reference: %4$s.%1$s' USING ERRCODE = 'TN001';
          END IF;
        END IF;
        $b$,
        fk.col, fk.reftable, fk.refcol, t.relname
      );
    END LOOP;

    EXECUTE format(
      'CREATE OR REPLACE FUNCTION %I() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN %s RETURN NEW; END $f$',
      'app_refs_' || t.relname, body
    );
    EXECUTE format('DROP TRIGGER IF EXISTS app_tenant_refs ON %I', t.relname);
    EXECUTE format(
      'CREATE TRIGGER app_tenant_refs BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION %I()',
      t.relname, 'app_refs_' || t.relname
    );
    n := n + 1;
  END LOOP;
  RETURN n;
END
$fn$;

SELECT app_regenerate_tenant_ref_triggers();
