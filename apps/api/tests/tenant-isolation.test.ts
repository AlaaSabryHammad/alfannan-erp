/**
 * Multi-tenancy isolation (SaaS): a second company must never see, change or collide with
 * the seeded one (tenant 1), neither through the API nor through the Prisma layer.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { app, prisma } from './helpers';
import { basePrisma } from '../src/lib/prisma';
import { platformPrisma } from '../src/lib/platformPrisma';
import { runWithTenant, runUnscoped } from '../src/lib/tenantContext';

const stamp = Date.now();
const emailB = `admin-b-${stamp}@tenant-b.test`;
const passwordB = 'tenant-b-secret';

let tenantB: number;
let tokenB: string;
let tokenA: string;
let productOfA: { id: number; sku: string };
let productOfB: { id: number; sku: string };

async function login(email: string, password: string) {
  return request(app).post('/api/auth/login').send({ email, password });
}

beforeAll(async () => {
  const tenant = await basePrisma.tenant.create({ data: { name: 'شركة ب', slug: `tenant-b-${stamp}` } });
  tenantB = tenant.id;

  // a company without a subscription is read-only (fail closed) — give B a normal trial
  const trial = await platformPrisma.plan.findUniqueOrThrow({ where: { code: 'trial' } });
  await platformPrisma.subscription.create({
    data: { tenantId: tenantB, planId: trial.id, status: 'TRIALING', trialEndsAt: new Date(Date.now() + 14 * 24 * 3600 * 1000) },
  });

  await runWithTenant(tenantB, async () => {
    const role = await prisma.role.create({ data: { code: 'ADMIN', nameAr: 'مدير النظام' } }); // same code as tenant 1
    await prisma.user.create({
      data: {
        name: 'مدير ب',
        email: emailB,
        passwordHash: await bcrypt.hash(passwordB, 4),
        roleId: role.id,
      },
    });
  });

  const a = await login('admin@store.com', '123456');
  tokenA = a.body.token;
  const b = await login(emailB, passwordB);
  expect(b.status).toBe(200);
  tokenB = b.body.token;

  productOfA = await runWithTenant(1, () => prisma.product.findFirstOrThrow({ select: { id: true, sku: true } }));

  // same SKU as tenant A's product → per-tenant uniqueness must allow it
  productOfB = await runWithTenant(tenantB, () =>
    prisma.product.create({
      data: { nameAr: 'صنف الشركة ب', sku: productOfA.sku, costPrice: 5, salePrice: 9 },
      select: { id: true, sku: true },
    }),
  );
});

describe('tenant isolation', () => {
  it('puts the tenant into the JWT and the user payload', async () => {
    const decoded = jwt.decode(tokenB) as { tenantId: number };
    expect(decoded.tenantId).toBe(tenantB);
    expect((jwt.decode(tokenA) as { tenantId: number }).tenantId).toBe(1);
  });

  it('allows the same SKU / role code in two tenants', async () => {
    expect(productOfB.sku).toBe(productOfA.sku);
    expect(productOfB.id).not.toBe(productOfA.id);
  });

  it("B's product list contains only B's rows", async () => {
    const res = await request(app).get('/api/products').set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(200);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.data[0].id).toBe(productOfB.id);
  });

  it("A's product list does not include B's product", async () => {
    const res = await request(app).get('/api/products?pageSize=100').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    const ids = (res.body.data as Array<{ id: number }>).map((p) => p.id);
    expect(ids).toContain(productOfA.id);
    expect(ids).not.toContain(productOfB.id);
  });

  it("B cannot read, edit or delete A's product by id", async () => {
    const get = await request(app).get(`/api/products/${productOfA.id}`).set('Authorization', `Bearer ${tokenB}`);
    expect(get.status).toBe(404);

    const put = await request(app)
      .put(`/api/products/${productOfA.id}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ nameAr: 'اختراق' });
    expect([403, 404]).toContain(put.status);

    const del = await request(app).delete(`/api/products/${productOfA.id}`).set('Authorization', `Bearer ${tokenB}`);
    expect([403, 404]).toContain(del.status);

    const still = await runWithTenant(1, () => prisma.product.findUnique({ where: { id: productOfA.id } }));
    expect(still).not.toBeNull();
    expect(still!.nameAr).not.toBe('اختراق');
  });

  it('B sees none of the seeded accounts, customers or journal entries', async () => {
    const [accounts, customers, entries] = await Promise.all([
      request(app).get('/api/accounts').set('Authorization', `Bearer ${tokenB}`),
      request(app).get('/api/customers').set('Authorization', `Bearer ${tokenB}`),
      request(app).get('/api/journal').set('Authorization', `Bearer ${tokenB}`),
    ]);
    for (const r of [accounts, customers, entries]) expect(r.status).toBe(200);
    const len = (b: unknown) => (Array.isArray(b) ? b.length : (b as { data: unknown[] }).data.length);
    expect(len(accounts.body)).toBe(0);
    expect(len(customers.body)).toBe(0);
    expect(len(entries.body)).toBe(0);
  });

  it('stamps the tenant on nested creates (parent and children)', async () => {
    const wh = await runWithTenant(tenantB, () => prisma.warehouse.create({ data: { nameAr: 'مستودع ب' } }));
    const product = await runWithTenant(tenantB, () =>
      prisma.product.create({
        data: {
          nameAr: 'صنف بمخزون',
          sku: `B-NESTED-${stamp}`,
          costPrice: 1,
          salePrice: 2,
          stockBalances: { create: [{ warehouseId: wh.id, quantity: 7 }] },
        },
        include: { stockBalances: true },
      }),
    );
    expect(product.tenantId).toBe(tenantB);
    expect(product.stockBalances[0].tenantId).toBe(tenantB);
  });

  it('keeps counters per tenant (settings are not shared)', async () => {
    await runWithTenant(tenantB, () =>
      prisma.setting.create({ data: { key: 'companyName', value: 'شركة ب' } }),
    );
    const b = await request(app).get('/api/settings').set('Authorization', `Bearer ${tokenB}`);
    const a = await request(app).get('/api/settings').set('Authorization', `Bearer ${tokenA}`);
    expect(b.body.companyName).toBe('شركة ب');
    expect(a.body.companyName).not.toBe('شركة ب');
  });

  it('rejects tokens that carry no tenant', async () => {
    const legacy = jwt.sign(
      { userId: 1, email: 'admin@store.com', roleCode: 'ADMIN', permissions: [] },
      process.env.JWT_SECRET!,
    );
    const res = await request(app).get('/api/products').set('Authorization', `Bearer ${legacy}`);
    expect(res.status).toBe(401);
  });

  it('blocks login for users of a deactivated tenant', async () => {
    await basePrisma.tenant.update({ where: { id: tenantB }, data: { isActive: false } });
    const res = await login(emailB, passwordB);
    expect(res.status).toBe(401);
    await basePrisma.tenant.update({ where: { id: tenantB }, data: { isActive: true } });
  });

  it('scoped queries outside any tenant context fail closed', async () => {
    const saved = process.env.TENANT_FALLBACK_ID;
    delete process.env.TENANT_FALLBACK_ID;
    try {
      await expect(prisma.product.findMany()).rejects.toThrow(/سياق شركة/);
      // explicit unscoped access is allowed only where the database policy permits it (login lookup)
      await expect(runUnscoped(() => prisma.user.count())).resolves.toBeGreaterThan(1);
    } finally {
      process.env.TENANT_FALLBACK_ID = saved;
    }
  });

  it('Row-Level Security: the database itself hides other tenants, even for hand-written queries', async () => {
    // Raw SQL without any tenant filter — only the RLS policy can scope it.
    const asB = await runWithTenant(tenantB, () =>
      prisma.$transaction((tx) => tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM "Product"`),
    );
    expect(Number(asB[0].n)).toBeLessThanOrEqual(2); // only tenant B's own products

    const asA = await runWithTenant(1, () =>
      prisma.$transaction((tx) => tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM "Product"`),
    );
    expect(Number(asA[0].n)).toBeGreaterThan(Number(asB[0].n));

    // Without any tenant setting the same query sees nothing (fails closed).
    const none = await runUnscoped(() =>
      prisma.$transaction((tx) => tx.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM "Product"`),
    );
    expect(Number(none[0].n)).toBe(0);
  });

  it('Row-Level Security: a tenant cannot write a row for another tenant', async () => {
    await expect(
      runWithTenant(tenantB, () =>
        prisma.$transaction((tx) =>
          tx.$executeRaw`INSERT INTO "Brand" ("nameAr", "tenantId") VALUES ('تسلل', 1)`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('every tenant table has RLS enabled and forced with an isolation policy', async () => {
    const rows = await basePrisma.$queryRaw<Array<{ table_name: string; rls: boolean; forced: boolean; policies: bigint }>>`
      SELECT c.table_name,
             cl.relrowsecurity AS rls,
             cl.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policies p WHERE p.tablename = c.table_name AND p.policyname = 'tenant_isolation') AS policies
      FROM information_schema.columns c
      JOIN pg_class cl ON cl.relname = c.table_name AND cl.relkind = 'r'
      WHERE c.table_schema = 'public' AND c.column_name = 'tenantId'`;
    expect(rows.length).toBeGreaterThan(50);
    const broken = rows.filter((r) => !r.rls || !r.forced || Number(r.policies) !== 1).map((r) => r.table_name);
    expect(broken).toEqual([]);
  });
});
