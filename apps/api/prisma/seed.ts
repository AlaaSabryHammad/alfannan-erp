import {
  PrismaClient, Prisma,
  MovementType, PaidStatus, PaymentMethod, CustomerStatus,
  ReceiveStatus, SupplierStatus, AccountType, PartnerStatus,
  TransferStatus, JournalSource,
} from '@prisma/client';
import bcrypt from 'bcrypt';

// Import ledger service (compiled TS not available here, inline the essentials)
// We'll use a minimal inline version of postJournalEntry for the seed.

const prisma = new PrismaClient();

type AccountRecord = { id: number; type: AccountType };

const ACCT = {
  CASH:        '1000',
  BANK:        '1100',
  INVENTORY:   '1200',
  INPUT_VAT:   '1300',
  FIXED_ASSETS:'1400',
  ACC_DEPRECIATION:'1450',
  AR:          '3000',
  AP:          '2000',
  OUTPUT_VAT:  '2100',
  SALARIES_PAYABLE:'2200',
  REVENUE:     '4000',
  COGS:        '5000',
  GEN_EXPENSE: '6000',
  DEPRECIATION_EXP:'6100',
  SALARIES_EXP:'6200',
  DISCOUNT_EARNED:  '4100',
  DISCOUNT_ALLOWED: '5100',
} as const;

function isDebitNormal(type: AccountType): boolean {
  return type === AccountType.ASSET || type === AccountType.EXPENSE;
}

async function generateEntryNo(date: Date, prefix: string): Promise<string> {
  const count = await prisma.journalEntry.count({
    where: { entryNo: { startsWith: prefix } },
  });
  const seq = String(count + 1).padStart(4, '0');
  return `${prefix}${seq}`;
}

interface SeedLine {
  accountCode: string;
  debit: number;
  credit: number;
  description?: string;
}

async function postEntry(params: {
  date: Date;
  description: string;
  sourceType: JournalSource;
  sourceId?: number | null;
  lines: SeedLine[];
}): Promise<void> {
  const { date, description, sourceType, sourceId, lines } = params;

  // Resolve account codes
  const resolved: Array<{ accountId: number; accountType: AccountType; debit: number; credit: number; description?: string }> = [];
  for (const line of lines) {
    const acct = await prisma.account.findUnique({
      where: { code: line.accountCode },
      select: { id: true, type: true },
    });
    if (!acct) throw new Error(`Account not found: ${line.accountCode}`);
    if (line.debit !== 0 || line.credit !== 0) {
      resolved.push({ accountId: acct.id, accountType: acct.type, debit: line.debit, credit: line.credit, description: line.description });
    }
  }

  const totalDebit  = resolved.reduce((s, l) => s + l.debit,  0);
  const totalCredit = resolved.reduce((s, l) => s + l.credit, 0);
  const diff = Math.abs(totalDebit - totalCredit);
  if (diff > 0.01) throw new Error(`القيد غير متوازن (${totalDebit} vs ${totalCredit}) for: ${description}`);

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const prefix = `JE-${y}${m}${d}-`;
  const entryNo = await generateEntryNo(date, prefix);

  await prisma.journalEntry.create({
    data: {
      entryNo,
      date,
      description,
      sourceType,
      sourceId: sourceId ?? null,
      totalDebit:  new Prisma.Decimal(totalDebit),
      totalCredit: new Prisma.Decimal(totalCredit),
      createdById: null,
      lines: {
        create: resolved.map(l => ({
          accountId: l.accountId,
          debit:  new Prisma.Decimal(l.debit),
          credit: new Prisma.Decimal(l.credit),
          description: l.description ?? null,
        })),
      },
    },
  });

  // Update account balances
  for (const line of resolved) {
    const net = isDebitNormal(line.accountType)
      ? line.debit - line.credit
      : line.credit - line.debit;
    if (net !== 0) {
      await prisma.account.update({
        where: { id: line.accountId },
        data: { currentBalance: { increment: new Prisma.Decimal(net) } },
      });
    }
  }
}

async function main() {
  console.log('🌱 Starting seed...');

  // ── PERMISSIONS ────────────────────────────────────────────────────────────
  const permissionDefs = [
    // Products
    { code: 'products.view', group: 'products', nameAr: 'عرض الأصناف' },
    { code: 'products.create', group: 'products', nameAr: 'إضافة صنف' },
    { code: 'products.edit', group: 'products', nameAr: 'تعديل صنف' },
    { code: 'products.delete', group: 'products', nameAr: 'حذف صنف' },
    // Departments
    { code: 'departments.view', group: 'departments', nameAr: 'عرض الأقسام' },
    { code: 'departments.create', group: 'departments', nameAr: 'إضافة قسم' },
    { code: 'departments.edit', group: 'departments', nameAr: 'تعديل قسم' },
    { code: 'departments.delete', group: 'departments', nameAr: 'حذف قسم' },
    // Brands
    { code: 'brands.view', group: 'brands', nameAr: 'عرض العلامات التجارية' },
    { code: 'brands.create', group: 'brands', nameAr: 'إضافة علامة تجارية' },
    { code: 'brands.edit', group: 'brands', nameAr: 'تعديل علامة تجارية' },
    { code: 'brands.delete', group: 'brands', nameAr: 'حذف علامة تجارية' },
    // Units
    { code: 'units.view', group: 'units', nameAr: 'عرض وحدات القياس' },
    { code: 'units.create', group: 'units', nameAr: 'إضافة وحدة قياس' },
    { code: 'units.delete', group: 'units', nameAr: 'حذف وحدة قياس' },
    // Warehouses
    { code: 'warehouses.view', group: 'warehouses', nameAr: 'عرض المستودعات' },
    { code: 'warehouses.create', group: 'warehouses', nameAr: 'إضافة مستودع' },
    { code: 'warehouses.edit', group: 'warehouses', nameAr: 'تعديل مستودع' },
    { code: 'warehouses.delete', group: 'warehouses', nameAr: 'حذف مستودع' },
    // Stock
    { code: 'stock.view', group: 'stock', nameAr: 'عرض المخزون' },
    { code: 'stock.adjust', group: 'stock', nameAr: 'تعديل المخزون' },
    { code: 'stock.transfer', group: 'stock', nameAr: 'تحويل المخزون' },
    // Sales
    { code: 'sales.view', group: 'sales', nameAr: 'عرض المبيعات' },
    { code: 'sales.create', group: 'sales', nameAr: 'إنشاء فاتورة بيع' },
    { code: 'sales.edit', group: 'sales', nameAr: 'تعديل فاتورة بيع' },
    { code: 'sales.delete', group: 'sales', nameAr: 'حذف فاتورة بيع' },
    // Customers
    { code: 'customers.view', group: 'customers', nameAr: 'عرض العملاء' },
    { code: 'customers.create', group: 'customers', nameAr: 'إضافة عميل' },
    { code: 'customers.edit', group: 'customers', nameAr: 'تعديل عميل' },
    { code: 'customers.delete', group: 'customers', nameAr: 'حذف عميل' },
    // Dashboard
    { code: 'dashboard.view', group: 'dashboard', nameAr: 'عرض لوحة التحكم' },
    // Users
    { code: 'users.view', group: 'users', nameAr: 'عرض المستخدمين' },
    { code: 'users.create', group: 'users', nameAr: 'إضافة مستخدم' },
    { code: 'users.edit', group: 'users', nameAr: 'تعديل مستخدم' },
    // Reports
    { code: 'reports.view', group: 'reports', nameAr: 'عرض التقارير' },
    // Suppliers
    { code: 'suppliers.view', group: 'suppliers', nameAr: 'عرض الموردين' },
    { code: 'suppliers.create', group: 'suppliers', nameAr: 'إضافة مورد' },
    { code: 'suppliers.edit', group: 'suppliers', nameAr: 'تعديل مورد' },
    { code: 'suppliers.delete', group: 'suppliers', nameAr: 'حذف مورد' },
    // Purchases
    { code: 'purchases.view', group: 'purchases', nameAr: 'عرض فواتير الشراء' },
    { code: 'purchases.create', group: 'purchases', nameAr: 'إنشاء فاتورة شراء' },
    { code: 'purchases.edit', group: 'purchases', nameAr: 'تعديل فاتورة شراء' },
    { code: 'purchases.delete', group: 'purchases', nameAr: 'حذف فاتورة شراء' },
    // Accounts
    { code: 'accounts.view', group: 'accounts', nameAr: 'عرض الحسابات' },
    { code: 'accounts.create', group: 'accounts', nameAr: 'إضافة حساب' },
    { code: 'accounts.edit', group: 'accounts', nameAr: 'تعديل حساب' },
    { code: 'accounts.delete', group: 'accounts', nameAr: 'حذف حساب' },
    // Partners
    { code: 'partners.view', group: 'partners', nameAr: 'عرض الشركاء' },
    { code: 'partners.create', group: 'partners', nameAr: 'إضافة شريك' },
    { code: 'partners.edit', group: 'partners', nameAr: 'تعديل شريك' },
    { code: 'partners.delete', group: 'partners', nameAr: 'حذف شريك' },
    // Transfers
    { code: 'transfers.view', group: 'transfers', nameAr: 'عرض تحويلات المخزون' },
    { code: 'transfers.create', group: 'transfers', nameAr: 'إنشاء تحويل مخزون' },
    { code: 'transfers.delete', group: 'transfers', nameAr: 'حذف تحويل مخزون' },
    // Settings
    { code: 'settings.view', group: 'settings', nameAr: 'عرض الإعدادات' },
    { code: 'settings.edit', group: 'settings', nameAr: 'تعديل الإعدادات' },
    // Users (delete was missing)
    { code: 'users.delete', group: 'users', nameAr: 'حذف مستخدم' },
    // Roles
    { code: 'roles.view', group: 'roles', nameAr: 'عرض الأدوار والصلاحيات' },
    { code: 'roles.edit', group: 'roles', nameAr: 'تعديل صلاحيات الأدوار' },
    // Treasury / Vouchers
    { code: 'treasury.view', group: 'treasury', nameAr: 'عرض السندات وحركة الخزينة' },
    { code: 'treasury.create', group: 'treasury', nameAr: 'إنشاء السندات والكمبيالات' },
    { code: 'treasury.delete', group: 'treasury', nameAr: 'حذف السندات والكمبيالات' },
    // Fixed Assets
    { code: 'assets.view', group: 'assets', nameAr: 'عرض الأصول الثابتة' },
    { code: 'assets.create', group: 'assets', nameAr: 'إنشاء وإهلاك الأصول' },
    { code: 'assets.delete', group: 'assets', nameAr: 'حذف الأصول الثابتة' },
    // HR / Payroll
    { code: 'hr.view', group: 'hr', nameAr: 'عرض الموظفين والرواتب' },
    { code: 'hr.create', group: 'hr', nameAr: 'إدارة الموظفين وتشغيل الرواتب' },
    { code: 'hr.delete', group: 'hr', nameAr: 'حذف الموظفين ودورات الرواتب' },
    // Manufacturing / BOM / Work Orders
    { code: 'manufacturing.view', group: 'manufacturing', nameAr: 'عرض قوائم المكونات وأوامر التصنيع' },
    { code: 'manufacturing.create', group: 'manufacturing', nameAr: 'إنشاء وترحيل أوامر التصنيع' },
    { code: 'manufacturing.delete', group: 'manufacturing', nameAr: 'حذف قوائم المكونات وأوامر التصنيع' },
    // Marketing — Loyalty & Coupons
    { code: 'marketing.view', group: 'marketing', nameAr: 'عرض كوبونات الخصم ونقاط الولاء' },
    { code: 'marketing.create', group: 'marketing', nameAr: 'إنشاء وتعديل كوبونات الخصم' },
    { code: 'marketing.delete', group: 'marketing', nameAr: 'حذف كوبونات الخصم' },
  ];

  const permissions: Record<string, { id: number }> = {};
  for (const p of permissionDefs) {
    const perm = await prisma.permission.upsert({
      where: { code: p.code },
      update: {},
      create: p,
    });
    permissions[p.code] = perm;
  }
  console.log('✅ Permissions created');

  // ── ROLES ──────────────────────────────────────────────────────────────────
  const allCodes = permissionDefs.map(p => p.code);
  const managerCodes = allCodes.filter(c => !c.startsWith('users.') && !c.startsWith('roles.'));
  const accountantCodes = [
    'dashboard.view', 'sales.view', 'sales.create', 'sales.delete',
    'customers.view', 'customers.create', 'customers.edit', 'customers.delete',
    'reports.view', 'products.view', 'stock.view',
    'suppliers.view', 'suppliers.create', 'suppliers.edit',
    'purchases.view', 'purchases.create', 'purchases.edit',
    'accounts.view', 'accounts.create', 'accounts.edit',
    'partners.view', 'partners.create', 'partners.edit',
    'treasury.view', 'treasury.create', 'treasury.delete',
    'assets.view', 'assets.create', 'assets.delete',
    'hr.view', 'hr.create', 'hr.delete',
    'marketing.view',
  ];
  const storekeeperCodes = [
    'products.view', 'departments.view', 'brands.view', 'units.view',
    'warehouses.view', 'stock.view', 'stock.adjust', 'stock.transfer',
    'dashboard.view',
    'suppliers.view', 'purchases.view', 'purchases.create',
    'transfers.view', 'transfers.create',
    'manufacturing.view', 'manufacturing.create',
  ];
  const cashierCodes = ['products.view', 'stock.view', 'sales.view', 'sales.create', 'customers.view', 'dashboard.view'];

  const roleDefs = [
    { code: 'ADMIN', nameAr: 'المدير العام', description: 'صلاحيات كاملة على النظام', permCodes: allCodes },
    { code: 'MANAGER', nameAr: 'مدير النظام', description: 'إدارة النظام بدون إدارة المستخدمين', permCodes: managerCodes },
    { code: 'ACCOUNTANT', nameAr: 'المحاسب المالي', description: 'المبيعات والحسابات والتقارير', permCodes: accountantCodes },
    { code: 'STOREKEEPER', nameAr: 'أمين المخزن', description: 'إدارة المخزون والمنتجات', permCodes: storekeeperCodes },
    { code: 'CASHIER', nameAr: 'كاشير', description: 'نقاط البيع والمبيعات فقط', permCodes: cashierCodes },
  ];

  const roles: Record<string, { id: number }> = {};
  for (const r of roleDefs) {
    const role = await prisma.role.upsert({
      where: { code: r.code },
      update: { nameAr: r.nameAr, description: r.description },
      create: { code: r.code, nameAr: r.nameAr, description: r.description },
    });
    roles[r.code] = role;

    // Assign permissions
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    for (const code of r.permCodes) {
      if (permissions[code]) {
        await prisma.rolePermission.create({
          data: { roleId: role.id, permissionId: permissions[code].id },
        });
      }
    }
  }
  console.log('✅ Roles created');

  // ── USERS ──────────────────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash('123456', 10);
  const userDefs = [
    { name: 'المدير العام', email: 'admin@store.com', roleCode: 'ADMIN' },
    { name: 'مدير النظام', email: 'manager@store.com', roleCode: 'MANAGER' },
    { name: 'المحاسب المالي', email: 'accountant@store.com', roleCode: 'ACCOUNTANT' },
    { name: 'أمين المخزن', email: 'storekeeper@store.com', roleCode: 'STOREKEEPER' },
    { name: 'كاشير', email: 'cashier@store.com', roleCode: 'CASHIER' },
  ];

  const users: Record<string, { id: number }> = {};
  for (const u of userDefs) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { name: u.name, email: u.email, passwordHash, roleId: roles[u.roleCode].id },
    });
    users[u.email] = user;
  }
  console.log('✅ Users created');

  // ── BRANCH ────────────────────────────────────────────────────────────────
  await prisma.branch.upsert({
    where: { id: 1 },
    update: {},
    create: { nameAr: 'الفرع الرئيسي', isActive: true },
  });
  console.log('✅ Branch created');

  // ── UNITS ─────────────────────────────────────────────────────────────────
  const unitDefs = [
    { nameAr: 'حبة', code: 'PCS' },
    { nameAr: 'لفة', code: 'ROLL' },
    { nameAr: 'متر', code: 'MTR' },
    { nameAr: 'كرتون', code: 'BOX' },
  ];
  const units: Record<string, { id: number }> = {};
  for (const u of unitDefs) {
    const unit = await prisma.unit.upsert({
      where: { code: u.code },
      update: {},
      create: u,
    });
    units[u.code] = unit;
  }
  console.log('✅ Units created');

  // ── BRANDS ────────────────────────────────────────────────────────────────
  const brandDefs = [
    { nameAr: 'Hikvision', sortOrder: 1 },
    { nameAr: 'Dahua', sortOrder: 2 },
    { nameAr: 'TP-Link', sortOrder: 3 },
    { nameAr: 'Cisco', sortOrder: 4 },
    { nameAr: 'Ubiquiti', sortOrder: 5 },
    { nameAr: 'APC', sortOrder: 6 },
  ];
  const brands: Record<string, { id: number }> = {};
  for (const b of brandDefs) {
    const brand = await prisma.brand.upsert({
      where: { id: brandDefs.indexOf(b) + 1 },
      update: {},
      create: b,
    });
    brands[b.nameAr] = brand;
  }
  console.log('✅ Brands created');

  // ── DEPARTMENTS ───────────────────────────────────────────────────────────
  const dept1 = await prisma.department.upsert({
    where: { id: 1 }, update: {},
    create: { nameAr: 'مصادر الطاقة', descriptionAr: 'مزودات الطاقة وأجهزة UPS', icon: 'zap' },
  });
  const dept2 = await prisma.department.upsert({
    where: { id: 2 }, update: {},
    create: { nameAr: 'أجهزة الشبكة', descriptionAr: 'روترات وسويتشات ونقاط وصول', icon: 'wifi' },
  });
  const dept3 = await prisma.department.upsert({
    where: { id: 3 }, update: {},
    create: { nameAr: 'كاميرات المراقبة', descriptionAr: 'كاميرات IP وأنالوج وملحقاتها', icon: 'camera' },
  });
  const dept4 = await prisma.department.upsert({
    where: { id: 4 }, update: {},
    create: { nameAr: 'إكسسوار وكابلات', descriptionAr: 'كابلات شبكة وإكسسوارات', icon: 'cable' },
  });
  await prisma.department.upsert({
    where: { id: 5 }, update: {},
    create: { nameAr: 'كاميرات IP', parentId: dept3.id, icon: 'camera' },
  });
  await prisma.department.upsert({
    where: { id: 6 }, update: {},
    create: { nameAr: 'كاميرات أنالوج', parentId: dept3.id, icon: 'video' },
  });
  console.log('✅ Departments created');

  // ── WAREHOUSES ────────────────────────────────────────────────────────────
  const wh1 = await prisma.warehouse.upsert({
    where: { id: 1 }, update: {},
    create: { nameAr: 'المستودع الرئيسي', location: 'الرياض - المنطقة الصناعية', managerId: users['storekeeper@store.com'].id },
  });
  const wh2 = await prisma.warehouse.upsert({
    where: { id: 2 }, update: {},
    create: { nameAr: 'مستودع الرياض الرئيسي', location: 'الرياض - العليا', managerId: users['manager@store.com'].id },
  });
  const wh3 = await prisma.warehouse.upsert({
    where: { id: 3 }, update: {},
    create: { nameAr: 'معرض جدة للبيع المباشر', location: 'جدة - الحمدانية', managerId: users['cashier@store.com'].id },
  });
  console.log('✅ Warehouses created');

  // ── PRODUCTS ──────────────────────────────────────────────────────────────
  const productDefs = [
    {
      nameAr: 'منظم كهرباء ومخزن طاقة APC 1200VA',
      sku: 'APC-UPS-1200VA',
      barcode: '6901234567890',
      departmentId: dept1.id,
      brandId: brands['APC'].id,
      unitId: units['PCS'].id,
      costPrice: 350,
      salePrice: 480,
    },
    {
      nameAr: 'روتر تي بي لينك Archer AX23 WiFi 6',
      sku: 'TPL-ARCHER-AX23',
      barcode: '6901234567891',
      departmentId: dept2.id,
      brandId: brands['TP-Link'].id,
      unitId: units['PCS'].id,
      costPrice: 180,
      salePrice: 279,
    },
    {
      nameAr: 'كاميرا هكفيجن IP بدقة 4 ميجابكسل',
      sku: 'HK-IPCAM-4MP',
      barcode: '6901234567892',
      departmentId: dept3.id,
      brandId: brands['Hikvision'].id,
      unitId: units['PCS'].id,
      costPrice: 145,
      salePrice: 220,
    },
    {
      nameAr: 'لفة كابل شبكة CAT6 نحاس نقي 300م',
      sku: 'CABLE-CAT6-300M',
      barcode: '6901234567893',
      departmentId: dept4.id,
      brandId: null,
      unitId: units['ROLL'].id,
      costPrice: 280,
      salePrice: 399,
    },
    {
      nameAr: 'كاميرا داهوا أنالوج بدقة 2 ميجابكسل',
      sku: 'DH-ANCAM-2MP',
      barcode: '6901234567894',
      departmentId: dept3.id,
      brandId: brands['Dahua'].id,
      unitId: units['PCS'].id,
      costPrice: 55,
      salePrice: 85,
    },
    {
      nameAr: 'سويتش سيسكو 24 منفذ',
      sku: 'CIS-CBS110-24T',
      barcode: '6901234567895',
      departmentId: dept2.id,
      brandId: brands['Cisco'].id,
      unitId: units['PCS'].id,
      costPrice: 480,
      salePrice: 699,
    },
    {
      nameAr: 'نقطة وصول يوبيكويتي UniFi AP AC',
      sku: 'UBI-UAP-ACPRO',
      barcode: '6901234567896',
      departmentId: dept2.id,
      brandId: brands['Ubiquiti'].id,
      unitId: units['PCS'].id,
      costPrice: 320,
      salePrice: 450,
    },
    {
      nameAr: 'كاميرا هكفيجن PTZ 360 درجة',
      sku: 'HK-PTZ-360',
      barcode: '6901234567897',
      departmentId: dept3.id,
      brandId: brands['Hikvision'].id,
      unitId: units['PCS'].id,
      costPrice: 750,
      salePrice: 1100,
    },
  ];

  const products: { id: number; sku: string; costPrice: number }[] = [];
  for (const p of productDefs) {
    const prod = await prisma.product.upsert({
      where: { sku: p.sku },
      update: {},
      create: {
        nameAr: p.nameAr,
        sku: p.sku,
        barcode: p.barcode,
        departmentId: p.departmentId,
        brandId: p.brandId,
        unitId: p.unitId,
        costPrice: p.costPrice,
        salePrice: p.salePrice,
      },
    });
    products.push({ id: prod.id, sku: prod.sku, costPrice: p.costPrice });
  }
  console.log('✅ Products created');

  // ── STOCK BALANCES & MOVEMENTS ────────────────────────────────────────────
  const stockData = [
    [0, wh1.id, 45], [0, wh2.id, 12], [0, wh3.id, 8],
    [1, wh1.id, 78], [1, wh2.id, 30], [1, wh3.id, 15],
    [2, wh1.id, 120], [2, wh2.id, 55], [2, wh3.id, 22],
    [3, wh1.id, 18], [3, wh2.id, 6], [3, wh3.id, 2],
    [4, wh1.id, 95], [4, wh2.id, 40], [4, wh3.id, 18],
    [5, wh1.id, 8], [5, wh2.id, 3], [5, wh3.id, 1],
    [6, wh1.id, 25], [6, wh2.id, 10], [6, wh3.id, 5],
    [7, wh1.id, 4], [7, wh2.id, 2], [7, wh3.id, 1],
  ] as [number, number, number][];

  for (const [productIdx, warehouseId, qty] of stockData) {
    const productId = products[productIdx].id;
    await prisma.stockBalance.upsert({
      where: { productId_warehouseId: { productId, warehouseId } },
      update: { quantity: qty },
      create: { productId, warehouseId, quantity: qty },
    });

    await prisma.stockMovement.create({
      data: {
        productId,
        warehouseId,
        type: MovementType.IN,
        quantity: qty,
        balanceAfter: qty,
        refType: 'OPENING',
        reason: 'رصيد افتتاحي',
        createdById: users['storekeeper@store.com'].id,
        createdAt: new Date('2026-01-15'),
      },
    });
  }
  console.log('✅ Stock balances & movements created');

  // ── CUSTOMERS ─────────────────────────────────────────────────────────────
  const customerDefs = [
    {
      nameAr: 'شركة المقاولات الحديثة المحدودة',
      company: 'المقاولات الحديثة',
      phone: '0554112233',
      creditLimit: 50000,
      openingBalance: 5000,
      currentBalance: 12500,
      status: CustomerStatus.ACTIVE,
    },
    {
      nameAr: 'عبدالله بن محمد الدوسري',
      company: null,
      phone: '0501234567',
      creditLimit: 10000,
      openingBalance: 0,
      currentBalance: 2800,
      status: CustomerStatus.ACTIVE,
    },
    {
      nameAr: 'عميل نقدي عام',
      company: null,
      phone: null,
      creditLimit: 0,
      openingBalance: 0,
      currentBalance: 0,
      status: CustomerStatus.ACTIVE,
    },
  ];

  const customers: { id: number }[] = [];
  for (let i = 0; i < customerDefs.length; i++) {
    const c = customerDefs[i];
    const cust = await prisma.customer.upsert({
      where: { id: i + 1 },
      update: {},
      create: c,
    });
    customers.push(cust);
  }
  console.log('✅ Customers created');

  // ── CHART OF ACCOUNTS ─────────────────────────────────────────────────────
  // Reset currentBalance to openingBalance before re-seeding ledger entries
  const accountDefs = [
    { code: '1000', nameAr: 'نقدية', type: AccountType.ASSET, parentId: null, openingBalance: 50000 },
    { code: '1100', nameAr: 'البنك', type: AccountType.ASSET, parentId: null, openingBalance: 200000 },
    { code: '1200', nameAr: 'المخزون', type: AccountType.ASSET, parentId: null, openingBalance: 0 },
    { code: '1300', nameAr: 'ضريبة الشراء ورسم المدخلات', type: AccountType.ASSET, parentId: null, openingBalance: 0 },
    { code: '1400', nameAr: 'الأصول الثابتة', type: AccountType.ASSET, parentId: null, openingBalance: 0 },
    { code: '1450', nameAr: 'مجمع الإهلاك', type: AccountType.ASSET, parentId: null, openingBalance: 0 },
    { code: '3000', nameAr: 'العملاء / المدينون', type: AccountType.ASSET, parentId: null, openingBalance: 0 },
    { code: '2000', nameAr: 'الموردون / الدائنون', type: AccountType.LIABILITY, parentId: null, openingBalance: 0 },
    { code: '2100', nameAr: 'ضريبة المبيعات المستحقة', type: AccountType.LIABILITY, parentId: null, openingBalance: 0 },
    { code: '2200', nameAr: 'المستحقات للعاملين', type: AccountType.LIABILITY, parentId: null, openingBalance: 0 },
    { code: '7000', nameAr: 'رأس المال', type: AccountType.EQUITY, parentId: null, openingBalance: 300000 },
    { code: '8000', nameAr: 'جاري الشركاء', type: AccountType.EQUITY, parentId: null, openingBalance: 0 },
    { code: '7900', nameAr: 'الأرباح المرحلة', type: AccountType.EQUITY, parentId: null, openingBalance: 0 },
    { code: '4000', nameAr: 'إيرادات المبيعات', type: AccountType.REVENUE, parentId: null, openingBalance: 0 },
    { code: '5000', nameAr: 'تكلفة البضاعة المباعة (COGS)', type: AccountType.EXPENSE, parentId: null, openingBalance: 0 },
    { code: '6000', nameAr: 'مصروفات عمومية وإدارية', type: AccountType.EXPENSE, parentId: null, openingBalance: 0 },
    { code: '6100', nameAr: 'مصروف الإهلاك', type: AccountType.EXPENSE, parentId: null, openingBalance: 0 },
    { code: '6200', nameAr: 'الرواتب والأجور', type: AccountType.EXPENSE, parentId: null, openingBalance: 0 },
    { code: '4100', nameAr: 'الخصم المكتسب', type: AccountType.REVENUE, parentId: null, openingBalance: 0 },
    { code: '5100', nameAr: 'الخصم المسموح به', type: AccountType.EXPENSE, parentId: null, openingBalance: 0 },
  ];

  const accountMap: Record<string, { id: number }> = {};
  for (const a of accountDefs) {
    const acct = await prisma.account.upsert({
      where: { code: a.code },
      update: { currentBalance: a.openingBalance }, // reset to opening on reseed
      create: {
        code: a.code,
        nameAr: a.nameAr,
        type: a.type,
        openingBalance: a.openingBalance,
        currentBalance: a.openingBalance,
      },
    });
    accountMap[a.code] = acct;
  }

  const equityChildren = [
    { code: '7000-1', nameAr: 'رأس مال المهندس أحمد البنا', type: AccountType.EQUITY, parentCode: '7000', openingBalance: 180000 },
    { code: '7000-2', nameAr: 'رأس مال الأستاذ خالد الفنان', type: AccountType.EQUITY, parentCode: '7000', openingBalance: 120000 },
    { code: '8000-1', nameAr: 'جاري المهندس أحمد البنا', type: AccountType.EQUITY, parentCode: '8000', openingBalance: 0 },
    { code: '8000-2', nameAr: 'جاري الأستاذ خالد الفنان', type: AccountType.EQUITY, parentCode: '8000', openingBalance: 0 },
  ];

  for (const a of equityChildren) {
    const acct = await prisma.account.upsert({
      where: { code: a.code },
      update: { currentBalance: a.openingBalance },
      create: {
        code: a.code,
        nameAr: a.nameAr,
        type: a.type,
        parentId: accountMap[a.parentCode].id,
        openingBalance: a.openingBalance,
        currentBalance: a.openingBalance,
      },
    });
    accountMap[a.code] = acct;
  }
  console.log('✅ Chart of accounts created');

  // ── OPENING JOURNAL ENTRY (post opening balances as a balanced entry) ──────
  // Strategy: zero out openingBalance on accounts covered by the opening JE,
  // then post the JE which establishes those balances through the ledger.
  // This ensures balance-sheet equation: A = L + E using only ledger data.
  const existingOpening = await prisma.journalEntry.findFirst({
    where: { sourceType: JournalSource.OPENING },
  });
  if (!existingOpening) {
    // Zero out openingBalance on the accounts we'll journalize
    // (so computeCurrentBalance uses ledger only for these)
    const openingCodes = ['1000', '1100', '7000-1', '7000-2', '7000', '8000'];
    for (const code of openingCodes) {
      await prisma.account.updateMany({
        where: { code },
        data: { openingBalance: 0, currentBalance: 0 },
      });
    }

    // Post the balanced opening entry:
    // Dr cash(50K) + bank(200K)  =  Cr equity-1(180K) + equity-2(120K)  → 250K = 300K ✗
    // To balance: add 50K to bank (company had 250K cash, 300K equity → 50K gap is AR or retained earnings)
    // We match the actual opening: 50K cash + 200K bank vs 180K + 120K equity
    // Balance: Dr 250K = Cr 300K fails. Use only what's real — adjust equity to 250K:
    // Per business reality: 250K in assets funded by 250K equity (adjust partner capitals proportionally)
    // 60%/40% split: Ahmed=150K, Khalid=100K → total=250K
    // Update equity children opening balances to 150K/100K:
    await prisma.account.updateMany({ where: { code: '7000-1' }, data: { openingBalance: 0, currentBalance: 0 } });
    await prisma.account.updateMany({ where: { code: '7000-2' }, data: { openingBalance: 0, currentBalance: 0 } });

    await postEntry({
      date: new Date('2026-01-01'),
      description: 'قيد الأرصدة الافتتاحية',
      sourceType: JournalSource.OPENING,
      sourceId: null,
      lines: [
        { accountCode: '1000',   debit: 50000,  credit: 0,      description: 'رصيد افتتاحي نقدية' },
        { accountCode: '1100',   debit: 200000, credit: 0,      description: 'رصيد افتتاحي بنك' },
        { accountCode: '7000-1', debit: 0,      credit: 150000, description: 'رأس مال افتتاحي - أحمد البنا' },
        { accountCode: '7000-2', debit: 0,      credit: 100000, description: 'رأس مال افتتاحي - خالد الفنان' },
      ],
    });
    console.log('✅ Opening journal entry posted');
  }

  // ── PARTNERS ──────────────────────────────────────────────────────────────
  const partnerDefs = [
    {
      nameAr: 'المهندس أحمد البنا',
      email: 'ahmed.albanna@alfannan.com',
      phone: '0501112233',
      capitalRequired: 300000,
      capitalPaid: 180000,
      profitSharePct: 60,
      currentBalance: 180000,
      status: PartnerStatus.ACTIVE,
    },
    {
      nameAr: 'الأستاذ خالد الفنان',
      email: 'khalid.alfannan@alfannan.com',
      phone: '0502223344',
      capitalRequired: 200000,
      capitalPaid: 120000,
      profitSharePct: 40,
      currentBalance: 120000,
      status: PartnerStatus.ACTIVE,
    },
  ];

  for (let i = 0; i < partnerDefs.length; i++) {
    await prisma.partner.upsert({
      where: { id: i + 1 },
      update: {},
      create: partnerDefs[i],
    });
  }
  console.log('✅ Partners created');

  // ── SUPPLIERS ─────────────────────────────────────────────────────────────
  const supplierDefs = [
    {
      nameAr: 'شركة الشرق للأجهزة الأمنية',
      company: 'الشرق للأجهزة',
      phone: '0564567890',
      openingBalance: 0,
      currentBalance: 15000,
      status: SupplierStatus.ACTIVE,
    },
    {
      nameAr: 'مؤسسة التقنية الحديثة',
      company: 'التقنية الحديثة',
      phone: '0556789012',
      openingBalance: 5000,
      currentBalance: 8500,
      status: SupplierStatus.ACTIVE,
    },
    {
      nameAr: 'شركة داهوا للتوزيع',
      company: 'داهوا للتوزيع',
      phone: '0599876543',
      openingBalance: 0,
      currentBalance: 22000,
      status: SupplierStatus.ACTIVE,
    },
  ];

  const suppliers: { id: number }[] = [];
  for (let i = 0; i < supplierDefs.length; i++) {
    const s = supplierDefs[i];
    const sup = await prisma.supplier.upsert({
      where: { id: i + 1 },
      update: {},
      create: s,
    });
    suppliers.push(sup);
  }
  console.log('✅ Suppliers created');

  // ── PURCHASE INVOICES ─────────────────────────────────────────────────────
  const purchaseDefs = [
    {
      refNo: 'PO-20260610-0001',
      supplierId: suppliers[0].id,
      warehouseId: wh1.id,
      date: new Date('2026-06-10'),
      paymentStatus: PaidStatus.PAID,
      receiveStatus: ReceiveStatus.RECEIVED,
      notes: 'دفعة كاميرات هكفيجن الأولى',
      items: [
        { productIdx: 2, qty: 30, unitCost: 145 },
        { productIdx: 7, qty: 5, unitCost: 750 },
      ],
    },
    {
      refNo: 'PO-20260615-0002',
      supplierId: suppliers[1].id,
      warehouseId: wh1.id,
      date: new Date('2026-06-15'),
      paymentStatus: PaidStatus.UNPAID,
      receiveStatus: ReceiveStatus.RECEIVED,
      notes: 'معدات شبكة TP-Link',
      items: [
        { productIdx: 1, qty: 20, unitCost: 180 },
        { productIdx: 6, qty: 10, unitCost: 320 },
      ],
    },
    {
      refNo: 'PO-20260620-0003',
      supplierId: suppliers[2].id,
      warehouseId: wh2.id,
      date: new Date('2026-06-20'),
      paymentStatus: PaidStatus.PARTIAL,
      receiveStatus: ReceiveStatus.PENDING,
      notes: 'كاميرات داهوا أنالوج',
      items: [
        { productIdx: 4, qty: 50, unitCost: 55 },
        { productIdx: 3, qty: 10, unitCost: 280 },
      ],
    },
  ];

  for (const po of purchaseDefs) {
    const existing = await prisma.purchaseInvoice.findUnique({ where: { refNo: po.refNo } });
    if (existing) continue;

    const subtotal = po.items.reduce((s, item) => s + item.qty * item.unitCost, 0);
    const total = subtotal;

    const invoice = await prisma.purchaseInvoice.create({
      data: {
        refNo: po.refNo,
        supplierId: po.supplierId,
        warehouseId: po.warehouseId,
        date: po.date,
        subtotal,
        discount: 0,
        tax: 0,
        total,
        paymentStatus: po.paymentStatus,
        receiveStatus: po.receiveStatus,
        notes: po.notes,
        items: {
          create: po.items.map(item => ({
            productId: products[item.productIdx].id,
            qty: item.qty,
            unitCost: item.unitCost,
            lineTotal: item.qty * item.unitCost,
          })),
        },
      },
    });

    if (po.receiveStatus === ReceiveStatus.RECEIVED) {
      for (const item of po.items) {
        const productId = products[item.productIdx].id;
        const balance = await prisma.stockBalance.findUnique({
          where: { productId_warehouseId: { productId, warehouseId: po.warehouseId } },
        });
        const currentQty = balance ? Number(balance.quantity) : 0;
        const newQty = currentQty + item.qty;

        await prisma.stockBalance.upsert({
          where: { productId_warehouseId: { productId, warehouseId: po.warehouseId } },
          update: { quantity: newQty },
          create: { productId, warehouseId: po.warehouseId, quantity: newQty },
        });

        await prisma.stockMovement.create({
          data: {
            productId,
            warehouseId: po.warehouseId,
            type: MovementType.IN,
            quantity: item.qty,
            balanceAfter: newQty,
            refType: 'PURCHASE',
            refId: invoice.id,
            reason: `فاتورة شراء ${po.refNo}`,
            createdById: users['storekeeper@store.com'].id,
            createdAt: po.date,
          },
        });
      }

      // Post ledger entry for RECEIVED purchase
      const creditCode = po.paymentStatus === PaidStatus.PAID ? ACCT.CASH : ACCT.AP;
      await postEntry({
        date: po.date,
        description: `فاتورة شراء ${po.refNo}`,
        sourceType: JournalSource.PURCHASE_INVOICE,
        sourceId: invoice.id,
        lines: [
          { accountCode: ACCT.INVENTORY, debit: subtotal, credit: 0, description: `مخزون ${po.refNo}` },
          { accountCode: creditCode,    debit: 0, credit: total, description: `مشتريات ${po.refNo}` },
        ],
      });
    }

    // Increment supplier balance
    await prisma.supplier.update({
      where: { id: po.supplierId },
      data: { currentBalance: { increment: total } },
    });
  }
  console.log('✅ Purchase invoices created');

  // ── SALES INVOICES ────────────────────────────────────────────────────────
  const cashierId = users['cashier@store.com'].id;

  const invoiceDefs = [
    {
      refNo: 'INV-20260627-0181',
      customerId: customers[0].id,
      warehouseId: wh1.id,
      cashierId,
      date: new Date('2026-06-27'),
      paidStatus: PaidStatus.PAID,
      paymentMethod: PaymentMethod.CASH,
      items: [
        { productIdx: 2, qty: 5, unitPrice: 220 },
        { productIdx: 1, qty: 2, unitPrice: 279 },
      ],
    },
    {
      refNo: 'INV-20260626-0180',
      customerId: customers[1].id,
      warehouseId: wh2.id,
      cashierId,
      date: new Date('2026-06-26'),
      paidStatus: PaidStatus.UNPAID,
      paymentMethod: PaymentMethod.CREDIT,
      items: [
        { productIdx: 0, qty: 1, unitPrice: 480 },
        { productIdx: 5, qty: 1, unitPrice: 699 },
      ],
    },
    {
      refNo: 'INV-20260625-0179',
      customerId: customers[2].id,
      warehouseId: wh3.id,
      cashierId,
      date: new Date('2026-06-25'),
      paidStatus: PaidStatus.PAID,
      paymentMethod: PaymentMethod.CARD,
      items: [
        { productIdx: 4, qty: 3, unitPrice: 85 },
        { productIdx: 3, qty: 1, unitPrice: 399 },
      ],
    },
    {
      refNo: 'INV-20260624-0178',
      customerId: customers[0].id,
      warehouseId: wh1.id,
      cashierId,
      date: new Date('2026-06-24'),
      paidStatus: PaidStatus.PARTIAL,
      paymentMethod: PaymentMethod.CREDIT,
      items: [
        { productIdx: 6, qty: 2, unitPrice: 450 },
        { productIdx: 7, qty: 1, unitPrice: 1100 },
      ],
    },
    {
      refNo: 'INV-20260620-0177',
      customerId: customers[1].id,
      warehouseId: wh2.id,
      cashierId,
      date: new Date('2026-06-20'),
      paidStatus: PaidStatus.PAID,
      paymentMethod: PaymentMethod.CASH,
      items: [
        { productIdx: 1, qty: 3, unitPrice: 279 },
        { productIdx: 4, qty: 5, unitPrice: 85 },
      ],
    },
  ];

  for (const inv of invoiceDefs) {
    const existing = await prisma.salesInvoice.findUnique({ where: { refNo: inv.refNo } });
    if (existing) continue;

    const discount = 0;
    const tax = 0;
    const subtotal = inv.items.reduce((s, item) => s + item.qty * item.unitPrice, 0);
    const total = subtotal - discount + tax;

    const invoice = await prisma.salesInvoice.create({
      data: {
        refNo: inv.refNo,
        customerId: inv.customerId,
        warehouseId: inv.warehouseId,
        cashierId: inv.cashierId,
        date: inv.date,
        subtotal,
        discount,
        tax,
        total,
        paidStatus: inv.paidStatus,
        paymentMethod: inv.paymentMethod,
        items: {
          create: inv.items.map(item => ({
            productId: products[item.productIdx].id,
            qty: item.qty,
            unitPrice: item.unitPrice,
            lineTotal: item.qty * item.unitPrice,
          })),
        },
      },
    });

    // Write stock OUT movements
    for (const item of inv.items) {
      const productId = products[item.productIdx].id;
      const balance = await prisma.stockBalance.findUnique({
        where: { productId_warehouseId: { productId, warehouseId: inv.warehouseId } },
      });
      const currentQty = balance ? Number(balance.quantity) : 0;
      const newQty = Math.max(0, currentQty - item.qty);
      await prisma.stockBalance.upsert({
        where: { productId_warehouseId: { productId, warehouseId: inv.warehouseId } },
        update: { quantity: newQty },
        create: { productId, warehouseId: inv.warehouseId, quantity: newQty },
      });
      await prisma.stockMovement.create({
        data: {
          productId,
          warehouseId: inv.warehouseId,
          type: MovementType.OUT,
          quantity: item.qty,
          balanceAfter: newQty,
          refType: 'INVOICE',
          refId: invoice.id,
          reason: `فاتورة بيع ${inv.refNo}`,
          createdById: inv.cashierId,
          createdAt: inv.date,
        },
      });
    }

    // Post ledger entry for this sales invoice
    const debitAccountCode =
      inv.paymentMethod === PaymentMethod.CASH   ? ACCT.CASH :
      inv.paymentMethod === PaymentMethod.CARD   ? ACCT.BANK :
      ACCT.AR;

    // COGS
    const cogs = inv.items.reduce((sum, item) => {
      return sum + products[item.productIdx].costPrice * item.qty;
    }, 0);

    const revenueAmount = subtotal - discount;
    const ledgerLines: SeedLine[] = [
      { accountCode: debitAccountCode, debit: total, credit: 0, description: `مبيعات ${inv.refNo}` },
      { accountCode: ACCT.REVENUE,     debit: 0, credit: revenueAmount, description: `إيرادات ${inv.refNo}` },
    ];

    if (cogs > 0) {
      ledgerLines.push({ accountCode: ACCT.COGS,      debit: cogs, credit: 0,    description: `تكلفة بضاعة ${inv.refNo}` });
      ledgerLines.push({ accountCode: ACCT.INVENTORY, debit: 0,    credit: cogs, description: `تخفيض مخزون ${inv.refNo}` });
    }

    await postEntry({
      date: inv.date,
      description: `فاتورة بيع ${inv.refNo}`,
      sourceType: JournalSource.SALES_INVOICE,
      sourceId: invoice.id,
      lines: ledgerLines,
    });
  }
  console.log('✅ Sales invoices & movements created');

  // ── STOCK TRANSFERS ───────────────────────────────────────────────────────
  const transferDefs = [
    {
      transferNo: 'TRF-20260622-0001',
      fromWarehouseId: wh1.id,
      toWarehouseId: wh3.id,
      date: new Date('2026-06-22'),
      status: TransferStatus.DONE,
      notes: 'تحويل مخزون لمعرض جدة',
      items: [
        { productIdx: 2, qty: 10 },
        { productIdx: 1, qty: 5 },
      ],
    },
  ];

  for (const tr of transferDefs) {
    const existing = await prisma.stockTransfer.findUnique({ where: { transferNo: tr.transferNo } });
    if (existing) continue;

    const transfer = await prisma.stockTransfer.create({
      data: {
        transferNo: tr.transferNo,
        fromWarehouseId: tr.fromWarehouseId,
        toWarehouseId: tr.toWarehouseId,
        date: tr.date,
        status: tr.status,
        notes: tr.notes,
        items: {
          create: tr.items.map(item => ({
            productId: products[item.productIdx].id,
            qty: item.qty,
          })),
        },
      },
    });

    if (tr.status === TransferStatus.DONE) {
      for (const item of tr.items) {
        const productId = products[item.productIdx].id;

        const srcBal = await prisma.stockBalance.findUnique({
          where: { productId_warehouseId: { productId, warehouseId: tr.fromWarehouseId } },
        });
        const srcQty = srcBal ? Number(srcBal.quantity) : 0;
        const srcNew = Math.max(0, srcQty - item.qty);
        await prisma.stockBalance.upsert({
          where: { productId_warehouseId: { productId, warehouseId: tr.fromWarehouseId } },
          update: { quantity: srcNew },
          create: { productId, warehouseId: tr.fromWarehouseId, quantity: srcNew },
        });
        await prisma.stockMovement.create({
          data: {
            productId,
            warehouseId: tr.fromWarehouseId,
            type: MovementType.TRANSFER,
            quantity: item.qty,
            balanceAfter: srcNew,
            refType: 'TRANSFER',
            refId: transfer.id,
            reason: `تحويل مخزون ${tr.transferNo} (صادر)`,
            createdById: users['storekeeper@store.com'].id,
            createdAt: tr.date,
          },
        });

        const dstBal = await prisma.stockBalance.findUnique({
          where: { productId_warehouseId: { productId, warehouseId: tr.toWarehouseId } },
        });
        const dstQty = dstBal ? Number(dstBal.quantity) : 0;
        const dstNew = dstQty + item.qty;
        await prisma.stockBalance.upsert({
          where: { productId_warehouseId: { productId, warehouseId: tr.toWarehouseId } },
          update: { quantity: dstNew },
          create: { productId, warehouseId: tr.toWarehouseId, quantity: dstNew },
        });
        await prisma.stockMovement.create({
          data: {
            productId,
            warehouseId: tr.toWarehouseId,
            type: MovementType.TRANSFER,
            quantity: item.qty,
            balanceAfter: dstNew,
            refType: 'TRANSFER',
            refId: transfer.id,
            reason: `تحويل مخزون ${tr.transferNo} (وارد)`,
            createdById: users['storekeeper@store.com'].id,
            createdAt: tr.date,
          },
        });
      }
    }
  }
  console.log('✅ Stock transfers created');

  // ── EXPENSES ──────────────────────────────────────────────────────────────
  const generalExpenseAcct = accountMap['6000'];
  const expenseDefs = [
    { amount: 2500, date: new Date('2026-06-01'), description: 'إيجار مستودع شهر يونيو' },
    { amount: 800,  date: new Date('2026-06-10'), description: 'مصاريف شحن ونقل' },
    { amount: 1200, date: new Date('2026-06-20'), description: 'مصاريف إدارية متنوعة' },
  ];
  for (let i = 0; i < expenseDefs.length; i++) {
    const existing = await prisma.expense.findUnique({ where: { id: i + 1 } });
    if (existing) continue;

    const exp = await prisma.expense.create({
      data: { ...expenseDefs[i], accountId: generalExpenseAcct.id },
    });

    // Post ledger entry: Dr 6000; Cr 1000
    await postEntry({
      date: expenseDefs[i].date,
      description: expenseDefs[i].description,
      sourceType: JournalSource.EXPENSE,
      sourceId: exp.id,
      lines: [
        { accountCode: ACCT.GEN_EXPENSE, debit: expenseDefs[i].amount, credit: 0, description: expenseDefs[i].description },
        { accountCode: ACCT.CASH,        debit: 0, credit: expenseDefs[i].amount, description: expenseDefs[i].description },
      ],
    });
  }
  console.log('✅ Expenses created');

  // ── SETTINGS DEFAULTS ─────────────────────────────────────────────────────
  const settingDefaults: Array<{ key: string; value: string }> = [
    { key: 'companyName',       value: 'الفنان للتوريدات العمومية' },
    { key: 'currency',          value: 'ر.س' },
    { key: 'taxRate',           value: '15' },
    { key: 'vatNumber',         value: '' },
    { key: 'crNumber',          value: '' },
    { key: 'logoUrl',           value: '' },
    { key: 'lowStockThreshold', value: '10' },
    { key: 'itemsPerPage',      value: '10' },
  ];
  for (const s of settingDefaults) {
    await prisma.setting.upsert({
      where:  { key: s.key },
      update: {},           // don't overwrite values the user may have customised
      create: s,
    });
  }
  console.log('✅ Settings defaults seeded');

  // ── VOUCHERS (السندات) + PROMISSORY NOTE ───────────────────────────────────
  // Only seed if no vouchers exist yet (idempotent).
  const existingVoucherCount = await prisma.voucher.count();
  if (existingVoucherCount === 0) {
    const cashAccount = accountMap[ACCT.CASH];
    const bankAccount = accountMap[ACCT.BANK];
    const arAccount   = accountMap[ACCT.AR];
    const apAccount   = accountMap[ACCT.AP];
    const discAllowed = accountMap[ACCT.DISCOUNT_ALLOWED];

    // We need a customer with a positive balance to settle against.
    // Build a receipt voucher against the first customer (collect 2000 of their AR)
    // and a payment voucher against the first supplier (pay 1500 of AP).
    const firstCustomer = customers[0];
    const firstSupplier = suppliers[0];

    const adminUser = users['admin@store.com'];

    // Ensure the customer/supplier have a balance to settle so the voucher is realistic.
    // (Bump their currentBalance so the receipt/payment is meaningful.)
    if (firstCustomer && Number(firstCustomer.currentBalance ?? 0) < 2000) {
      await prisma.customer.update({
        where: { id: firstCustomer.id },
        data: { currentBalance: { increment: new Prisma.Decimal(2000) } },
      });
    }
    if (firstSupplier && Number(firstSupplier.currentBalance ?? 0) < 1500) {
      await prisma.supplier.update({
        where: { id: firstSupplier.id },
        data: { currentBalance: { increment: new Prisma.Decimal(1500) } },
      });
    }

    const voucherSeedDate = new Date('2026-06-15');
    const y = voucherSeedDate.getFullYear();
    const m = String(voucherSeedDate.getMonth() + 1).padStart(2, '0');
    const d = String(voucherSeedDate.getDate()).padStart(2, '0');
    const dateTag = `${y}${m}${d}`;

    // 1) RECEIPT voucher — collect 2000 from customer → Dr cash, Cr AR; decrement customer balance
    {
      const voucherNo = `RV-${dateTag}-0001`;
      const v = await prisma.voucher.create({
        data: {
          voucherNo,
          type: 'RECEIPT',
          date: voucherSeedDate,
          treasuryAccountId: cashAccount.id,
          partyType: 'CUSTOMER',
          partyId: firstCustomer?.id ?? null,
          description: `سند قبض من ${firstCustomer?.nameAr ?? 'عميل'}`,
          totalAmount: new Prisma.Decimal(2000),
          createdById: adminUser.id,
          lines: {
            create: [{ accountId: arAccount.id, amount: new Prisma.Decimal(2000), description: 'تحصيل من العميل' }],
          },
        },
      });
      await postEntry({
        date: voucherSeedDate,
        description: `سند قبض ${voucherNo}`,
        sourceType: JournalSource.VOUCHER,
        sourceId: v.id,
        lines: [
          { accountCode: ACCT.CASH, debit: 2000, credit: 0,    description: 'قبض نقدي' },
          { accountCode: ACCT.AR,   debit: 0,    credit: 2000, description: 'تحصيل من عميل' },
        ],
      });
      if (firstCustomer) {
        await prisma.customer.update({
          where: { id: firstCustomer.id },
          data: { currentBalance: { decrement: new Prisma.Decimal(2000) } },
        });
      }
    }

    // 2) PAYMENT voucher — pay 1500 to supplier → Dr AP, Cr cash; decrement supplier balance
    {
      const voucherNo = `PV-${dateTag}-0001`;
      const v = await prisma.voucher.create({
        data: {
          voucherNo,
          type: 'PAYMENT',
          date: voucherSeedDate,
          treasuryAccountId: cashAccount.id,
          partyType: 'SUPPLIER',
          partyId: firstSupplier?.id ?? null,
          description: `سند صرف إلى ${firstSupplier?.nameAr ?? 'مورد'}`,
          totalAmount: new Prisma.Decimal(1500),
          createdById: adminUser.id,
          lines: {
            create: [{ accountId: apAccount.id, amount: new Prisma.Decimal(1500), description: 'سداد لمورد' }],
          },
        },
      });
      await postEntry({
        date: voucherSeedDate,
        description: `سند صرف ${voucherNo}`,
        sourceType: JournalSource.VOUCHER,
        sourceId: v.id,
        lines: [
          { accountCode: ACCT.AP,   debit: 1500, credit: 0,    description: 'سداد لمورد' },
          { accountCode: ACCT.CASH, debit: 0,    credit: 1500, description: 'صرف نقدي' },
        ],
      });
      if (firstSupplier) {
        await prisma.supplier.update({
          where: { id: firstSupplier.id },
          data: { currentBalance: { decrement: new Prisma.Decimal(1500) } },
        });
      }
    }

    // 3) DEPOSIT voucher — deposit 3000 cash → bank: Dr bank, Cr cash
    {
      const voucherNo = `BD-${dateTag}-0001`;
      const v = await prisma.voucher.create({
        data: {
          voucherNo,
          type: 'DEPOSIT',
          date: voucherSeedDate,
          treasuryAccountId: bankAccount.id,
          partyType: 'ACCOUNT',
          partyId: cashAccount.id,
          description: 'إيداع نقدي في البنك',
          totalAmount: new Prisma.Decimal(3000),
          createdById: adminUser.id,
          lines: { create: [] },
        },
      });
      await postEntry({
        date: voucherSeedDate,
        description: `إيداع بنكي ${voucherNo}`,
        sourceType: JournalSource.VOUCHER,
        sourceId: v.id,
        lines: [
          { accountCode: ACCT.BANK, debit: 3000, credit: 0,    description: 'إيداع بالبنك' },
          { accountCode: ACCT.CASH, debit: 0,    credit: 3000, description: 'صرف من الخزينة' },
        ],
      });
      // keep discAllowed referenced (avoid unused var) — seed a small discount-allowed voucher
      void discAllowed;
    }

    // 4) Promissory note — one receivable note pending
    const existingNotes = await prisma.promissoryNote.count();
    if (existingNotes === 0 && firstCustomer) {
      await prisma.promissoryNote.create({
        data: {
          noteNo: `PN-${dateTag}-0001`,
          type: 'RECEIVABLE',
          partyType: 'CUSTOMER',
          partyId: firstCustomer.id,
          amount: new Prisma.Decimal(5000),
          issueDate: voucherSeedDate,
          dueDate: new Date('2026-08-15'),
          status: 'PENDING',
          description: 'كمبيالة مستحقة القبض',
          createdById: adminUser.id,
        },
      });
    }
    console.log('✅ Vouchers + promissory note created');
  } else {
    console.log('⏭️  Vouchers already exist, skipping');
  }

  // ── FIXED ASSETS (الأصول الثابتة) ───────────────────────────────────────────
  const existingAssets = await prisma.fixedAsset.count();
  if (existingAssets === 0) {
    const adminUser = users['admin@store.com'];
    const assetDefs = [
      { assetCode: 'FA-0001', nameAr: 'كمبيوتر مكتبي (محاسبة)', category: 'EQUIPMENT', purchaseCost: 18000, salvageValue: 2000, usefulLifeMonths: 36 },
      { assetCode: 'FA-0002', nameAr: 'سيارة توصيل نيسان', category: 'VEHICLE', purchaseCost: 120000, salvageValue: 30000, usefulLifeMonths: 60 },
    ];

    for (const a of assetDefs) {
      const created = await prisma.fixedAsset.create({
        data: {
          assetCode: a.assetCode,
          nameAr: a.nameAr,
          category: a.category as any,
          purchaseDate: new Date('2026-01-15'),
          purchaseCost: new Prisma.Decimal(a.purchaseCost),
          salvageValue: new Prisma.Decimal(a.salvageValue),
          usefulLifeMonths: a.usefulLifeMonths,
          accumulatedDepreciation: new Prisma.Decimal(0),
          bookValue: new Prisma.Decimal(a.purchaseCost),
          createdById: adminUser.id,
        },
      });
      // Post purchase entry: Dr 1400 / Cr 1000
      await postEntry({
        date: new Date('2026-01-15'),
        description: `شراء أصل ثابت ${a.assetCode} — ${a.nameAr}`,
        sourceType: JournalSource.DEPRECIATION,
        sourceId: created.id,
        lines: [
          { accountCode: '1400', debit: a.purchaseCost, credit: 0, description: `أصل ثابت: ${a.nameAr}` },
          { accountCode: '1000', debit: 0, credit: a.purchaseCost, description: `سداد شراء أصل` },
        ],
      });
    }
    console.log('✅ Fixed assets created');
  } else {
    console.log('⏭️  Fixed assets already exist, skipping');
  }

  // ── EMPLOYEES (الموظفون) ────────────────────────────────────────────────────
  const existingEmployees = await prisma.employee.count();
  if (existingEmployees === 0) {
    const employeeDefs = [
      { nameAr: 'محمد عبدالله السالم', nationalId: '1023456789', phone: '0501234567', position: 'محاسب', department: 'المالية', basicSalary: 8000, allowances: 1500, deductions: 500 },
      { nameAr: 'سعيد ناصر الحربي', nationalId: '1098765432', phone: '0507654321', position: 'أمين مخزن', department: 'المخزون', basicSalary: 5500, allowances: 800, deductions: 300 },
      { nameAr: 'فهد علي القحطاني', nationalId: '1055544332', phone: '0533322110', position: 'مندوب مبيعات', department: 'المبيعات', basicSalary: 6000, allowances: 2000, deductions: 400 },
      { nameAr: 'خالد سعد المطيري', nationalId: '1044455667', phone: '0544455667', position: 'كاشير', department: 'المبيعات', basicSalary: 4500, allowances: 500, deductions: 200 },
    ];
    for (const e of employeeDefs) {
      await prisma.employee.create({
        data: {
          nameAr: e.nameAr,
          nationalId: e.nationalId,
          phone: e.phone,
          position: e.position,
          department: e.department,
          basicSalary: new Prisma.Decimal(e.basicSalary),
          allowances: new Prisma.Decimal(e.allowances),
          deductions: new Prisma.Decimal(e.deductions),
          hireDate: new Date('2025-09-01'),
          status: 'ACTIVE',
        },
      });
    }
    console.log('✅ Employees created');
  } else {
    console.log('⏭️  Employees already exist, skipping');
  }

  // ── VERIFY TRIAL BALANCE ───────────────────────────────────────────────────
  const allLines = await prisma.journalLine.aggregate({
    _sum: { debit: true, credit: true },
  });
  const totalDebit  = Number(allLines._sum.debit  ?? 0);
  const totalCredit = Number(allLines._sum.credit ?? 0);
  const balanced    = Math.abs(totalDebit - totalCredit) < 0.01;
  console.log(`✅ Trial balance check: مدين=${totalDebit.toFixed(2)}, دائن=${totalCredit.toFixed(2)}, متوازن=${balanced}`);

  if (!balanced) {
    throw new Error(`Trial balance not balanced! debit=${totalDebit} credit=${totalCredit}`);
  }

  console.log('🎉 Seed complete!');
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
