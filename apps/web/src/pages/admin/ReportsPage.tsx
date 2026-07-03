import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, ShoppingCart, Receipt, DollarSign,
  FileText, Users, Package, AlertTriangle, BarChart2, Printer,
  Scale, BookOpen, LineChart, Percent, Layers, Clock, CalendarClock,
  PackageX, RefreshCw,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { PageHeader } from '../../components/ui/PageHeader';
import { Card, CardHeader } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { usePermission } from '../../contexts/AuthContext';
import { useDateRange } from '../../contexts/DateRangeContext';
import { formatMoney, formatDate } from '../../lib/utils';
import apiClient from '../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface PnlData {
  revenue: number;
  cogs: number;
  grossProfit: number;
  expenses: number;
  purchases: number;
  netProfit: number;
  grossMarginPct: number;
}

interface SalesLogData {
  invoices: {
    id: number;
    refNo: string;
    date: string;
    total: number;
    paidStatus: 'PAID' | 'UNPAID' | 'PARTIAL';
    customer: { nameAr: string; company: string | null };
    cashier: { name: string };
    warehouse: { nameAr: string };
  }[];
  summary: { count: number; total: number; subtotal: number; discount: number; tax: number };
}

interface PurchasesLogData {
  invoices: {
    id: number;
    refNo: string;
    date: string;
    total: number;
    paymentStatus: 'PAID' | 'UNPAID' | 'PARTIAL';
    receiveStatus: 'RECEIVED' | 'PENDING';
    supplier: { nameAr: string; company: string | null };
    warehouse: { nameAr: string };
  }[];
  summary: { count: number; total: number; subtotal: number; discount: number; tax: number };
}

interface CustomerBalance {
  id: number;
  nameAr: string;
  company: string | null;
  phone: string | null;
  currentBalance: number;
}

interface SupplierBalance {
  id: number;
  nameAr: string;
  company: string | null;
  phone: string | null;
  currentBalance: number;
}

interface TopProduct {
  productId: number;
  nameAr: string;
  sku: string;
  unit: string;
  qtySold: number;
  totalRevenue: number;
}

interface LowStockItem {
  id: number;
  quantity: number;
  product: {
    id: number;
    nameAr: string;
    sku: string;
    unit: { nameAr: string } | null;
    brand: { nameAr: string } | null;
  };
  warehouse: { id: number; nameAr: string };
}

interface ExpiringProduct {
  id: number;
  nameAr: string;
  sku: string;
  unit: { nameAr: string } | null;
  brand: { nameAr: string } | null;
  expiryDate: string;
  isExpired: boolean;
  totalQty: number;
  balances: { warehouseId: number; warehouseName: string; quantity: number }[];
}

interface DeadStockItem {
  id: number;
  nameAr: string;
  sku: string;
  unit: { nameAr: string } | null;
  brand: { nameAr: string } | null;
  totalQty: number;
  stockValue: number;
  lastSaleDate: string | null;
  daysSinceLastSale: number | null;
  balances: { warehouseId: number; warehouseName: string; quantity: number }[];
}

interface ReorderSuggestion {
  id: number;
  nameAr: string;
  sku: string;
  unit: { nameAr: string } | null;
  brand: { nameAr: string } | null;
  totalQty: number;
  reorderPoint: number;
  suggestedQty: number;
  estimatedCost: number;
}

// ─── Financial Statement Types ─────────────────────────────────────────────────

interface TrialBalanceAccount {
  code: string;
  nameAr: string;
  type: string;
  debit: number;
  credit: number;
  balance: number;
}

interface TrialBalanceData {
  accounts: TrialBalanceAccount[];
  grandTotalDebit: number;
  grandTotalCredit: number;
  balanced: boolean;
}

interface BalanceSheetAccount {
  code: string;
  nameAr: string;
  balance: number;
}

interface BalanceSheetData {
  assets: { accounts: BalanceSheetAccount[]; total: number };
  liabilities: { accounts: BalanceSheetAccount[]; total: number };
  equity: { accounts: BalanceSheetAccount[]; netProfit: number; total: number };
  totalLiabilitiesAndEquity: number;
  balanced: boolean;
}

interface IncomeStatementAccount {
  code: string;
  nameAr: string;
  balance: number;
}

interface IncomeStatementData {
  revenues: IncomeStatementAccount[];
  expenses: IncomeStatementAccount[];
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  revenue?: number;
  cogs?: number;
  grossProfit?: number;
}

interface VatInvoice {
  id: number;
  refNo: string;
  date: string;
  customerName?: string;
  supplierName?: string;
  invoiceRefNo?: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

interface CashFlowLine {
  date: string;
  description: string | null;
  amount: number;
}

interface CashFlowBucket {
  lines: CashFlowLine[];
  total: number;
}

interface CashFlowData {
  period: { from: string | null; to: string | null };
  openingCash: number;
  closingCash: number;
  operating: CashFlowBucket;
  investing: CashFlowBucket;
  financing: CashFlowBucket;
  netChange: number;
}

interface CostCenterRow {
  id: number;
  code: string;
  nameAr: string;
  revenue: number;
  expense: number;
  net: number;
}

interface CostCenterReportData {
  period: { from: string | null; to: string | null };
  centers: CostCenterRow[];
  totalRevenue: number;
  totalExpense: number;
  totalNet: number;
}

interface BudgetVsActualRow {
  accountId: number;
  code: string;
  nameAr: string;
  type: 'REVENUE' | 'EXPENSE';
  budget: number;
  actual: number;
  variance: number;
  variancePct: number;
}

interface BudgetVsActualData {
  year: number;
  month: number | null;
  rows: BudgetVsActualRow[];
  totalBudget: number;
  totalActual: number;
}

interface AgingRow {
  id: number;
  nameAr: string;
  current: number;
  b31_60: number;
  b61_90: number;
  over90: number;
  total: number;
}

interface AgingData {
  asOfDate: string;
  rows: AgingRow[];
  totals: { current: number; b31_60: number; b61_90: number; over90: number; total: number };
}

interface VatData {
  period: { from: string | null; to: string | null };
  sales: {
    taxableCount: number;
    exemptCount: number;
    taxableNet: number;
    exemptNet: number;
    outputVAT: number;
    returnsCount: number;
    returnsNet: number;
    returnsVAT: number;
    invoices: VatInvoice[];
    returns: VatInvoice[];
  };
  purchases: {
    taxableCount: number;
    taxableNet: number;
    inputVAT: number;
    returnsCount: number;
    returnsNet: number;
    returnsVAT: number;
    invoices: VatInvoice[];
    returns: VatInvoice[];
  };
  outputVAT: number;
  inputVAT: number;
  grossOutputVAT: number;
  grossInputVAT: number;
  netVAT: number;
  isPayable: boolean;
}

// ─── Report Sections ─────────────────────────────────────────────────────────
type SectionKey =
  | 'summary'
  | 'sales-log'
  | 'purchases-log'
  | 'pnl'
  | 'customer-balances'
  | 'supplier-balances'
  | 'top-products'
  | 'low-stock'
  | 'dead-stock'
  | 'reorder-suggestions'
  | 'vat'
  | 'trial-balance'
  | 'balance-sheet'
  | 'income-statement'
  | 'cash-flow'
  | 'cost-centers'
  | 'budget-vs-actual'
  | 'ar-aging'
  | 'ap-aging'
  | 'expiring-products';

const sections: { key: SectionKey; label: string; icon: React.ReactNode; group?: string }[] = [
  { key: 'summary', label: 'الملخص والتحليلات العامة', icon: <BarChart2 size={16} /> },
  { key: 'sales-log', label: 'سجل فواتير المبيعات', icon: <FileText size={16} /> },
  { key: 'purchases-log', label: 'سجل فواتير المشتريات', icon: <ShoppingCart size={16} /> },
  { key: 'pnl', label: 'الأرباح والخسائر P&L', icon: <TrendingUp size={16} /> },
  { key: 'customer-balances', label: 'أرصدة العملاء', icon: <Users size={16} /> },
  { key: 'supplier-balances', label: 'أرصدة الموردين', icon: <Receipt size={16} /> },
  { key: 'top-products', label: 'المنتجات الأكثر مبيعاً', icon: <Package size={16} /> },
  { key: 'low-stock', label: 'تنبيهات نواقص المخزون', icon: <AlertTriangle size={16} /> },
  { key: 'reorder-suggestions', label: 'اقتراحات إعادة الطلب', icon: <RefreshCw size={16} /> },
  { key: 'dead-stock', label: 'الأصناف الراكدة', icon: <PackageX size={16} /> },
  { key: 'expiring-products', label: 'أصناف قاربت على انتهاء الصلاحية', icon: <CalendarClock size={16} /> },
  { key: 'vat', label: 'التقرير الضريبي (VAT)', icon: <Percent size={16} />, group: 'الضرائب' },
  { key: 'trial-balance', label: 'ميزان المراجعة', icon: <Scale size={16} />, group: 'القوائم المالية' },
  { key: 'balance-sheet', label: 'الميزانية العمومية', icon: <BookOpen size={16} />, group: 'القوائم المالية' },
  { key: 'income-statement', label: 'قائمة الدخل', icon: <LineChart size={16} />, group: 'القوائم المالية' },
  { key: 'cash-flow', label: 'التدفقات النقدية', icon: <DollarSign size={16} />, group: 'القوائم المالية' },
  { key: 'cost-centers', label: 'مراكز التكلفة', icon: <Layers size={16} />, group: 'القوائم المالية' },
  { key: 'budget-vs-actual', label: 'الموازنة مقابل الفعلي', icon: <Scale size={16} />, group: 'القوائم المالية' },
  { key: 'ar-aging', label: 'تعمير ذمم العملاء', icon: <Clock size={16} />, group: 'الذمم' },
  { key: 'ap-aging', label: 'تعمير ذمم الموردين', icon: <Clock size={16} />, group: 'الذمم' },
];

const DONUT_COLORS = ['#0e9384', '#f97316', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#10b981'];

const paidStatusLabel: Record<string, { label: string; variant: 'success' | 'danger' | 'warning' }> = {
  PAID: { label: 'مدفوعة', variant: 'success' },
  UNPAID: { label: 'غير مسددة', variant: 'danger' },
  PARTIAL: { label: 'جزئي', variant: 'warning' },
};

const receiveStatusLabel: Record<string, { label: string; variant: 'success' | 'warning' }> = {
  RECEIVED: { label: 'مستلمة', variant: 'success' },
  PENDING: { label: 'معلقة', variant: 'warning' },
};

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded-lg ${className}`} />;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  label, value, icon, iconBg,
}: { label: string; value: string; icon: React.ReactNode; iconBg: string }) {
  return (
    <Card padding="md" className="flex items-center gap-4">
      <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-app-muted font-medium mb-1 truncate">{label}</p>
        <p className="text-base font-bold text-app-text leading-tight">{value}</p>
      </div>
    </Card>
  );
}

// ─── Summary Panel ────────────────────────────────────────────────────────────
function SummaryPanel({ pnl, topProducts }: { pnl: PnlData | undefined; topProducts: TopProduct[] | undefined }) {
  const barData = pnl ? [
    { name: 'المبيعات', value: pnl.revenue },
    { name: 'المشتريات', value: pnl.purchases },
    { name: 'المصروفات', value: pnl.expenses },
    { name: 'صافي الربح', value: Math.max(pnl.netProfit, 0) },
  ] : [];

  const donutData = (topProducts ?? []).slice(0, 8).map(p => ({
    name: p.nameAr,
    value: p.totalRevenue,
  }));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Donut – top products */}
      <Card padding="none" className="p-5">
        <CardHeader title="المنتجات الأعلى مبيعاً" subtitle="بالإيرادات الإجمالية" />
        {!topProducts ? (
          <Skeleton className="h-48 w-full" />
        ) : donutData.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-app-muted text-sm">لا توجد بيانات مبيعات</div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={donutData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
                  {donutData.map((_, i) => <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => [formatMoney(v), 'الإيرادات']} contentStyle={{ fontFamily: 'Tajawal, sans-serif', fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-2 gap-1 mt-2">
              {donutData.map((d, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs text-app-muted">
                  <span className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
                  <span className="truncate">{d.name}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      {/* Bar – financial performance */}
      <Card padding="none" className="p-5">
        <CardHeader title="الأداء المالي" subtitle="مقارنة المبيعات والمشتريات والمصروفات والأرباح" />
        {!pnl ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fontFamily: 'Tajawal, sans-serif' }} stroke="#e5e7eb" />
              <YAxis tick={{ fontSize: 10, fontFamily: 'Tajawal, sans-serif' }} stroke="#e5e7eb"
                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)} />
              <Tooltip
                formatter={(v: number) => [formatMoney(v), '']}
                contentStyle={{ fontFamily: 'Tajawal, sans-serif', fontSize: 12, direction: 'rtl' }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {barData.map((_, i) => <Cell key={i} fill={['#0e9384', '#3b82f6', '#ef4444', '#16a34a'][i]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  );
}

// ─── Aging table (shared by AR/AP) ──────────────────────────────────────────────
function AgingTable({ data, isLoading, nameHeader, emptyText }: {
  data: AgingData | undefined;
  isLoading: boolean;
  nameHeader: string;
  emptyText: string;
}) {
  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!data) return <div className="py-8 text-center text-app-muted text-sm">لا توجد بيانات</div>;
  if (data.rows.length === 0) return <div className="py-8 text-center text-app-muted text-sm">{emptyText}</div>;

  return (
    <div dir="rtl">
      <p className="text-xs text-app-muted mb-3">كما في تاريخ: {formatDate(data.asOfDate)}</p>
      <div className="overflow-x-auto rounded-xl border border-app-border">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gray-50 border-b border-app-border text-app-muted">
              <th className="text-right px-3 py-2.5 font-semibold">{nameHeader}</th>
              <th className="text-right px-3 py-2.5 font-semibold w-28">حالي (0-30 يوم)</th>
              <th className="text-right px-3 py-2.5 font-semibold w-28">31-60 يوم</th>
              <th className="text-right px-3 py-2.5 font-semibold w-28">61-90 يوم</th>
              <th className="text-right px-3 py-2.5 font-semibold w-28">أكثر من 90 يوم</th>
              <th className="text-right px-3 py-2.5 font-semibold w-28">الإجمالي</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id} className="border-b border-app-border/60 hover:bg-gray-50">
                <td className="px-3 py-2 font-medium">{r.nameAr}</td>
                <td className="px-3 py-2 font-mono">{r.current > 0 ? formatMoney(r.current) : '—'}</td>
                <td className="px-3 py-2 font-mono text-warning">{r.b31_60 > 0 ? formatMoney(r.b31_60) : '—'}</td>
                <td className="px-3 py-2 font-mono text-warning">{r.b61_90 > 0 ? formatMoney(r.b61_90) : '—'}</td>
                <td className="px-3 py-2 font-mono font-bold text-danger">{r.over90 > 0 ? formatMoney(r.over90) : '—'}</td>
                <td className="px-3 py-2 font-mono font-bold">{formatMoney(r.total)}</td>
              </tr>
            ))}
            <tr className="bg-gray-100 border-t-2 border-app-border font-bold">
              <td className="px-3 py-2.5 text-app-muted">الإجمالي</td>
              <td className="px-3 py-2.5 font-mono">{formatMoney(data.totals.current)}</td>
              <td className="px-3 py-2.5 font-mono text-warning">{formatMoney(data.totals.b31_60)}</td>
              <td className="px-3 py-2.5 font-mono text-warning">{formatMoney(data.totals.b61_90)}</td>
              <td className="px-3 py-2.5 font-mono text-danger">{formatMoney(data.totals.over90)}</td>
              <td className="px-3 py-2.5 font-mono">{formatMoney(data.totals.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export function ReportsPage() {
  const canView = usePermission('reports.view');
  const { from, to } = useDateRange();
  const [activeSection, setActiveSection] = useState<SectionKey>('summary');
  const [budgetYear, setBudgetYear] = useState(new Date().getFullYear());

  // Helper: build date range params object
  const dateParams = (from || to)
    ? Object.fromEntries(
        [from ? ['from', from] : null, to ? ['to', to] : null].filter(Boolean) as [string, string][]
      )
    : {};

  const { data: pnl, isLoading: pnlLoading } = useQuery({
    queryKey: ['reports-pnl', from, to],
    queryFn: async () => (await apiClient.get<PnlData>('/reports/pnl', { params: dateParams })).data,
    enabled: canView,
  });

  const { data: salesLog, isLoading: salesLoading } = useQuery({
    queryKey: ['reports-sales-log', from, to],
    queryFn: async () => (await apiClient.get<SalesLogData>('/reports/sales-log', { params: dateParams })).data,
    enabled: canView && (activeSection === 'sales-log' || activeSection === 'summary'),
  });

  const { data: purchasesLog, isLoading: purchasesLoading } = useQuery({
    queryKey: ['reports-purchases-log', from, to],
    queryFn: async () => (await apiClient.get<PurchasesLogData>('/reports/purchases-log', { params: dateParams })).data,
    enabled: canView && (activeSection === 'purchases-log' || activeSection === 'summary'),
  });

  const { data: customerBalances, isLoading: custLoading } = useQuery({
    queryKey: ['reports-customer-balances'],
    queryFn: async () => (await apiClient.get<{ customers: CustomerBalance[]; totalReceivables: number }>('/reports/customer-balances')).data,
    enabled: canView && activeSection === 'customer-balances',
  });

  const { data: supplierBalances, isLoading: suppLoading } = useQuery({
    queryKey: ['reports-supplier-balances'],
    queryFn: async () => (await apiClient.get<{ suppliers: SupplierBalance[]; totalPayables: number }>('/reports/supplier-balances')).data,
    enabled: canView && activeSection === 'supplier-balances',
  });

  const { data: topProducts, isLoading: topLoading } = useQuery({
    queryKey: ['reports-top-products', from, to],
    queryFn: async () => (await apiClient.get<TopProduct[]>('/reports/top-products', { params: dateParams })).data,
    enabled: canView && (activeSection === 'top-products' || activeSection === 'summary'),
  });

  const { data: lowStock, isLoading: lowLoading } = useQuery({
    queryKey: ['reports-low-stock'],
    queryFn: async () => (await apiClient.get<LowStockItem[]>('/reports/low-stock')).data,
    enabled: canView && activeSection === 'low-stock',
  });

  const { data: expiringProducts, isLoading: expiringLoading } = useQuery({
    queryKey: ['reports-expiring-products'],
    queryFn: async () => (await apiClient.get<ExpiringProduct[]>('/reports/expiring-products', { params: { days: 30 } })).data,
    enabled: canView && activeSection === 'expiring-products',
  });

  const { data: deadStock, isLoading: deadStockLoading } = useQuery({
    queryKey: ['reports-dead-stock'],
    queryFn: async () => (await apiClient.get<{ days: number; rows: DeadStockItem[]; totalStockValue: number }>('/reports/dead-stock', { params: { days: 90 } })).data,
    enabled: canView && activeSection === 'dead-stock',
  });

  const { data: reorderSuggestions, isLoading: reorderLoading } = useQuery({
    queryKey: ['reports-reorder-suggestions'],
    queryFn: async () => (await apiClient.get<{ rows: ReorderSuggestion[]; totalEstimatedCost: number }>('/reports/reorder-suggestions')).data,
    enabled: canView && activeSection === 'reorder-suggestions',
  });

  const { data: vat, isLoading: vatLoading } = useQuery({
    queryKey: ['reports-vat', from, to],
    queryFn: async () => (await apiClient.get<VatData>('/reports/vat', { params: dateParams })).data,
    enabled: canView && activeSection === 'vat',
  });

  const { data: trialBalance, isLoading: tbLoading } = useQuery({
    queryKey: ['reports-trial-balance'],
    queryFn: async () => (await apiClient.get<TrialBalanceData>('/reports/trial-balance')).data,
    enabled: canView && activeSection === 'trial-balance',
  });

  const { data: balanceSheet, isLoading: bsLoading } = useQuery({
    queryKey: ['reports-balance-sheet'],
    queryFn: async () => (await apiClient.get<BalanceSheetData>('/reports/balance-sheet')).data,
    enabled: canView && activeSection === 'balance-sheet',
  });

  const { data: incomeStatement, isLoading: isLoading2 } = useQuery({
    queryKey: ['reports-income-statement', from, to],
    queryFn: async () => (await apiClient.get<IncomeStatementData>('/reports/income-statement', { params: dateParams })).data,
    enabled: canView && activeSection === 'income-statement',
  });

  const { data: cashFlow, isLoading: cfLoading } = useQuery({
    queryKey: ['reports-cash-flow', from, to],
    queryFn: async () => (await apiClient.get<CashFlowData>('/reports/cash-flow', { params: dateParams })).data,
    enabled: canView && activeSection === 'cash-flow',
  });

  const { data: costCenterReport, isLoading: ccLoading } = useQuery({
    queryKey: ['reports-cost-centers', from, to],
    queryFn: async () => (await apiClient.get<CostCenterReportData>('/reports/cost-centers', { params: dateParams })).data,
    enabled: canView && activeSection === 'cost-centers',
  });

  const { data: budgetVsActual, isLoading: bvaLoading } = useQuery({
    queryKey: ['reports-budget-vs-actual', budgetYear],
    queryFn: async () => (await apiClient.get<BudgetVsActualData>('/reports/budget-vs-actual', { params: { year: budgetYear } })).data,
    enabled: canView && activeSection === 'budget-vs-actual',
  });

  const { data: arAging, isLoading: arAgingLoading } = useQuery({
    queryKey: ['reports-ar-aging'],
    queryFn: async () => (await apiClient.get<AgingData>('/reports/ar-aging')).data,
    enabled: canView && activeSection === 'ar-aging',
  });

  const { data: apAging, isLoading: apAgingLoading } = useQuery({
    queryKey: ['reports-ap-aging'],
    queryFn: async () => (await apiClient.get<AgingData>('/reports/ap-aging')).data,
    enabled: canView && activeSection === 'ap-aging',
  });

  if (!canView) {
    return (
      <div>
        <PageHeader title="تقارير النظام" subtitle="لوحة التقارير والتحليلات الشاملة" />
        <Card>
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <AlertTriangle size={40} className="text-warning" />
            <p className="text-warning font-semibold">ليس لديك صلاحية لعرض التقارير</p>
          </div>
        </Card>
      </div>
    );
  }

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-content { page-break-inside: avoid; }
        }
      `}</style>

      <PageHeader
        title="تقارير النظام"
        subtitle="لوحة التقارير والتحليلات الشاملة"
        actions={
          <Button icon={<Printer size={16} />} onClick={handlePrint} variant="outline">
            طباعة التقرير
          </Button>
        }
      />

      {/* KPI Cards */}
      {pnlLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} padding="md"><Skeleton className="h-12 w-full" /></Card>
          ))}
        </div>
      ) : pnl && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard label="إجمالي المبيعات (صافي)" value={formatMoney(pnl.revenue)} icon={<TrendingUp size={20} className="text-primary" />} iconBg="bg-primary-50" />
          <KpiCard label="كلفة المبيعات (COGS)" value={formatMoney(pnl.cogs)} icon={<ShoppingCart size={20} className="text-blue-600" />} iconBg="bg-blue-50" />
          <KpiCard label="إجمالي المصروفات التشغيلية" value={formatMoney(pnl.expenses)} icon={<Receipt size={20} className="text-danger" />} iconBg="bg-danger-bg" />
          <KpiCard label="صافي الأرباح (P&L)" value={formatMoney(pnl.netProfit)} icon={<DollarSign size={20} className={pnl.netProfit >= 0 ? 'text-success' : 'text-danger'} />} iconBg={pnl.netProfit >= 0 ? 'bg-success-bg' : 'bg-danger-bg'} />
        </div>
      )}

      {/* Main layout: sidebar + panel */}
      <div className="flex gap-4 no-print" dir="rtl">
        {/* Left sidebar — report nav */}
        <div className="w-64 flex-shrink-0">
          <Card padding="none" className="p-3">
            <p className="text-xs font-bold text-app-muted uppercase tracking-wide px-3 py-2 mb-1">
              أنواع وأبواب التقارير
            </p>
            <nav className="space-y-0.5">
              {sections.map((s, idx) => {
                const prevGroup = idx > 0 ? sections[idx - 1].group : undefined;
                const showGroupHeader = s.group && s.group !== prevGroup;
                return (
                  <div key={s.key}>
                    {showGroupHeader && (
                      <p className="text-[10px] font-bold text-app-muted uppercase tracking-widest px-3 pt-3 pb-1 border-t border-app-border mt-2">
                        {s.group}
                      </p>
                    )}
                    <button
                      onClick={() => setActiveSection(s.key)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-right ${
                        activeSection === s.key
                          ? 'bg-primary-50 text-primary'
                          : 'text-app-muted hover:bg-gray-50 hover:text-app-text'
                      }`}
                    >
                      <span className="flex-shrink-0">{s.icon}</span>
                      <span>{s.label}</span>
                    </button>
                  </div>
                );
              })}
            </nav>
          </Card>
        </div>

        {/* Report panel */}
        <div className="flex-1 min-w-0 print-content">
          {activeSection === 'summary' && (
            <SummaryPanel pnl={pnl} topProducts={topProducts} />
          )}

          {activeSection === 'sales-log' && (
            <Card padding="none" className="p-5">
              <CardHeader
                title="سجل فواتير المبيعات"
                subtitle={salesLog ? `إجمالي: ${formatMoney(salesLog.summary.total)} — ${salesLog.summary.count} فاتورة` : ''}
              />
              {salesLoading ? <Skeleton className="h-48 w-full" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-app-border bg-gray-50">
                        {['رقم الفاتورة', 'العميل', 'المستودع', 'الكاشير', 'التاريخ', 'الحالة', 'الإجمالي'].map(h => (
                          <th key={h} className="text-right px-3 py-2 font-semibold text-app-muted">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(salesLog?.invoices ?? []).length === 0 ? (
                        <tr><td colSpan={7} className="py-8 text-center text-app-muted">لا توجد فواتير</td></tr>
                      ) : (salesLog?.invoices ?? []).map(inv => {
                        const st = paidStatusLabel[inv.paidStatus] ?? { label: inv.paidStatus, variant: 'default' as const };
                        return (
                          <tr key={inv.id} className="border-b border-app-border/60 hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono font-bold text-primary">{inv.refNo}</td>
                            <td className="px-3 py-2">
                              <div className="font-medium">{inv.customer.nameAr}</div>
                              {inv.customer.company && <div className="text-app-muted">{inv.customer.company}</div>}
                            </td>
                            <td className="px-3 py-2 text-app-muted">{inv.warehouse.nameAr}</td>
                            <td className="px-3 py-2 text-app-muted">{inv.cashier.name}</td>
                            <td className="px-3 py-2 text-app-muted whitespace-nowrap">{formatDate(inv.date)}</td>
                            <td className="px-3 py-2"><Badge variant={st.variant}>{st.label}</Badge></td>
                            <td className="px-3 py-2 font-bold whitespace-nowrap">{formatMoney(inv.total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {activeSection === 'purchases-log' && (
            <Card padding="none" className="p-5">
              <CardHeader
                title="سجل فواتير المشتريات"
                subtitle={purchasesLog ? `إجمالي: ${formatMoney(purchasesLog.summary.total)} — ${purchasesLog.summary.count} فاتورة` : ''}
              />
              {purchasesLoading ? <Skeleton className="h-48 w-full" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-app-border bg-gray-50">
                        {['رقم الفاتورة', 'المورد', 'المستودع', 'التاريخ', 'الاستلام', 'الدفع', 'الإجمالي'].map(h => (
                          <th key={h} className="text-right px-3 py-2 font-semibold text-app-muted">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(purchasesLog?.invoices ?? []).length === 0 ? (
                        <tr><td colSpan={7} className="py-8 text-center text-app-muted">لا توجد فواتير مشتريات</td></tr>
                      ) : (purchasesLog?.invoices ?? []).map(inv => {
                        const rst = receiveStatusLabel[inv.receiveStatus] ?? { label: inv.receiveStatus, variant: 'default' as const };
                        const pst = paidStatusLabel[inv.paymentStatus] ?? { label: inv.paymentStatus, variant: 'default' as const };
                        return (
                          <tr key={inv.id} className="border-b border-app-border/60 hover:bg-gray-50">
                            <td className="px-3 py-2 font-mono font-bold text-primary">{inv.refNo}</td>
                            <td className="px-3 py-2">
                              <div className="font-medium">{inv.supplier.nameAr}</div>
                              {inv.supplier.company && <div className="text-app-muted">{inv.supplier.company}</div>}
                            </td>
                            <td className="px-3 py-2 text-app-muted">{inv.warehouse.nameAr}</td>
                            <td className="px-3 py-2 text-app-muted whitespace-nowrap">{formatDate(inv.date)}</td>
                            <td className="px-3 py-2"><Badge variant={rst.variant}>{rst.label}</Badge></td>
                            <td className="px-3 py-2"><Badge variant={pst.variant}>{pst.label}</Badge></td>
                            <td className="px-3 py-2 font-bold whitespace-nowrap">{formatMoney(inv.total)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {activeSection === 'pnl' && (
            <Card padding="none" className="p-5">
              <CardHeader title="قائمة الأرباح والخسائر" subtitle="P&L Statement" />
              {pnlLoading ? <Skeleton className="h-48 w-full" /> : pnl ? (
                <div className="space-y-3">
                  {[
                    { label: 'إيرادات المبيعات', value: pnl.revenue, color: 'text-success', bold: false },
                    { label: 'تكلفة البضاعة المباعة (COGS)', value: -pnl.cogs, color: 'text-danger', bold: false },
                    { label: 'إجمالي الربح', value: pnl.grossProfit, color: pnl.grossProfit >= 0 ? 'text-success' : 'text-danger', bold: true },
                    { label: 'المصروفات التشغيلية', value: -pnl.expenses, color: 'text-danger', bold: false },
                    { label: 'صافي الربح / الخسارة', value: pnl.netProfit, color: pnl.netProfit >= 0 ? 'text-success' : 'text-danger', bold: true },
                  ].map((row, i) => (
                    <div key={i} className={`flex items-center justify-between py-3 border-b border-app-border ${row.bold ? 'bg-gray-50 px-3 rounded-lg font-bold' : ''}`}>
                      <span className={`text-sm ${row.bold ? 'font-bold text-app-text' : 'text-app-muted'}`}>{row.label}</span>
                      <span className={`text-sm font-bold font-mono ${row.color}`}>{formatMoney(Math.abs(row.value))}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between py-3 bg-primary-50 px-3 rounded-xl">
                    <span className="text-sm font-bold text-primary">هامش الربح الإجمالي</span>
                    <span className="text-sm font-bold text-primary">{pnl.grossMarginPct}%</span>
                  </div>
                </div>
              ) : null}
            </Card>
          )}

          {activeSection === 'customer-balances' && (
            <Card padding="none" className="p-5">
              <CardHeader
                title="أرصدة العملاء"
                subtitle={customerBalances ? `إجمالي المستحقات: ${formatMoney(customerBalances.totalReceivables)}` : ''}
              />
              {custLoading ? <Skeleton className="h-48 w-full" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-app-border bg-gray-50">
                        {['العميل', 'الشركة', 'الهاتف', 'الرصيد الحالي'].map(h => (
                          <th key={h} className="text-right px-3 py-2 font-semibold text-app-muted">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(customerBalances?.customers ?? []).length === 0 ? (
                        <tr><td colSpan={4} className="py-8 text-center text-app-muted">لا توجد أرصدة</td></tr>
                      ) : (customerBalances?.customers ?? []).map(c => (
                        <tr key={c.id} className="border-b border-app-border/60 hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium">{c.nameAr}</td>
                          <td className="px-3 py-2 text-app-muted">{c.company ?? '—'}</td>
                          <td className="px-3 py-2 text-app-muted font-mono">{c.phone ?? '—'}</td>
                          <td className="px-3 py-2 font-bold text-danger">{formatMoney(Number(c.currentBalance))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {activeSection === 'supplier-balances' && (
            <Card padding="none" className="p-5">
              <CardHeader
                title="أرصدة الموردين"
                subtitle={supplierBalances ? `إجمالي الذمم الدائنة: ${formatMoney(supplierBalances.totalPayables)}` : ''}
              />
              {suppLoading ? <Skeleton className="h-48 w-full" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-app-border bg-gray-50">
                        {['المورد', 'الشركة', 'الهاتف', 'الرصيد الحالي'].map(h => (
                          <th key={h} className="text-right px-3 py-2 font-semibold text-app-muted">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(supplierBalances?.suppliers ?? []).length === 0 ? (
                        <tr><td colSpan={4} className="py-8 text-center text-app-muted">لا توجد أرصدة</td></tr>
                      ) : (supplierBalances?.suppliers ?? []).map(s => (
                        <tr key={s.id} className="border-b border-app-border/60 hover:bg-gray-50">
                          <td className="px-3 py-2 font-medium">{s.nameAr}</td>
                          <td className="px-3 py-2 text-app-muted">{s.company ?? '—'}</td>
                          <td className="px-3 py-2 text-app-muted font-mono">{s.phone ?? '—'}</td>
                          <td className="px-3 py-2 font-bold text-danger">{formatMoney(Number(s.currentBalance))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {activeSection === 'top-products' && (
            <Card padding="none" className="p-5">
              <CardHeader title="المنتجات الأكثر مبيعاً" subtitle="ترتيب تنازلي حسب الإيرادات" />
              {topLoading ? <Skeleton className="h-48 w-full" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-app-border bg-gray-50">
                        {['#', 'المنتج', 'SKU', 'الوحدة', 'الكمية المباعة', 'إجمالي الإيرادات'].map(h => (
                          <th key={h} className="text-right px-3 py-2 font-semibold text-app-muted">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(topProducts ?? []).length === 0 ? (
                        <tr><td colSpan={6} className="py-8 text-center text-app-muted">لا توجد بيانات مبيعات</td></tr>
                      ) : (topProducts ?? []).map((p, i) => (
                        <tr key={p.productId} className="border-b border-app-border/60 hover:bg-gray-50">
                          <td className="px-3 py-2 font-bold text-primary">{i + 1}</td>
                          <td className="px-3 py-2 font-medium">{p.nameAr}</td>
                          <td className="px-3 py-2 font-mono text-app-muted">{p.sku}</td>
                          <td className="px-3 py-2 text-app-muted">{p.unit}</td>
                          <td className="px-3 py-2 font-bold">{p.qtySold.toLocaleString('en-US')}</td>
                          <td className="px-3 py-2 font-bold text-success">{formatMoney(p.totalRevenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {activeSection === 'low-stock' && (
            <Card padding="none" className="p-5">
              <CardHeader title="تنبيهات نواقص المخزون" subtitle="الأصناف التي تجاوزت حد التنبيه (أقل من 10 وحدات)" />
              {lowLoading ? <Skeleton className="h-48 w-full" /> : (
                (lowStock ?? []).length === 0 ? (
                  <div className="flex items-center gap-3 py-8 px-4 bg-success-bg rounded-xl">
                    <Package size={28} className="text-success flex-shrink-0" />
                    <div>
                      <p className="font-bold text-success">المخزون آمن بالكامل</p>
                      <p className="text-sm text-success/80 mt-0.5">جميع الأصناف تجاوزت الحد الأدنى المطلوب</p>
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-app-border bg-amber-50">
                          {['الصنف', 'SKU', 'العلامة', 'الوحدة', 'المستودع', 'الرصيد الحالي'].map(h => (
                            <th key={h} className="text-right px-3 py-2 font-semibold text-amber-700">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(lowStock ?? []).map(item => (
                          <tr key={item.id} className="border-b border-app-border/60 hover:bg-amber-50/60">
                            <td className="px-3 py-2 font-medium">{item.product.nameAr}</td>
                            <td className="px-3 py-2 font-mono text-app-muted">{item.product.sku}</td>
                            <td className="px-3 py-2 text-app-muted">{item.product.brand?.nameAr ?? '—'}</td>
                            <td className="px-3 py-2 text-app-muted">{item.product.unit?.nameAr ?? '—'}</td>
                            <td className="px-3 py-2 font-medium">{item.warehouse.nameAr}</td>
                            <td className="px-3 py-2">
                              <span className={`font-bold ${Number(item.quantity) === 0 ? 'text-danger' : 'text-warning'}`}>
                                {Number(item.quantity).toLocaleString('en-US')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </Card>
          )}

          {/* ─── اقتراحات إعادة الطلب ──────────────────────────────────────── */}
          {activeSection === 'reorder-suggestions' && (
            <Card padding="none" className="p-5">
              <CardHeader title="اقتراحات إعادة الطلب" subtitle="الأصناف التي وصل رصيدها إلى حد إعادة الطلب أو أقل" />
              {reorderLoading ? <Skeleton className="h-48 w-full" /> : (
                (reorderSuggestions?.rows ?? []).length === 0 ? (
                  <div className="flex items-center gap-3 py-8 px-4 bg-success-bg rounded-xl">
                    <RefreshCw size={28} className="text-success flex-shrink-0" />
                    <div>
                      <p className="font-bold text-success">لا توجد أصناف بحاجة لإعادة طلب حالياً</p>
                      <p className="text-sm text-success/80 mt-0.5">جميع الأصناف ذات حد إعادة طلب فوق الرصيد الحالي</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mb-3 bg-primary-50 rounded-xl p-3 inline-block">
                      <p className="text-xs text-primary mb-0.5">التكلفة التقديرية الإجمالية لإعادة الطلب</p>
                      <p className="text-lg font-bold text-primary">{formatMoney(reorderSuggestions?.totalEstimatedCost ?? 0)}</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-app-border bg-amber-50">
                            {['الصنف', 'SKU', 'العلامة', 'الوحدة', 'الرصيد الحالي', 'حد إعادة الطلب', 'الكمية المقترحة', 'التكلفة التقديرية'].map(h => (
                              <th key={h} className="text-right px-3 py-2 font-semibold text-amber-700">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(reorderSuggestions?.rows ?? []).map(item => (
                            <tr key={item.id} className="border-b border-app-border/60 hover:bg-amber-50/60">
                              <td className="px-3 py-2 font-medium">{item.nameAr}</td>
                              <td className="px-3 py-2 font-mono text-app-muted">{item.sku}</td>
                              <td className="px-3 py-2 text-app-muted">{item.brand?.nameAr ?? '—'}</td>
                              <td className="px-3 py-2 text-app-muted">{item.unit?.nameAr ?? '—'}</td>
                              <td className="px-3 py-2">
                                <span className={`font-bold ${item.totalQty === 0 ? 'text-danger' : 'text-warning'}`}>
                                  {item.totalQty.toLocaleString('en-US')}
                                </span>
                              </td>
                              <td className="px-3 py-2 font-mono text-app-muted">{item.reorderPoint.toLocaleString('en-US')}</td>
                              <td className="px-3 py-2 font-bold text-primary">{item.suggestedQty.toLocaleString('en-US')}</td>
                              <td className="px-3 py-2 font-mono">{formatMoney(item.estimatedCost)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )
              )}
            </Card>
          )}

          {/* ─── الأصناف الراكدة ────────────────────────────────────────────── */}
          {activeSection === 'dead-stock' && (
            <Card padding="none" className="p-5">
              <CardHeader title="الأصناف الراكدة" subtitle={`أصناف لديها مخزون ولم تُباع خلال آخر ${deadStock?.days ?? 90} يوماً`} />
              {deadStockLoading ? <Skeleton className="h-48 w-full" /> : (
                (deadStock?.rows ?? []).length === 0 ? (
                  <div className="flex items-center gap-3 py-8 px-4 bg-success-bg rounded-xl">
                    <PackageX size={28} className="text-success flex-shrink-0" />
                    <div>
                      <p className="font-bold text-success">لا توجد أصناف راكدة</p>
                      <p className="text-sm text-success/80 mt-0.5">جميع الأصناف تتحرك مبيعاتها بانتظام</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="mb-3 bg-danger-bg rounded-xl p-3 inline-block">
                      <p className="text-xs text-danger mb-0.5">إجمالي قيمة المخزون الراكد</p>
                      <p className="text-lg font-bold text-danger">{formatMoney(deadStock?.totalStockValue ?? 0)}</p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-app-border bg-amber-50">
                            {['الصنف', 'SKU', 'العلامة', 'الوحدة', 'الرصيد الحالي', 'قيمة المخزون', 'آخر بيع', 'عدد الأيام'].map(h => (
                              <th key={h} className="text-right px-3 py-2 font-semibold text-amber-700">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {(deadStock?.rows ?? []).map(item => (
                            <tr key={item.id} className="border-b border-app-border/60 hover:bg-amber-50/60">
                              <td className="px-3 py-2 font-medium">{item.nameAr}</td>
                              <td className="px-3 py-2 font-mono text-app-muted">{item.sku}</td>
                              <td className="px-3 py-2 text-app-muted">{item.brand?.nameAr ?? '—'}</td>
                              <td className="px-3 py-2 text-app-muted">{item.unit?.nameAr ?? '—'}</td>
                              <td className="px-3 py-2 font-mono">{item.totalQty.toLocaleString('en-US')}</td>
                              <td className="px-3 py-2 font-mono">{formatMoney(item.stockValue)}</td>
                              <td className="px-3 py-2 text-app-muted">{item.lastSaleDate ? formatDate(item.lastSaleDate) : 'لم يُبع من قبل'}</td>
                              <td className="px-3 py-2">
                                <Badge variant="danger">{item.daysSinceLastSale != null ? `${item.daysSinceLastSale} يوم` : '—'}</Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )
              )}
            </Card>
          )}

          {/* ─── أصناف قاربت على انتهاء الصلاحية ──────────────────────────── */}
          {activeSection === 'expiring-products' && (
            <Card padding="none" className="p-5">
              <CardHeader title="أصناف قاربت على انتهاء الصلاحية" subtitle="خلال 30 يومًا القادمة أو منتهية فعلاً" />
              {expiringLoading ? <Skeleton className="h-48 w-full" /> : (
                (expiringProducts ?? []).length === 0 ? (
                  <div className="flex items-center gap-3 py-8 px-4 bg-success-bg rounded-xl">
                    <CalendarClock size={28} className="text-success flex-shrink-0" />
                    <div>
                      <p className="font-bold text-success">لا توجد أصناف قاربت على الانتهاء</p>
                      <p className="text-sm text-success/80 mt-0.5">جميع الأصناف ذات الصلاحية بعيدة عن الانتهاء</p>
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-app-border bg-amber-50">
                          {['الصنف', 'SKU', 'العلامة', 'الوحدة', 'تاريخ الانتهاء', 'الكمية المتوفرة', 'الحالة'].map(h => (
                            <th key={h} className="text-right px-3 py-2 font-semibold text-amber-700">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(expiringProducts ?? []).map(item => (
                          <tr key={item.id} className="border-b border-app-border/60 hover:bg-amber-50/60">
                            <td className="px-3 py-2 font-medium">{item.nameAr}</td>
                            <td className="px-3 py-2 font-mono text-app-muted">{item.sku}</td>
                            <td className="px-3 py-2 text-app-muted">{item.brand?.nameAr ?? '—'}</td>
                            <td className="px-3 py-2 text-app-muted">{item.unit?.nameAr ?? '—'}</td>
                            <td className="px-3 py-2 font-medium">{formatDate(item.expiryDate)}</td>
                            <td className="px-3 py-2 font-mono">{item.totalQty.toLocaleString('en-US')}</td>
                            <td className="px-3 py-2">
                              <Badge variant={item.isExpired ? 'danger' : 'warning'}>
                                {item.isExpired ? 'منتهي' : 'قارب على الانتهاء'}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}
            </Card>
          )}

          {/* ─── التقرير الضريبي (VAT) ────────────────────────────────────── */}
          {activeSection === 'vat' && (
            <Card padding="none" className="p-5">
              <CardHeader title="التقرير الضريبي (ضريبة القيمة المضافة)" subtitle="ملخص ضريبة المبيعات والمشتريات والصافي المستحق خلال الفترة" />
              {vatLoading ? (
                <Skeleton className="h-48 w-full" />
              ) : !vat ? (
                <div className="py-8 text-center text-app-muted text-sm">لا توجد بيانات</div>
              ) : (
                <div dir="rtl" className="space-y-6">
                  {/* Summary KPI cards */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-success-bg rounded-xl p-3">
                      <p className="text-xs text-success mb-0.5">ضريبة المبيعات (المخرجات)</p>
                      <p className="text-lg font-bold text-success">{formatMoney(vat.outputVAT)}</p>
                    </div>
                    <div className="bg-primary-50 rounded-xl p-3">
                      <p className="text-xs text-primary mb-0.5">ضريبة المشتريات (المدخلات)</p>
                      <p className="text-lg font-bold text-primary">{formatMoney(vat.inputVAT)}</p>
                    </div>
                    <div className={`rounded-xl p-3 ${vat.isPayable ? 'bg-danger-bg' : 'bg-warning-bg'}`}>
                      <p className={`text-xs mb-0.5 ${vat.isPayable ? 'text-danger' : 'text-warning'}`}>
                        {vat.isPayable ? 'صافي الضريبة المستحقة' : 'صافي الضريبة المستردة'}
                      </p>
                      <p className={`text-lg font-bold ${vat.isPayable ? 'text-danger' : 'text-warning'}`}>
                        {formatMoney(Math.abs(vat.netVAT))}
                      </p>
                    </div>
                    <div className="bg-gray-100 rounded-xl p-3">
                      <p className="text-xs text-app-muted mb-0.5">عدد الفواتير الخاضعة</p>
                      <p className="text-lg font-bold text-app-text">{vat.sales.taxableCount + vat.purchases.taxableCount}</p>
                    </div>
                  </div>

                  {/* Net-of-returns clarification — the top figures already deduct returns */}
                  {(vat.sales.returnsVAT > 0 || vat.purchases.returnsVAT > 0) && (
                    <div className="bg-warning-bg/40 border border-warning/30 rounded-xl p-3 text-xs text-app-text grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <div>
                        ضريبة المخرجات = إجمالي {formatMoney(vat.grossOutputVAT)} − مردودات مبيعات{' '}
                        <span className="font-semibold text-danger">{formatMoney(vat.sales.returnsVAT)}</span> = صافي{' '}
                        <span className="font-semibold text-success">{formatMoney(vat.outputVAT)}</span>
                      </div>
                      <div>
                        ضريبة المدخلات = إجمالي {formatMoney(vat.grossInputVAT)} − مردودات مشتريات{' '}
                        <span className="font-semibold text-danger">{formatMoney(vat.purchases.returnsVAT)}</span> = صافي{' '}
                        <span className="font-semibold text-primary">{formatMoney(vat.inputVAT)}</span>
                      </div>
                    </div>
                  )}

                  {/* Sales invoices */}
                  <div>
                    <h4 className="text-sm font-bold text-app-text mb-2">فواتير المبيعات الخاضعة للضريبة</h4>
                    <div className="overflow-x-auto rounded-xl border border-app-border">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">رقم الفاتورة</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">التاريخ</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">العميل</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-app-muted">صافي القيمة</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-app-muted">الضريبة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vat.sales.invoices.length === 0 ? (
                            <tr><td colSpan={5} className="px-3 py-6 text-center text-app-muted">لا توجد فواتير مبيعات خاضعة</td></tr>
                          ) : (
                            vat.sales.invoices.map((inv) => (
                              <tr key={inv.id} className="border-t border-app-border">
                                <td className="px-3 py-2 font-mono text-xs">{inv.refNo}</td>
                                <td className="px-3 py-2 text-app-muted">{formatDate(inv.date)}</td>
                                <td className="px-3 py-2">{inv.customerName ?? '—'}</td>
                                <td className="px-3 py-2 text-left font-mono">{formatMoney(inv.subtotal - inv.discount)}</td>
                                <td className="px-3 py-2 text-left font-mono text-success font-semibold">{formatMoney(inv.tax)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Sales returns (credit notes) */}
                  {vat.sales.returns.length > 0 && (
                    <div>
                      <h4 className="text-sm font-bold text-danger mb-2">مردودات المبيعات (إشعارات دائن)</h4>
                      <div className="overflow-x-auto rounded-xl border border-app-border">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">رقم المرتجع</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">الفاتورة الأصلية</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">التاريخ</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">العميل</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-app-muted">صافي القيمة</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-app-muted">الضريبة</th>
                            </tr>
                          </thead>
                          <tbody>
                            {vat.sales.returns.map((r) => (
                              <tr key={r.id} className="border-t border-app-border">
                                <td className="px-3 py-2 font-mono text-xs">{r.refNo}</td>
                                <td className="px-3 py-2 font-mono text-xs text-app-muted">{r.invoiceRefNo ?? '—'}</td>
                                <td className="px-3 py-2 text-app-muted">{formatDate(r.date)}</td>
                                <td className="px-3 py-2">{r.customerName ?? '—'}</td>
                                <td className="px-3 py-2 text-left font-mono">− {formatMoney(r.subtotal - r.discount)}</td>
                                <td className="px-3 py-2 text-left font-mono text-danger font-semibold">− {formatMoney(r.tax)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Purchase invoices */}
                  <div>
                    <h4 className="text-sm font-bold text-app-text mb-2">فواتير المشتريات الخاضعة للضريبة</h4>
                    <div className="overflow-x-auto rounded-xl border border-app-border">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">رقم الفاتورة</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">التاريخ</th>
                            <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">المورد</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-app-muted">صافي القيمة</th>
                            <th className="px-3 py-2 text-left text-xs font-semibold text-app-muted">الضريبة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {vat.purchases.invoices.length === 0 ? (
                            <tr><td colSpan={5} className="px-3 py-6 text-center text-app-muted">لا توجد فواتير مشتريات خاضعة</td></tr>
                          ) : (
                            vat.purchases.invoices.map((inv) => (
                              <tr key={inv.id} className="border-t border-app-border">
                                <td className="px-3 py-2 font-mono text-xs">{inv.refNo}</td>
                                <td className="px-3 py-2 text-app-muted">{formatDate(inv.date)}</td>
                                <td className="px-3 py-2">{inv.supplierName ?? '—'}</td>
                                <td className="px-3 py-2 text-left font-mono">{formatMoney(inv.subtotal - inv.discount)}</td>
                                <td className="px-3 py-2 text-left font-mono text-primary font-semibold">{formatMoney(inv.tax)}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Purchase returns (debit notes) */}
                  {vat.purchases.returns.length > 0 && (
                    <div>
                      <h4 className="text-sm font-bold text-danger mb-2">مردودات المشتريات (إشعارات مدين)</h4>
                      <div className="overflow-x-auto rounded-xl border border-app-border">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50">
                            <tr>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">رقم المرتجع</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">الفاتورة الأصلية</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">التاريخ</th>
                              <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">المورد</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-app-muted">صافي القيمة</th>
                              <th className="px-3 py-2 text-left text-xs font-semibold text-app-muted">الضريبة</th>
                            </tr>
                          </thead>
                          <tbody>
                            {vat.purchases.returns.map((r) => (
                              <tr key={r.id} className="border-t border-app-border">
                                <td className="px-3 py-2 font-mono text-xs">{r.refNo}</td>
                                <td className="px-3 py-2 font-mono text-xs text-app-muted">{r.invoiceRefNo ?? '—'}</td>
                                <td className="px-3 py-2 text-app-muted">{formatDate(r.date)}</td>
                                <td className="px-3 py-2">{r.supplierName ?? '—'}</td>
                                <td className="px-3 py-2 text-left font-mono">− {formatMoney(r.subtotal - r.discount)}</td>
                                <td className="px-3 py-2 text-left font-mono text-danger font-semibold">− {formatMoney(r.tax)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}

          {/* ─── ميزان المراجعة ───────────────────────────────────────────── */}
          {activeSection === 'trial-balance' && (
            <Card padding="none" className="p-5">
              <CardHeader title="ميزان المراجعة" subtitle="مجاميع الحسابات مدين ودائن لإثبات التوازن" />
              {tbLoading ? <Skeleton className="h-48 w-full" /> : !trialBalance ? (
                <div className="py-8 text-center text-app-muted text-sm">لا توجد بيانات</div>
              ) : (
                <div dir="rtl">
                  {/* Balanced badge */}
                  <div className={`mb-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold ${
                    trialBalance.balanced ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
                  }`}>
                    {trialBalance.balanced ? 'متوازن ✓' : 'غير متوازن ✗'}
                    <span className="font-normal text-xs">
                      — مجموع المدين: {formatMoney(Number(trialBalance.grandTotalDebit))} / مجموع الدائن: {formatMoney(Number(trialBalance.grandTotalCredit))}
                    </span>
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-app-border">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-app-border text-app-muted">
                          <th className="text-right px-4 py-2.5 font-semibold">الرمز</th>
                          <th className="text-right px-4 py-2.5 font-semibold">اسم الحساب</th>
                          <th className="text-right px-4 py-2.5 font-semibold w-36">مدين</th>
                          <th className="text-right px-4 py-2.5 font-semibold w-36">دائن</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(trialBalance.accounts ?? []).map((acc) => (
                          <tr key={acc.code} className="border-b border-app-border/60 hover:bg-gray-50">
                            <td className="px-4 py-2 font-mono text-app-muted">{acc.code}</td>
                            <td className="px-4 py-2 font-medium">{acc.nameAr}</td>
                            <td className="px-4 py-2 font-mono text-primary">
                              {Number(acc.debit) > 0 ? formatMoney(Number(acc.debit)) : '—'}
                            </td>
                            <td className="px-4 py-2 font-mono text-success">
                              {Number(acc.credit) > 0 ? formatMoney(Number(acc.credit)) : '—'}
                            </td>
                          </tr>
                        ))}
                        {/* Totals row */}
                        <tr className="bg-gray-100 border-t-2 border-app-border font-bold">
                          <td className="px-4 py-2.5 text-app-muted" colSpan={2}>الإجمالي</td>
                          <td className="px-4 py-2.5 font-mono text-primary">{formatMoney(Number(trialBalance.grandTotalDebit))}</td>
                          <td className="px-4 py-2.5 font-mono text-success">{formatMoney(Number(trialBalance.grandTotalCredit))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* ─── الميزانية العمومية ───────────────────────────────────────── */}
          {activeSection === 'balance-sheet' && (
            <Card padding="none" className="p-5">
              <CardHeader title="الميزانية العمومية" subtitle="قائمة المركز المالي — الأصول مقابل الخصوم وحقوق الملكية" />
              {bsLoading ? <Skeleton className="h-48 w-full" /> : !balanceSheet ? (
                <div className="py-8 text-center text-app-muted text-sm">لا توجد بيانات</div>
              ) : (
                <div dir="rtl">
                  {/* Balanced badge */}
                  <div className={`mb-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold ${
                    balanceSheet.balanced ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
                  }`}>
                    {balanceSheet.balanced ? 'الميزانية متوازنة ✓' : 'الميزانية غير متوازنة ✗'}
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Assets column */}
                    <div className="rounded-xl border border-app-border overflow-hidden">
                      <div className="bg-primary-50 px-4 py-3 border-b border-app-border">
                        <h3 className="font-bold text-primary text-sm">الأصول</h3>
                      </div>
                      <table className="w-full text-xs">
                        <tbody>
                          {(balanceSheet.assets.accounts ?? []).map((acc) => (
                            <tr key={acc.code} className="border-b border-app-border/60 hover:bg-gray-50">
                              <td className="px-4 py-2">
                                <span className="font-mono text-app-muted ml-2">{acc.code}</span>
                                <span>{acc.nameAr}</span>
                              </td>
                              <td className="px-4 py-2 font-mono font-bold text-left" dir="ltr">
                                {formatMoney(Number(acc.balance))}
                              </td>
                            </tr>
                          ))}
                          <tr className="bg-primary-50 border-t-2 border-primary/30 font-bold">
                            <td className="px-4 py-2.5 text-primary">إجمالي الأصول</td>
                            <td className="px-4 py-2.5 font-mono text-primary text-left" dir="ltr">
                              {formatMoney(Number(balanceSheet.assets.total))}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>

                    {/* Liabilities + Equity column */}
                    <div className="rounded-xl border border-app-border overflow-hidden">
                      <div className="bg-danger-bg px-4 py-3 border-b border-app-border">
                        <h3 className="font-bold text-danger text-sm">الخصوم وحقوق الملكية</h3>
                      </div>
                      <table className="w-full text-xs">
                        <tbody>
                          {/* Liabilities */}
                          {(balanceSheet.liabilities.accounts ?? []).length > 0 && (
                            <>
                              <tr className="bg-gray-50">
                                <td colSpan={2} className="px-4 py-1.5 text-[10px] font-bold text-app-muted uppercase tracking-wide">الخصوم</td>
                              </tr>
                              {balanceSheet.liabilities.accounts.map((acc) => (
                                <tr key={acc.code} className="border-b border-app-border/60 hover:bg-gray-50">
                                  <td className="px-4 py-2">
                                    <span className="font-mono text-app-muted ml-2">{acc.code}</span>
                                    <span>{acc.nameAr}</span>
                                  </td>
                                  <td className="px-4 py-2 font-mono font-bold text-left" dir="ltr">
                                    {formatMoney(Number(acc.balance))}
                                  </td>
                                </tr>
                              ))}
                              <tr className="border-b border-app-border bg-danger-bg/50">
                                <td className="px-4 py-2 text-danger font-semibold">إجمالي الخصوم</td>
                                <td className="px-4 py-2 font-mono font-bold text-danger text-left" dir="ltr">
                                  {formatMoney(Number(balanceSheet.liabilities.total))}
                                </td>
                              </tr>
                            </>
                          )}
                          {/* Equity */}
                          {(balanceSheet.equity.accounts ?? []).length > 0 && (
                            <>
                              <tr className="bg-gray-50">
                                <td colSpan={2} className="px-4 py-1.5 text-[10px] font-bold text-app-muted uppercase tracking-wide">حقوق الملكية</td>
                              </tr>
                              {balanceSheet.equity.accounts.map((acc) => (
                                <tr key={acc.code} className="border-b border-app-border/60 hover:bg-gray-50">
                                  <td className="px-4 py-2">
                                    <span className="font-mono text-app-muted ml-2">{acc.code}</span>
                                    <span>{acc.nameAr}</span>
                                  </td>
                                  <td className="px-4 py-2 font-mono font-bold text-left" dir="ltr">
                                    {formatMoney(Number(acc.balance))}
                                  </td>
                                </tr>
                              ))}
                              {/* Net profit in equity */}
                              <tr className="border-b border-app-border/60 hover:bg-gray-50">
                                <td className="px-4 py-2 text-app-muted italic">صافي الربح (الخسارة)</td>
                                <td className={`px-4 py-2 font-mono font-bold text-left ${Number(balanceSheet.equity.netProfit) >= 0 ? 'text-success' : 'text-danger'}`} dir="ltr">
                                  {formatMoney(Number(balanceSheet.equity.netProfit))}
                                </td>
                              </tr>
                              <tr className="border-b border-app-border bg-purple-50">
                                <td className="px-4 py-2 text-purple-700 font-semibold">إجمالي حقوق الملكية</td>
                                <td className="px-4 py-2 font-mono font-bold text-purple-700 text-left" dir="ltr">
                                  {formatMoney(Number(balanceSheet.equity.total))}
                                </td>
                              </tr>
                            </>
                          )}
                          {/* Total liabilities+equity */}
                          <tr className="bg-danger-bg border-t-2 border-danger/30 font-bold">
                            <td className="px-4 py-2.5 text-danger">إجمالي الخصوم وحقوق الملكية</td>
                            <td className="px-4 py-2.5 font-mono text-danger text-left" dir="ltr">
                              {formatMoney(Number(balanceSheet.totalLiabilitiesAndEquity))}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* ─── قائمة الدخل ─────────────────────────────────────────────── */}
          {activeSection === 'income-statement' && (
            <Card padding="none" className="p-5">
              <CardHeader title="قائمة الدخل" subtitle="الإيرادات والمصروفات وصافي الربح أو الخسارة" />
              {isLoading2 ? <Skeleton className="h-48 w-full" /> : !incomeStatement ? (
                <div className="py-8 text-center text-app-muted text-sm">لا توجد بيانات</div>
              ) : (
                <div dir="rtl" className="space-y-4">
                  {/* Revenues section */}
                  <div className="rounded-xl border border-app-border overflow-hidden">
                    <div className="bg-success-bg px-4 py-3 border-b border-app-border flex items-center justify-between">
                      <h3 className="font-bold text-success text-sm">الإيرادات</h3>
                      <span className="font-mono font-bold text-success text-sm">{formatMoney(Number(incomeStatement.totalRevenue))}</span>
                    </div>
                    <table className="w-full text-xs">
                      <tbody>
                        {(incomeStatement.revenues ?? []).length === 0 ? (
                          <tr><td className="px-4 py-3 text-app-muted text-center">لا توجد إيرادات</td></tr>
                        ) : (incomeStatement.revenues ?? []).map((acc) => (
                          <tr key={acc.code} className="border-b border-app-border/60 hover:bg-gray-50">
                            <td className="px-4 py-2">
                              <span className="font-mono text-app-muted ml-2">{acc.code}</span>
                              <span>{acc.nameAr}</span>
                            </td>
                            <td className="px-4 py-2 font-mono font-bold text-success text-left" dir="ltr">
                              {formatMoney(Number(acc.balance))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Expenses section */}
                  <div className="rounded-xl border border-app-border overflow-hidden">
                    <div className="bg-danger-bg px-4 py-3 border-b border-app-border flex items-center justify-between">
                      <h3 className="font-bold text-danger text-sm">المصروفات (شاملاً تكلفة البضاعة)</h3>
                      <span className="font-mono font-bold text-danger text-sm">{formatMoney(Number(incomeStatement.totalExpenses))}</span>
                    </div>
                    <table className="w-full text-xs">
                      <tbody>
                        {(incomeStatement.expenses ?? []).length === 0 ? (
                          <tr><td className="px-4 py-3 text-app-muted text-center">لا توجد مصروفات</td></tr>
                        ) : (incomeStatement.expenses ?? []).map((acc) => (
                          <tr key={acc.code} className="border-b border-app-border/60 hover:bg-gray-50">
                            <td className="px-4 py-2">
                              <span className="font-mono text-app-muted ml-2">{acc.code}</span>
                              <span>{acc.nameAr}</span>
                            </td>
                            <td className="px-4 py-2 font-mono font-bold text-danger text-left" dir="ltr">
                              {formatMoney(Number(acc.balance))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Net profit */}
                  <div className={`rounded-xl px-5 py-4 flex items-center justify-between ${
                    Number(incomeStatement.netProfit) >= 0 ? 'bg-success-bg' : 'bg-danger-bg'
                  }`}>
                    <span className={`font-bold text-base ${Number(incomeStatement.netProfit) >= 0 ? 'text-success' : 'text-danger'}`}>
                      {Number(incomeStatement.netProfit) >= 0 ? 'صافي الربح' : 'صافي الخسارة'}
                    </span>
                    <span className={`font-mono font-bold text-lg ${Number(incomeStatement.netProfit) >= 0 ? 'text-success' : 'text-danger'}`}>
                      {formatMoney(Math.abs(Number(incomeStatement.netProfit)))}
                    </span>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* ─── التدفقات النقدية ────────────────────────────────────────── */}
          {activeSection === 'cash-flow' && (
            <Card padding="none" className="p-5">
              <CardHeader title="قائمة التدفقات النقدية" subtitle="حركة النقدية والبنك حسب نوع النشاط — تشغيلي / استثماري / تمويلي" />
              {cfLoading ? <Skeleton className="h-48 w-full" /> : !cashFlow ? (
                <div className="py-8 text-center text-app-muted text-sm">لا توجد بيانات</div>
              ) : (
                <div dir="rtl" className="space-y-4">
                  {/* Opening / closing summary */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-gray-100 rounded-xl p-3">
                      <p className="text-xs text-app-muted mb-0.5">النقدية أول الفترة</p>
                      <p className="text-lg font-bold text-app-text">{formatMoney(cashFlow.openingCash)}</p>
                    </div>
                    <div className={`rounded-xl p-3 ${cashFlow.netChange >= 0 ? 'bg-success-bg' : 'bg-danger-bg'}`}>
                      <p className={`text-xs mb-0.5 ${cashFlow.netChange >= 0 ? 'text-success' : 'text-danger'}`}>صافي التغير في النقدية</p>
                      <p className={`text-lg font-bold ${cashFlow.netChange >= 0 ? 'text-success' : 'text-danger'}`}>{formatMoney(cashFlow.netChange)}</p>
                    </div>
                    <div className="bg-primary-50 rounded-xl p-3 col-span-2 sm:col-span-2">
                      <p className="text-xs text-primary mb-0.5">النقدية آخر الفترة</p>
                      <p className="text-lg font-bold text-primary">{formatMoney(cashFlow.closingCash)}</p>
                    </div>
                  </div>

                  {/* Three activity buckets */}
                  {[
                    { key: 'operating', title: 'الأنشطة التشغيلية', bucket: cashFlow.operating, color: 'success' as const },
                    { key: 'investing', title: 'الأنشطة الاستثمارية', bucket: cashFlow.investing, color: 'primary' as const },
                    { key: 'financing', title: 'الأنشطة التمويلية', bucket: cashFlow.financing, color: 'purple' as const },
                  ].map(({ key, title, bucket, color }) => (
                    <div key={key} className="rounded-xl border border-app-border overflow-hidden">
                      <div className={`px-4 py-3 border-b border-app-border flex items-center justify-between ${
                        color === 'success' ? 'bg-success-bg' : color === 'primary' ? 'bg-primary-50' : 'bg-purple-50'
                      }`}>
                        <h3 className={`font-bold text-sm ${
                          color === 'success' ? 'text-success' : color === 'primary' ? 'text-primary' : 'text-purple-700'
                        }`}>{title}</h3>
                        <span className={`font-mono font-bold text-sm ${
                          color === 'success' ? 'text-success' : color === 'primary' ? 'text-primary' : 'text-purple-700'
                        }`}>{formatMoney(bucket.total)}</span>
                      </div>
                      <table className="w-full text-xs">
                        <tbody>
                          {bucket.lines.length === 0 ? (
                            <tr><td className="px-4 py-3 text-app-muted text-center">لا توجد حركات</td></tr>
                          ) : bucket.lines.map((line, i) => (
                            <tr key={i} className="border-b border-app-border/60 hover:bg-gray-50">
                              <td className="px-4 py-2 text-app-muted whitespace-nowrap">{formatDate(line.date)}</td>
                              <td className="px-4 py-2">{line.description ?? '—'}</td>
                              <td className={`px-4 py-2 font-mono font-bold text-left whitespace-nowrap ${line.amount >= 0 ? 'text-success' : 'text-danger'}`} dir="ltr">
                                {formatMoney(line.amount)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* ─── مراكز التكلفة ───────────────────────────────────────────── */}
          {activeSection === 'cost-centers' && (
            <Card padding="none" className="p-5">
              <CardHeader title="ربحية مراكز التكلفة" subtitle="الإيرادات والمصروفات المرحّلة على كل مركز تكلفة عبر القيود اليومية" />
              {ccLoading ? <Skeleton className="h-48 w-full" /> : !costCenterReport ? (
                <div className="py-8 text-center text-app-muted text-sm">لا توجد بيانات</div>
              ) : costCenterReport.centers.length === 0 ? (
                <div className="py-8 text-center text-app-muted text-sm">لا توجد مراكز تكلفة معرّفة بعد</div>
              ) : (
                <div dir="rtl" className="overflow-x-auto rounded-xl border border-app-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-app-border text-app-muted">
                        <th className="text-right px-4 py-2.5 font-semibold">الرمز</th>
                        <th className="text-right px-4 py-2.5 font-semibold">المركز</th>
                        <th className="text-right px-4 py-2.5 font-semibold w-32">الإيرادات</th>
                        <th className="text-right px-4 py-2.5 font-semibold w-32">المصروفات</th>
                        <th className="text-right px-4 py-2.5 font-semibold w-32">الصافي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {costCenterReport.centers.map((c) => (
                        <tr key={c.id} className="border-b border-app-border/60 hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono text-app-muted">{c.code}</td>
                          <td className="px-4 py-2 font-medium">{c.nameAr}</td>
                          <td className="px-4 py-2 font-mono text-success">{formatMoney(c.revenue)}</td>
                          <td className="px-4 py-2 font-mono text-danger">{formatMoney(c.expense)}</td>
                          <td className={`px-4 py-2 font-mono font-bold ${c.net >= 0 ? 'text-success' : 'text-danger'}`}>{formatMoney(c.net)}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-100 border-t-2 border-app-border font-bold">
                        <td className="px-4 py-2.5 text-app-muted" colSpan={2}>الإجمالي</td>
                        <td className="px-4 py-2.5 font-mono text-success">{formatMoney(costCenterReport.totalRevenue)}</td>
                        <td className="px-4 py-2.5 font-mono text-danger">{formatMoney(costCenterReport.totalExpense)}</td>
                        <td className={`px-4 py-2.5 font-mono ${costCenterReport.totalNet >= 0 ? 'text-success' : 'text-danger'}`}>{formatMoney(costCenterReport.totalNet)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {/* ─── الموازنة مقابل الفعلي ───────────────────────────────────── */}
          {activeSection === 'budget-vs-actual' && (
            <Card padding="none" className="p-5">
              <CardHeader
                title="الموازنة التقديرية مقابل الفعلي"
                subtitle="مقارنة الأرصدة الفعلية بالموازنة المحددة لكل حساب خلال السنة"
                action={
                  <select
                    value={budgetYear}
                    onChange={(e) => setBudgetYear(parseInt(e.target.value))}
                    className="text-sm border border-app-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                }
              />
              {bvaLoading ? <Skeleton className="h-48 w-full" /> : !budgetVsActual ? (
                <div className="py-8 text-center text-app-muted text-sm">لا توجد بيانات</div>
              ) : budgetVsActual.rows.length === 0 ? (
                <div className="py-8 text-center text-app-muted text-sm">لا توجد موازنات محددة لهذه السنة — أضفها من صفحة «الموازنات التقديرية»</div>
              ) : (
                <div dir="rtl" className="overflow-x-auto rounded-xl border border-app-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-app-border text-app-muted">
                        <th className="text-right px-4 py-2.5 font-semibold">الحساب</th>
                        <th className="text-right px-4 py-2.5 font-semibold w-32">الموازنة</th>
                        <th className="text-right px-4 py-2.5 font-semibold w-32">الفعلي</th>
                        <th className="text-right px-4 py-2.5 font-semibold w-32">الانحراف</th>
                        <th className="text-right px-4 py-2.5 font-semibold w-24">الانحراف٪</th>
                      </tr>
                    </thead>
                    <tbody>
                      {budgetVsActual.rows.map((r) => {
                        // For revenue, actual < budget is unfavorable; for expense, actual > budget is unfavorable.
                        const unfavorable = r.type === 'REVENUE' ? r.variance < 0 : r.variance > 0;
                        return (
                          <tr key={r.accountId} className="border-b border-app-border/60 hover:bg-gray-50">
                            <td className="px-4 py-2">
                              <span className="font-mono text-app-muted ml-2">{r.code}</span>
                              <span className="font-medium">{r.nameAr}</span>
                            </td>
                            <td className="px-4 py-2 font-mono">{formatMoney(r.budget)}</td>
                            <td className="px-4 py-2 font-mono font-bold">{formatMoney(r.actual)}</td>
                            <td className={`px-4 py-2 font-mono font-bold ${unfavorable ? 'text-danger' : 'text-success'}`}>
                              {formatMoney(r.variance)}
                            </td>
                            <td className={`px-4 py-2 font-mono ${unfavorable ? 'text-danger' : 'text-success'}`}>
                              {r.variancePct.toFixed(1)}٪
                            </td>
                          </tr>
                        );
                      })}
                      <tr className="bg-gray-100 border-t-2 border-app-border font-bold">
                        <td className="px-4 py-2.5 text-app-muted">الإجمالي</td>
                        <td className="px-4 py-2.5 font-mono">{formatMoney(budgetVsActual.totalBudget)}</td>
                        <td className="px-4 py-2.5 font-mono">{formatMoney(budgetVsActual.totalActual)}</td>
                        <td className="px-4 py-2.5 font-mono" colSpan={2}>
                          {formatMoney(budgetVsActual.totalActual - budgetVsActual.totalBudget)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {/* ─── تعمير ذمم العملاء ───────────────────────────────────────── */}
          {activeSection === 'ar-aging' && (
            <Card padding="none" className="p-5">
              <CardHeader title="تعمير ذمم العملاء" subtitle="تصنيف المستحق على كل عميل حسب عمر الفاتورة" />
              <AgingTable
                data={arAging}
                isLoading={arAgingLoading}
                nameHeader="العميل"
                emptyText="لا توجد مستحقات على العملاء حالياً"
              />
            </Card>
          )}

          {/* ─── تعمير ذمم الموردين ──────────────────────────────────────── */}
          {activeSection === 'ap-aging' && (
            <Card padding="none" className="p-5">
              <CardHeader title="تعمير ذمم الموردين" subtitle="تصنيف المستحق لكل مورد حسب عمر الفاتورة" />
              <AgingTable
                data={apAging}
                isLoading={apAgingLoading}
                nameHeader="المورد"
                emptyText="لا توجد مستحقات للموردين حالياً"
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
