import { useQuery } from '@tanstack/react-query';
import {
  TrendingUp, ShoppingCart, Receipt, DollarSign,
  Wallet, Package, Archive, AlertTriangle, CheckCircle,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import { PageHeader } from '../components/ui/PageHeader';
import { Card, CardHeader } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { formatMoney, formatDate } from '../lib/utils';
import apiClient from '../lib/api';
import { useDateRange } from '../contexts/DateRangeContext';
import { useBranch } from '../contexts/BranchContext';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ChartPoint {
  month: number;
  monthName: string;
  sales: number;
  purchases: number;
}

interface RecentMovement {
  id: number;
  createdAt: string;
  type: 'IN' | 'OUT' | 'TRANSFER' | 'ADJUST';
  quantity: number;
  balanceAfter: number;
  reason: string | null;
  refType: string | null;
  product: { nameAr: string; sku: string };
  warehouse: { nameAr: string };
  createdBy: { name: string };
}

interface RecentInvoice {
  id: number;
  refNo: string;
  date: string;
  total: number;
  paidStatus: 'PAID' | 'UNPAID' | 'PARTIAL';
  customer: { nameAr: string; company: string | null };
  cashier: { name: string };
}

interface LowStockProduct {
  id: number;
  nameAr: string;
  sku: string;
  unit: { nameAr: string } | null;
  brand: { nameAr: string } | null;
  stockBalances: { quantity: number; warehouse: { nameAr: string } }[];
}

interface DashboardData {
  kpis: {
    netSales: number;
    purchases: number;
    expenses: number;
    netProfit: number;
    cashLiquidity: number;
    inventoryValuation: number;
    totalItemQty: number;
    lowStockCount: number;
    totalReceivables: number;
  };
  chartSeries: ChartPoint[];
  recentMovements: RecentMovement[];
  recentInvoices: RecentInvoice[];
  lowStockList: LowStockProduct[];
}

// ─── Fetch ─────────────────────────────────────────────────────────────────────
const fetchDashboard = async (from: string | null, to: string | null, branchId: number | null): Promise<DashboardData> => {
  const params: Record<string, string | number> = {};
  if (from) params.from = from;
  if (to) params.to = to;
  if (branchId != null) params.branchId = branchId;
  const res = await apiClient.get<DashboardData>('/dashboard', { params });
  return res.data;
};

// ─── KPI card config ───────────────────────────────────────────────────────────
type KpiConfig = {
  label: string;
  valueKey: keyof DashboardData['kpis'];
  isMoney?: boolean;
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  subLabel?: string;
  subLabelColor?: string;
};

// ─── Movement type label ───────────────────────────────────────────────────────
const movementTypeLabel: Record<string, { label: string; color: string }> = {
  IN: { label: 'وارد', color: 'text-success' },
  OUT: { label: 'صادر', color: 'text-danger' },
  TRANSFER: { label: 'تحويل', color: 'text-primary' },
  ADJUST: { label: 'تسوية', color: 'text-warning' },
};

const paidStatusLabel: Record<string, { label: string; variant: 'success' | 'danger' | 'warning' | 'info' | 'default' }> = {
  PAID: { label: 'مدفوعة', variant: 'success' },
  UNPAID: { label: 'غير مسددة', variant: 'danger' },
  PARTIAL: { label: 'جزئي', variant: 'warning' },
};

// ─── Skeleton ──────────────────────────────────────────────────────────────────
function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded-lg ${className}`} />;
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  isMoney = false,
  icon,
  iconBg,
  subLabel,
  subLabelColor = 'text-app-muted',
}: {
  label: string;
  value: number;
  isMoney?: boolean;
  icon: React.ReactNode;
  iconBg: string;
  subLabel?: string;
  subLabelColor?: string;
}) {
  return (
    <Card padding="md" className="flex items-center gap-4">
      <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${iconBg}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-app-muted font-medium mb-1 truncate">{label}</p>
        <p className="text-lg font-bold text-app-text leading-tight">
          {isMoney ? formatMoney(value) : value.toLocaleString('en-US')}
        </p>
        {subLabel && (
          <p className={`text-xs font-medium mt-0.5 ${subLabelColor}`}>{subLabel}</p>
        )}
      </div>
    </Card>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────
export function DashboardPage() {
  const { from, to } = useDateRange();
  const { branchId } = useBranch();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard', from, to, branchId],
    queryFn: () => fetchDashboard(from, to, branchId),
    refetchInterval: 60_000,
  });

  // ── partner donut (static placeholder — Phase 2 will wire real equity data)
  const partnerData = [
    { name: 'الشريك الأول', value: 60 },
    { name: 'الشريك الثاني', value: 40 },
  ];
  const PARTNER_COLORS = ['#0e9384', '#f97316'];

  if (isError) {
    return (
      <div>
        <PageHeader
          title="لوحة القيادة والمؤشرات التحليلية"
          subtitle="نظرة عامة شاملة على أداء النظام"
        />
        <Card>
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <AlertTriangle size={40} className="text-danger" />
            <p className="text-danger font-semibold">تعذّر تحميل بيانات لوحة القيادة</p>
            <p className="text-app-muted text-sm">تأكد من تشغيل الخادم الخلفي وصحة الاتصال</p>
          </div>
        </Card>
      </div>
    );
  }

  const kpis = data?.kpis;

  return (
    <div className="space-y-6">
      {/* ── Page Header ──────────────────────────────────────────────────── */}
      <PageHeader
        title="لوحة القيادة والمؤشرات التحليلية"
        subtitle="نظرة عامة شاملة على أداء النظام والمخزون والمبيعات"
      />

      {/* ── KPI Cards ────────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} padding="md">
              <Skeleton className="h-10 w-10 rounded-full mb-3" />
              <Skeleton className="h-3 w-20 mb-2" />
              <Skeleton className="h-5 w-28" />
            </Card>
          ))}
        </div>
      ) : kpis ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard
            label="صافي المبيعات"
            value={kpis.netSales}
            isMoney
            icon={<TrendingUp size={22} className="text-primary" />}
            iconBg="bg-primary-50"
            subLabel="إجمالي إيرادات المبيعات"
            subLabelColor="text-primary"
          />
          <KpiCard
            label="توريدات المشتريات"
            value={kpis.purchases}
            isMoney
            icon={<ShoppingCart size={22} className="text-blue-600" />}
            iconBg="bg-blue-50"
            subLabel="إجمالي المشتريات (المرحلة القادمة)"
            subLabelColor="text-blue-600"
          />
          <KpiCard
            label="المصروفات التشغيلية"
            value={kpis.expenses}
            isMoney
            icon={<Receipt size={22} className="text-danger" />}
            iconBg="bg-danger-bg"
            subLabel="مصروفات المرحلة القادمة"
            subLabelColor="text-danger"
          />
          <KpiCard
            label="صافي الأرباح المقدرة"
            value={kpis.netProfit}
            isMoney
            icon={<DollarSign size={22} className="text-success" />}
            iconBg="bg-success-bg"
            subLabel="تقدير ٪25 من المبيعات"
            subLabelColor="text-success"
          />
          <KpiCard
            label="السيولة النقدية الحالية"
            value={kpis.cashLiquidity}
            isMoney
            icon={<Wallet size={22} className="text-primary" />}
            iconBg="bg-primary-50"
            subLabel={`مستحقات: ${formatMoney(kpis.totalReceivables)}`}
            subLabelColor="text-primary"
          />
          <KpiCard
            label="تقييم البضاعة والمخزون"
            value={kpis.inventoryValuation}
            isMoney
            icon={<Archive size={22} className="text-amber-600" />}
            iconBg="bg-amber-50"
            subLabel="بالتكلفة الفعلية للأصناف"
            subLabelColor="text-amber-600"
          />
          <KpiCard
            label="إجمالي كميات السلع"
            value={kpis.totalItemQty}
            icon={<Package size={22} className="text-purple-600" />}
            iconBg="bg-purple-50"
            subLabel="عدد الوحدات الكلية في المخازن"
            subLabelColor="text-purple-600"
          />
          {/* Low stock card with dynamic coloring */}
          <Card padding="md" className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0 ${kpis.lowStockCount === 0 ? 'bg-success-bg' : 'bg-warning-bg'}`}>
              {kpis.lowStockCount === 0
                ? <CheckCircle size={22} className="text-success" />
                : <AlertTriangle size={22} className="text-warning" />
              }
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-app-muted font-medium mb-1">حالة المخزون</p>
              <p className="text-lg font-bold text-app-text leading-tight">
                {kpis.lowStockCount === 0 ? 'آمن' : kpis.lowStockCount.toLocaleString('en-US')}
              </p>
              <p className={`text-xs font-medium mt-0.5 ${kpis.lowStockCount === 0 ? 'text-success' : 'text-warning'}`}>
                {kpis.lowStockCount === 0
                  ? 'جميع الأصناف بمستوى آمن'
                  : `${kpis.lowStockCount} صنف أوشك على النفاد`
                }
              </p>
            </div>
          </Card>
        </div>
      ) : null}

      {/* ── Charts Row ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Area Chart – monthly sales vs purchases */}
        <Card padding="none" className="lg:col-span-2 p-5">
          <CardHeader
            title="منحنى المبيعات والمشتريات الشهرية"
            subtitle="مقارنة الإيرادات والتوريدات خلال العام الحالي"
          />
          {isLoading ? (
            <Skeleton className="h-56 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart
                data={data?.chartSeries ?? []}
                margin={{ top: 5, right: 10, left: 10, bottom: 5 }}
              >
                <defs>
                  <linearGradient id="gradSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0e9384" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#0e9384" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gradPurchases" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="monthName"
                  tick={{ fontSize: 11, fontFamily: 'Tajawal, sans-serif' }}
                  stroke="#e5e7eb"
                />
                <YAxis
                  tick={{ fontSize: 10, fontFamily: 'Tajawal, sans-serif' }}
                  stroke="#e5e7eb"
                  tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    formatMoney(value),
                    name === 'sales' ? 'صافي المبيعات' : 'التوريدات والمشتريات',
                  ]}
                  labelFormatter={(label: string) => `شهر: ${label}`}
                  contentStyle={{ fontFamily: 'Tajawal, sans-serif', fontSize: 12, direction: 'rtl' }}
                />
                <Legend
                  formatter={(value: string) => value === 'sales' ? 'صافي المبيعات' : 'التوريدات والمشتريات'}
                  wrapperStyle={{ fontFamily: 'Tajawal, sans-serif', fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="sales"
                  stroke="#0e9384"
                  strokeWidth={2.5}
                  fill="url(#gradSales)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
                <Area
                  type="monotone"
                  dataKey="purchases"
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  fill="url(#gradPurchases)"
                  dot={false}
                  activeDot={{ r: 4 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        {/* Donut – partner capital shares */}
        <Card padding="none" className="p-5 flex flex-col">
          <CardHeader
            title="توزيع حصص رأس مال الشركاء"
            subtitle="توزيع الملكية (بيانات توضيحية)"
          />
          <div className="flex-1 flex flex-col items-center justify-center">
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={partnerData}
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={78}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {partnerData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={PARTNER_COLORS[index]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) => [`${value}%`, 'الحصة']}
                  contentStyle={{ fontFamily: 'Tajawal, sans-serif', fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-2">
              {partnerData.map((p, i) => (
                <div key={p.name} className="flex items-center gap-1.5 text-xs text-app-muted">
                  <span
                    className="inline-block w-3 h-3 rounded-full"
                    style={{ background: PARTNER_COLORS[i] }}
                  />
                  <span>{p.name}</span>
                  <span className="font-bold text-app-text">{p.value}%</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-app-muted mt-2 text-center">
              بيانات الشركاء تفصيلياً في المرحلة القادمة
            </p>
          </div>
        </Card>
      </div>

      {/* ── Tables Row ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent Stock Movements */}
        <Card padding="none" className="p-5">
          <CardHeader
            title="سجل الحركات المخزنية والتدقيق الأخير"
            subtitle="آخر 10 حركات على المخزون"
          />
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-app-border bg-gray-50">
                    <th className="text-right px-3 py-2 font-semibold text-app-muted">التاريخ</th>
                    <th className="text-right px-3 py-2 font-semibold text-app-muted">المستودع</th>
                    <th className="text-right px-3 py-2 font-semibold text-app-muted">الصنف</th>
                    <th className="text-right px-3 py-2 font-semibold text-app-muted">الكمية</th>
                    <th className="text-right px-3 py-2 font-semibold text-app-muted">الرصيد</th>
                    <th className="text-right px-3 py-2 font-semibold text-app-muted">النوع</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.recentMovements ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-app-muted">
                        لا توجد حركات مخزنية بعد
                      </td>
                    </tr>
                  ) : (
                    (data?.recentMovements ?? []).map((mv) => {
                      const typeInfo = movementTypeLabel[mv.type] ?? { label: mv.type, color: 'text-app-muted' };
                      const isPositive = mv.type === 'IN' || (mv.type === 'ADJUST' && mv.quantity > 0);
                      return (
                        <tr key={mv.id} className="border-b border-app-border/60 hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-2 text-app-muted whitespace-nowrap">
                            {formatDate(mv.createdAt)}
                          </td>
                          <td className="px-3 py-2 font-medium text-app-text">{mv.warehouse.nameAr}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-app-text">{mv.product.nameAr}</div>
                            <div className="text-app-muted">{mv.product.sku}</div>
                          </td>
                          <td className={`px-3 py-2 font-bold ${isPositive ? 'text-success' : 'text-danger'}`}>
                            {isPositive ? '+' : '−'}{Math.abs(mv.quantity).toLocaleString('en-US')}
                          </td>
                          <td className="px-3 py-2 font-mono text-app-text">
                            {Number(mv.balanceAfter).toLocaleString('en-US')}
                          </td>
                          <td className={`px-3 py-2 font-medium ${typeInfo.color}`}>
                            {typeInfo.label}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Recent Sales Invoices */}
        <Card padding="none" className="p-5">
          <CardHeader
            title="آخر فواتير المبيعات الصادرة"
            subtitle="آخر 10 فواتير مبيعات"
          />
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-app-border bg-gray-50">
                    <th className="text-right px-3 py-2 font-semibold text-app-muted">رقم الفاتورة</th>
                    <th className="text-right px-3 py-2 font-semibold text-app-muted">العميل</th>
                    <th className="text-right px-3 py-2 font-semibold text-app-muted">التاريخ</th>
                    <th className="text-right px-3 py-2 font-semibold text-app-muted">الحالة</th>
                    <th className="text-right px-3 py-2 font-semibold text-app-muted">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.recentInvoices ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-app-muted">
                        لا توجد فواتير بعد
                      </td>
                    </tr>
                  ) : (
                    (data?.recentInvoices ?? []).map((inv) => {
                      const statusInfo = paidStatusLabel[inv.paidStatus] ?? { label: inv.paidStatus, variant: 'default' as const };
                      return (
                        <tr key={inv.id} className="border-b border-app-border/60 hover:bg-gray-50 transition-colors">
                          <td className="px-3 py-2 font-mono font-bold text-primary">{inv.refNo}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium text-app-text">{inv.customer.nameAr}</div>
                            {inv.customer.company && (
                              <div className="text-app-muted">{inv.customer.company}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-app-muted whitespace-nowrap">
                            {formatDate(inv.date)}
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                          </td>
                          <td className="px-3 py-2 font-bold text-app-text whitespace-nowrap">
                            {formatMoney(inv.total)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* ── Low-Stock Alert Panel ─────────────────────────────────────────── */}
      <Card padding="none" className="p-5">
        <CardHeader
          title="سلع أوشكت على النفاد"
          subtitle="الأصناف التي تجاوزت حد التنبيه (أقل من 10 وحدات في أي مستودع)"
        />
        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : kpis?.lowStockCount === 0 ? (
          <div className="flex items-center gap-3 py-6 px-4 bg-success-bg rounded-xl">
            <CheckCircle size={28} className="text-success flex-shrink-0" />
            <div>
              <p className="font-bold text-success">المخزون آمن بالكامل</p>
              <p className="text-sm text-success/80 mt-0.5">
                جميع الأصناف تجاوزت الحد الأدنى المطلوب — لا تنبيهات في الوقت الحالي
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-app-border bg-amber-50">
                  <th className="text-right px-3 py-2 font-semibold text-amber-700">الصنف</th>
                  <th className="text-right px-3 py-2 font-semibold text-amber-700">العلامة التجارية</th>
                  <th className="text-right px-3 py-2 font-semibold text-amber-700">الوحدة</th>
                  <th className="text-right px-3 py-2 font-semibold text-amber-700">المستودع</th>
                  <th className="text-right px-3 py-2 font-semibold text-amber-700">الرصيد الحالي</th>
                  <th className="text-right px-3 py-2 font-semibold text-amber-700">حد التنبيه</th>
                </tr>
              </thead>
              <tbody>
                {(data?.lowStockList ?? []).map((product) =>
                  product.stockBalances
                    .filter((sb) => Number(sb.quantity) < 10)
                    .map((sb, sbIdx) => (
                      <tr
                        key={`${product.id}-${sbIdx}`}
                        className="border-b border-warning-bg/80 hover:bg-amber-50/60 transition-colors"
                      >
                        <td className="px-3 py-2">
                          <div className="font-bold text-app-text">{product.nameAr}</div>
                          <div className="text-app-muted">{product.sku}</div>
                        </td>
                        <td className="px-3 py-2 text-app-muted">
                          {product.brand?.nameAr ?? '—'}
                        </td>
                        <td className="px-3 py-2 text-app-muted">
                          {product.unit?.nameAr ?? '—'}
                        </td>
                        <td className="px-3 py-2 font-medium text-app-text">
                          {sb.warehouse.nameAr}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`font-bold ${Number(sb.quantity) === 0 ? 'text-danger' : 'text-warning'}`}>
                            {Number(sb.quantity).toLocaleString('en-US')}
                          </span>
                          &nbsp;
                          <span className="text-app-muted">{product.unit?.nameAr ?? ''}</span>
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="warning">أقل من 10</Badge>
                        </td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
