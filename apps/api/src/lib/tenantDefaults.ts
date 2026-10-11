/**
 * Defaults every company (tenant) starts with — الإعدادات الافتراضية لكل شركة جديدة
 *
 * Single source of truth shared by prisma/seed.ts (demo tenant) and tenantProvisioning.ts
 * (self-service registration). Permissions are global rows; roles and accounts are per tenant.
 */
import { AccountType } from '@prisma/client';

export const PERMISSION_DEFS = [
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
  // Quotations — عروض الأسعار
  { code: 'quotations.view', group: 'quotations', nameAr: 'عرض عروض الأسعار' },
  { code: 'quotations.create', group: 'quotations', nameAr: 'إنشاء وإدارة عروض الأسعار' },
  { code: 'quotations.delete', group: 'quotations', nameAr: 'حذف عروض الأسعار' },
  // Sales Orders — أوامر البيع
  { code: 'salesorders.view', group: 'salesorders', nameAr: 'عرض أوامر البيع' },
  { code: 'salesorders.create', group: 'salesorders', nameAr: 'إنشاء وتنفيذ أوامر البيع' },
  { code: 'salesorders.delete', group: 'salesorders', nameAr: 'حذف أوامر البيع' },
  // Sales Returns — مرتجعات المبيعات
  { code: 'salesreturns.view', group: 'salesreturns', nameAr: 'عرض مرتجعات المبيعات' },
  { code: 'salesreturns.create', group: 'salesreturns', nameAr: 'إنشاء مرتجعات المبيعات' },
  { code: 'salesreturns.delete', group: 'salesreturns', nameAr: 'حذف مرتجعات المبيعات' },
  // Purchase Orders — أوامر الشراء
  { code: 'purchaseorders.view', group: 'purchaseorders', nameAr: 'عرض أوامر الشراء' },
  { code: 'purchaseorders.create', group: 'purchaseorders', nameAr: 'إنشاء وتحويل أوامر الشراء' },
  { code: 'purchaseorders.delete', group: 'purchaseorders', nameAr: 'حذف أوامر الشراء' },
  // Purchase Returns — مرتجعات المشتريات
  { code: 'purchasereturns.view', group: 'purchasereturns', nameAr: 'عرض مرتجعات المشتريات' },
  { code: 'purchasereturns.create', group: 'purchasereturns', nameAr: 'إنشاء مرتجعات المشتريات' },
  { code: 'purchasereturns.delete', group: 'purchasereturns', nameAr: 'حذف مرتجعات المشتريات' },
  // Journal — دفتر اليومية
  { code: 'journal.view', group: 'journal', nameAr: 'عرض دفتر اليومية' },
  { code: 'journal.create', group: 'journal', nameAr: 'إنشاء قيود اليومية' },
  // Cost Centers — مراكز التكلفة
  { code: 'costcenters.view', group: 'costcenters', nameAr: 'عرض مراكز التكلفة' },
  { code: 'costcenters.create', group: 'costcenters', nameAr: 'إضافة مركز تكلفة' },
  { code: 'costcenters.edit', group: 'costcenters', nameAr: 'تعديل مركز تكلفة' },
  { code: 'costcenters.delete', group: 'costcenters', nameAr: 'حذف مركز تكلفة' },
  // Budgets — الموازنات التقديرية
  { code: 'budgets.view', group: 'budgets', nameAr: 'عرض الموازنات التقديرية' },
  { code: 'budgets.edit', group: 'budgets', nameAr: 'تعديل الموازنات التقديرية' },
  // Recurring Entries — القيود المتكررة
  { code: 'recurring.view', group: 'recurring', nameAr: 'عرض القيود المتكررة' },
  { code: 'recurring.create', group: 'recurring', nameAr: 'إنشاء وتوليد القيود المتكررة' },
  { code: 'recurring.edit', group: 'recurring', nameAr: 'تعديل القيود المتكررة' },
  { code: 'recurring.delete', group: 'recurring', nameAr: 'حذف القيود المتكررة' },
  // Journal Approvals — اعتماد القيود
  { code: 'approvals.view', group: 'approvals', nameAr: 'عرض طلبات اعتماد القيود' },
  { code: 'approvals.create', group: 'approvals', nameAr: 'تقديم قيد للاعتماد' },
  { code: 'approvals.review', group: 'approvals', nameAr: 'اعتماد أو رفض القيود' },
  // Fiscal Periods — الفترات المحاسبية
  { code: 'fiscalperiods.view', group: 'fiscalperiods', nameAr: 'عرض الفترات المحاسبية' },
  { code: 'fiscalperiods.edit', group: 'fiscalperiods', nameAr: 'إقفال وفتح الفترات المحاسبية' },
  // Promissory Notes — الكمبيالات والشيكات
  { code: 'promissory.view', group: 'promissory', nameAr: 'عرض الكمبيالات والشيكات' },
  { code: 'promissory.create', group: 'promissory', nameAr: 'إنشاء وتحصيل الكمبيالات والشيكات' },
  { code: 'promissory.delete', group: 'promissory', nameAr: 'حذف الكمبيالات والشيكات' },
  // Bank Reconciliation — التسوية البنكية
  { code: 'reconciliation.view', group: 'reconciliation', nameAr: 'عرض التسويات البنكية' },
  { code: 'reconciliation.create', group: 'reconciliation', nameAr: 'إنشاء ومطابقة التسوية البنكية' },
  { code: 'reconciliation.delete', group: 'reconciliation', nameAr: 'حذف التسوية البنكية' },
  // Stock Count — الجرد المخزني
  { code: 'stockcount.view', group: 'stockcount', nameAr: 'عرض الجرد المخزني' },
  { code: 'stockcount.adjust', group: 'stockcount', nameAr: 'تنفيذ وتسوية الجرد المخزني' },
  // Branches — الفروع ومزامنة البيانات
  { code: 'branches.view', group: 'branches', nameAr: 'عرض الفروع ومزامنة البيانات' },
  { code: 'branches.create', group: 'branches', nameAr: 'إضافة فرع' },
  { code: 'branches.edit', group: 'branches', nameAr: 'تعديل الفرع ومزامنة البيانات' },
  { code: 'branches.delete', group: 'branches', nameAr: 'حذف فرع' },
  // Audit Log — سجل التدقيق
  { code: 'audit.view', group: 'audit', nameAr: 'عرض سجل التدقيق' },
];

const allCodes = PERMISSION_DEFS.map(p => p.code);
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
  // Split-out sections (previously covered by the coarse codes above)
  'quotations.view', 'quotations.create', 'quotations.delete',
  'salesorders.view', 'salesorders.create', 'salesorders.delete',
  'salesreturns.view', 'salesreturns.create', 'salesreturns.delete',
  'purchaseorders.view', 'purchaseorders.create',
  'purchasereturns.view', 'purchasereturns.create',
  'journal.view', 'journal.create',
  'costcenters.view', 'costcenters.create', 'costcenters.edit',
  'budgets.view', 'budgets.edit',
  'recurring.view', 'recurring.create', 'recurring.edit',
  'approvals.view', 'approvals.create', 'approvals.review',
  'fiscalperiods.view', 'fiscalperiods.edit',
  'promissory.view', 'promissory.create', 'promissory.delete',
  'reconciliation.view', 'reconciliation.create', 'reconciliation.delete',
  'stockcount.view',
];
const storekeeperCodes = [
  'products.view', 'departments.view', 'brands.view', 'units.view',
  'warehouses.view', 'stock.view', 'stock.adjust', 'stock.transfer',
  'dashboard.view',
  'suppliers.view', 'purchases.view', 'purchases.create',
  'transfers.view', 'transfers.create',
  'manufacturing.view', 'manufacturing.create',
  // Split-out sections (previously covered by the coarse codes above)
  'purchaseorders.view', 'purchaseorders.create',
  'purchasereturns.view', 'purchasereturns.create',
  'stockcount.view', 'stockcount.adjust',
  'branches.view',
];
const cashierCodes = ['products.view', 'stock.view', 'sales.view', 'sales.create', 'customers.view', 'dashboard.view'];

export const ROLE_DEFS = [
  { code: 'ADMIN', nameAr: 'المدير العام', description: 'صلاحيات كاملة على النظام', permCodes: allCodes },
  { code: 'MANAGER', nameAr: 'مدير النظام', description: 'إدارة النظام بدون إدارة المستخدمين', permCodes: managerCodes },
  { code: 'ACCOUNTANT', nameAr: 'المحاسب المالي', description: 'المبيعات والحسابات والتقارير', permCodes: accountantCodes },
  { code: 'STOREKEEPER', nameAr: 'أمين المخزن', description: 'إدارة المخزون والمنتجات', permCodes: storekeeperCodes },
  { code: 'CASHIER', nameAr: 'كاشير', description: 'نقاط البيع والمبيعات فقط', permCodes: cashierCodes },
];

/** Minimal chart of accounts a new company needs for every posting flow to work (no balances). */
export const ACCOUNT_CHART: Array<{ code: string; nameAr: string; type: AccountType }> = [
  { code: '1000', nameAr: 'نقدية', type: AccountType.ASSET },
  { code: '1100', nameAr: 'البنك', type: AccountType.ASSET },
  { code: '1200', nameAr: 'المخزون', type: AccountType.ASSET },
  { code: '1300', nameAr: 'ضريبة الشراء ورسم المدخلات', type: AccountType.ASSET },
  { code: '1400', nameAr: 'الأصول الثابتة', type: AccountType.ASSET },
  { code: '1450', nameAr: 'مجمع الإهلاك', type: AccountType.ASSET },
  { code: '3000', nameAr: 'العملاء / المدينون', type: AccountType.ASSET },
  { code: '2000', nameAr: 'الموردون / الدائنون', type: AccountType.LIABILITY },
  { code: '2100', nameAr: 'ضريبة المبيعات المستحقة', type: AccountType.LIABILITY },
  { code: '2200', nameAr: 'المستحقات للعاملين', type: AccountType.LIABILITY },
  { code: '7000', nameAr: 'رأس المال', type: AccountType.EQUITY },
  { code: '8000', nameAr: 'جاري الشركاء', type: AccountType.EQUITY },
  { code: '7900', nameAr: 'الأرباح المرحلة', type: AccountType.EQUITY },
  { code: '4000', nameAr: 'إيرادات المبيعات', type: AccountType.REVENUE },
  { code: '4100', nameAr: 'الخصم المكتسب', type: AccountType.REVENUE },
  { code: '5000', nameAr: 'تكلفة البضاعة المباعة (COGS)', type: AccountType.EXPENSE },
  { code: '5100', nameAr: 'الخصم المسموح به', type: AccountType.EXPENSE },
  { code: '6000', nameAr: 'مصروفات عمومية وإدارية', type: AccountType.EXPENSE },
  { code: '6100', nameAr: 'مصروف الإهلاك', type: AccountType.EXPENSE },
  { code: '6200', nameAr: 'الرواتب والأجور', type: AccountType.EXPENSE },
];

export const UNIT_DEFS = [
  { nameAr: 'حبة', code: 'PCS' },
  { nameAr: 'لفة', code: 'ROLL' },
  { nameAr: 'متر', code: 'MTR' },
  { nameAr: 'كرتون', code: 'BOX' },
];
