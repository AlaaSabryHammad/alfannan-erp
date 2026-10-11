/**
 * Tenant provisioning — إنشاء شركة جديدة (SaaS self-service)
 *
 * Creates a company with everything it needs to start working: roles with their permissions,
 * the chart of accounts, units, a main branch and warehouse, company settings and the first
 * ADMIN user. All of it happens in one transaction, so a failure leaves no half-built company.
 */
import bcrypt from 'bcrypt';
import prisma, { basePrisma } from './prisma';
import { runWithTenant, runUnscoped } from './tenantContext';
import { PERMISSION_DEFS, ROLE_DEFS, ACCOUNT_CHART, UNIT_DEFS } from './tenantDefaults';

export class EmailTakenError extends Error {
  constructor() {
    super('هذا البريد الإلكتروني مسجّل بالفعل');
  }
}

export interface ProvisionInput {
  companyName: string;
  adminName: string;
  email: string;
  password: string;
}

/** ascii slug for the tenant; Arabic-only names fall back to "company". */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
  return base || 'company';
}

async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 20; i++) {
    const slug = i === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
    if (!(await basePrisma.tenant.findUnique({ where: { slug } }))) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export async function provisionTenant(input: ProvisionInput): Promise<{ tenantId: number; userId: number }> {
  const email = input.email.trim().toLowerCase();

  // E-mail identifies the tenant at login, so it must be unique across all companies.
  const taken = await runUnscoped(() => prisma.user.findUnique({ where: { email }, select: { id: true } }));
  if (taken) throw new EmailTakenError();

  const passwordHash = await bcrypt.hash(input.password, 10);
  const slug = await uniqueSlug(input.companyName);

  return prisma.$transaction(
    async (tx) => {
      const tenant = await tx.tenant.create({ data: { name: input.companyName.trim(), slug } });

      return runWithTenant(tenant.id, async () => {
        // Permissions are global: make sure the catalog exists (a fresh database may not be seeded yet).
        await tx.permission.createMany({ data: PERMISSION_DEFS, skipDuplicates: true });
        const permissions = await tx.permission.findMany({ select: { id: true, code: true } });
        const permissionId = new Map(permissions.map((p) => [p.code, p.id]));

        const roleIdByCode = new Map<string, number>();
        for (const def of ROLE_DEFS) {
          const role = await tx.role.create({
            data: { code: def.code, nameAr: def.nameAr, description: def.description },
          });
          roleIdByCode.set(def.code, role.id);
          await tx.rolePermission.createMany({
            data: def.permCodes
              .filter((c) => permissionId.has(c))
              .map((c) => ({ roleId: role.id, permissionId: permissionId.get(c)! })),
          });
        }

        await tx.account.createMany({
          data: ACCOUNT_CHART.map((a) => ({ ...a, openingBalance: 0, currentBalance: 0 })),
        });
        await tx.unit.createMany({ data: UNIT_DEFS });

        const branch = await tx.branch.create({ data: { nameAr: 'الفرع الرئيسي', isActive: true } });
        await tx.warehouse.create({
          data: { nameAr: 'المستودع الرئيسي', branchId: branch.id, isActive: true },
        });

        await tx.setting.createMany({
          data: [
            { key: 'companyName', value: input.companyName.trim() },
            { key: 'sellerName', value: input.companyName.trim() },
          ],
        });

        const admin = await tx.user.create({
          data: {
            name: input.adminName.trim(),
            email,
            passwordHash,
            roleId: roleIdByCode.get('ADMIN')!,
            branchId: branch.id,
          },
        });

        return { tenantId: tenant.id, userId: admin.id };
      });
    },
    { timeout: 30_000 },
  );
}
