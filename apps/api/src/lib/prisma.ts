import { PrismaClient, Prisma } from '@prisma/client';
import { isUnscoped, tryTenantId } from './tenantContext';

// Serialize Prisma Decimal values as JSON numbers (not strings) everywhere.
// Money fields (prices, totals, balances) are Decimal in the schema; without this
// JSON.stringify emits them as strings, which breaks numeric formatting and sums on the client.
(Prisma.Decimal.prototype as unknown as { toJSON(): number }).toJSON = function (
  this: Prisma.Decimal,
): number {
  return this.toNumber();
};

// ── Multi-tenancy ─────────────────────────────────────────────────────────────
// Models that carry a tenantId. Every query on them is scoped to the tenant of the current
// context (see tenantContext.ts); a missing context fails closed instead of leaking rows.
const models = Prisma.dmmf.datamodel.models;
const SCOPED = new Set(models.filter((m) => m.fields.some((f) => f.name === 'tenantId')).map((m) => m.name));
const FIELDS = new Map(models.map((m) => [m.name, new Map(m.fields.map((f) => [f.name, f]))]));

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v == null ? [] : [v]);

/** Add the tenant to one create payload, picking the checked or unchecked Prisma input form. */
function stampCreate(model: string, data: Json, tenantId: number): void {
  const fields = FIELDS.get(model)!;
  if (SCOPED.has(model) && data.tenantId === undefined && data.tenant === undefined) {
    const checked = Object.keys(data).some((k) => {
      const f = fields.get(k);
      return f?.kind === 'object' && (f.relationFromFields?.length ?? 0) > 0;
    });
    if (checked) data.tenant = { connect: { id: tenantId } };
    else data.tenantId = tenantId;
  }
  walkNested(model, data, tenantId);
}

/** Recurse into nested writes (items: { create: [...] } …) so child rows get the tenant too. */
function walkNested(model: string, data: Json, tenantId: number): void {
  const fields = FIELDS.get(model)!;
  for (const [key, value] of Object.entries(data)) {
    const f = fields.get(key);
    if (f?.kind !== 'object' || !isObj(value)) continue;
    const target = f.type;
    for (const c of asArray(value.create)) if (isObj(c)) stampCreate(target, c, tenantId);
    if (isObj(value.createMany)) {
      for (const c of asArray(value.createMany.data)) if (isObj(c) && SCOPED.has(target) && c.tenantId === undefined) c.tenantId = tenantId;
    }
    for (const c of asArray(value.connectOrCreate)) if (isObj(c) && isObj(c.create)) stampCreate(target, c.create, tenantId);
    for (const u of asArray(value.upsert)) {
      if (!isObj(u)) continue;
      if (isObj(u.create)) stampCreate(target, u.create, tenantId);
      if (isObj(u.update)) walkNested(target, u.update, tenantId);
    }
    for (const u of asArray(value.update)) {
      if (!isObj(u)) continue;
      walkNested(target, isObj(u.data) ? u.data : u, tenantId);
    }
    for (const u of asArray(value.updateMany)) if (isObj(u) && isObj(u.data)) walkNested(target, u.data, tenantId);
  }
}

const READ_FILTER_OPS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert',
]);

const tenantExtension = Prisma.defineExtension({
  name: 'tenant-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (!SCOPED.has(model) || isUnscoped()) return query(args);

        const tenantId = tryTenantId();
        if (tenantId == null) {
          throw new Error(`رفض الوصول: لا يوجد سياق شركة لعملية ${model}.${operation}`);
        }

        const a = (args ?? {}) as Json;
        if (READ_FILTER_OPS.has(operation)) {
          a.where = { ...(isObj(a.where) ? a.where : {}), tenantId };
        }
        switch (operation) {
          case 'create':
            if (isObj(a.data)) stampCreate(model, a.data, tenantId);
            break;
          case 'createMany':
          case 'createManyAndReturn':
            for (const row of asArray(a.data)) if (isObj(row) && row.tenantId === undefined) row.tenantId = tenantId;
            break;
          case 'update':
          case 'updateMany':
            if (isObj(a.data)) walkNested(model, a.data, tenantId);
            break;
          case 'upsert':
            if (isObj(a.create)) stampCreate(model, a.create, tenantId);
            if (isObj(a.update)) walkNested(model, a.update, tenantId);
            break;
        }
        return query(a);
      },
    },
  },
});

export const basePrisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

const prisma = basePrisma.$extends(tenantExtension);

export type TenantPrismaClient = typeof prisma;
export default prisma;

/** Transaction (or plain) client type accepted by services — replaces Prisma.TransactionClient. */
export type Tx = Omit<
  TenantPrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
