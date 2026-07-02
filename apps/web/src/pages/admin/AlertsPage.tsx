import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  AlertTriangle, Bell, CheckCircle, Package, FileText, ShoppingCart, Filter, UserX, ShieldCheck, CalendarClock, MessageCircle,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { formatDate, formatMoney, getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// ─── Types ─────────────────────────────────────────────────────────────────────
interface LowStockItem {
  id: number;
  quantity: number;
  product: { id: number; nameAr: string; sku: string; unit: { nameAr: string } | null };
  warehouse: { id: number; nameAr: string };
}

interface SalesInvoice {
  id: number;
  refNo: string;
  date: string;
  total: number;
  paidStatus: 'PAID' | 'UNPAID' | 'PARTIAL';
  customer: { nameAr: string };
}

interface PurchaseInvoice {
  id: number;
  refNo: string;
  date: string;
  total: number;
  receiveStatus: 'RECEIVED' | 'PENDING';
  paymentStatus: 'PAID' | 'UNPAID' | 'PARTIAL';
  supplier: { nameAr: string };
}

interface PaginatedSales {
  data: SalesInvoice[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
}

interface PaginatedPurchases {
  data: PurchaseInvoice[];
  pagination: { total: number; page: number; pageSize: number; totalPages: number };
}

interface Customer {
  id: number;
  nameAr: string;
  creditLimit: number;
  currentBalance: number;
}

interface PaginatedCustomers {
  data: Customer[];
}

interface JournalApproval {
  id: number;
  description: string;
  date: string;
  createdById: number;
  lines: { debit: number; credit: number }[];
}

interface PaginatedApprovals {
  data: JournalApproval[];
}

interface ExpiringProduct {
  id: number;
  nameAr: string;
  sku: string;
  expiryDate: string;
  isExpired: boolean;
  totalQty: number;
}

// ─── Alert types ──────────────────────────────────────────────────────────────
type AlertType = 'low-stock' | 'unpaid-sale' | 'pending-purchase' | 'over-credit-limit' | 'pending-approval' | 'expiring-product';

interface AlertItem {
  id: string;
  type: AlertType;
  severity: 'danger' | 'warning' | 'info';
  title: string;
  message: string;
  date: string;
  meta?: string;
}

type FilterType = 'all' | AlertType;

const filterLabels: Record<FilterType, string> = {
  all: 'الكل',
  'low-stock': 'نقص المخزون',
  'unpaid-sale': 'فواتير غير مسددة',
  'pending-purchase': 'توريدات معلقة',
  'over-credit-limit': 'تجاوز حد الائتمان',
  'pending-approval': 'قيود تحتاج اعتماد',
  'expiring-product': 'قرب/انتهاء الصلاحية',
};

const typeIcons: Record<AlertType, React.ReactNode> = {
  'low-stock': <Package size={18} />,
  'unpaid-sale': <FileText size={18} />,
  'pending-purchase': <ShoppingCart size={18} />,
  'over-credit-limit': <UserX size={18} />,
  'pending-approval': <ShieldCheck size={18} />,
  'expiring-product': <CalendarClock size={18} />,
};

const severityConfig: Record<'danger' | 'warning' | 'info', { bg: string; iconColor: string; borderColor: string }> = {
  danger: { bg: 'bg-red-50', iconColor: 'text-danger', borderColor: 'border-red-200' },
  warning: { bg: 'bg-amber-50', iconColor: 'text-warning', borderColor: 'border-amber-200' },
  info: { bg: 'bg-blue-50', iconColor: 'text-blue-600', borderColor: 'border-blue-200' },
};

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 rounded-lg ${className}`} />;
}

// ─── Main Component ────────────────────────────────────────────────────────────
export function AlertsPage() {
  const [filter, setFilter] = useState<FilterType>('all');

  const { data: lowStock, isLoading: lowLoading } = useQuery({
    queryKey: ['alerts-low-stock'],
    queryFn: async () => (await apiClient.get<LowStockItem[]>('/reports/low-stock')).data,
  });

  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ['alerts-sales-invoices'],
    queryFn: async () =>
      (await apiClient.get<PaginatedSales>('/sales-invoices', { params: { page: 1, pageSize: 200 } })).data,
  });

  const { data: purchasesData, isLoading: purchasesLoading } = useQuery({
    queryKey: ['alerts-purchase-invoices'],
    queryFn: async () =>
      (await apiClient.get<PaginatedPurchases>('/purchase-invoices', { params: { page: 1, pageSize: 200 } })).data,
  });

  const { data: customersData, isLoading: customersLoading } = useQuery({
    queryKey: ['customers', 'alerts'],
    queryFn: async () =>
      (await apiClient.get<PaginatedCustomers>('/customers', { params: { page: 1, pageSize: 500 } })).data,
  });

  const { data: approvalsData, isLoading: approvalsLoading } = useQuery({
    queryKey: ['journal-approvals', 'alerts'],
    queryFn: async () =>
      (await apiClient.get<PaginatedApprovals>('/journal-approvals', { params: { status: 'PENDING', page: 1, pageSize: 200 } })).data,
  });

  const { data: expiringProducts, isLoading: expiringLoading } = useQuery({
    queryKey: ['reports-expiring-products', 'alerts'],
    queryFn: async () => (await apiClient.get<ExpiringProduct[]>('/reports/expiring-products', { params: { days: 30 } })).data,
  });

  const isLoading = lowLoading || salesLoading || purchasesLoading || customersLoading || approvalsLoading || expiringLoading;

  // ─── Build alerts list ────────────────────────────────────────────────────
  const alerts: AlertItem[] = [];

  // Low stock
  (lowStock ?? []).forEach(item => {
    const qty = Number(item.quantity);
    alerts.push({
      id: `low-stock-${item.id}`,
      type: 'low-stock',
      severity: qty === 0 ? 'danger' : 'warning',
      title: `نقص مخزون: ${item.product.nameAr}`,
      message: `الرصيد الحالي ${qty.toLocaleString('en-US')} ${item.product.unit?.nameAr ?? ''} في مستودع ${item.warehouse.nameAr}`,
      date: new Date().toISOString(),
      meta: item.product.sku,
    });
  });

  // Unpaid sales invoices
  (salesData?.data ?? [])
    .filter(inv => inv.paidStatus === 'UNPAID' || inv.paidStatus === 'PARTIAL')
    .forEach(inv => {
      alerts.push({
        id: `unpaid-sale-${inv.id}`,
        type: 'unpaid-sale',
        severity: inv.paidStatus === 'UNPAID' ? 'danger' : 'warning',
        title: `فاتورة ${inv.paidStatus === 'UNPAID' ? 'غير مسددة' : 'مسددة جزئياً'}: ${inv.refNo}`,
        message: `العميل: ${inv.customer.nameAr} — الإجمالي: ${formatMoney(Number(inv.total))}`,
        date: inv.date,
        meta: inv.refNo,
      });
    });

  // Pending purchase receipts
  (purchasesData?.data ?? [])
    .filter(inv => inv.receiveStatus === 'PENDING')
    .forEach(inv => {
      alerts.push({
        id: `pending-purchase-${inv.id}`,
        type: 'pending-purchase',
        severity: 'info',
        title: `أمر شراء معلق: ${inv.refNo}`,
        message: `المورد: ${inv.supplier.nameAr} — الإجمالي: ${formatMoney(Number(inv.total))}`,
        date: inv.date,
        meta: inv.refNo,
      });
    });

  // Customers over their credit limit
  (customersData?.data ?? [])
    .filter((c) => Number(c.creditLimit) > 0 && Number(c.currentBalance) > Number(c.creditLimit))
    .forEach((c) => {
      const over = Number(c.currentBalance) - Number(c.creditLimit);
      alerts.push({
        id: `over-credit-limit-${c.id}`,
        type: 'over-credit-limit',
        severity: 'danger',
        title: `تجاوز الحد الائتماني: ${c.nameAr}`,
        message: `الرصيد الحالي ${formatMoney(Number(c.currentBalance))} يتجاوز الحد المسموح ${formatMoney(Number(c.creditLimit))} بمقدار ${formatMoney(over)}`,
        date: new Date().toISOString(),
      });
    });

  // Manual journal entries pending approval (maker-checker)
  (approvalsData?.data ?? []).forEach((a) => {
    const amount = a.lines.reduce((s, l) => s + Number(l.debit), 0);
    alerts.push({
      id: `pending-approval-${a.id}`,
      type: 'pending-approval',
      severity: 'warning',
      title: `قيد يحتاج اعتماد: ${a.description}`,
      message: `القيمة: ${formatMoney(amount)}`,
      date: a.date,
    });
  });

  // Products expired or expiring soon
  (expiringProducts ?? []).forEach((p) => {
    alerts.push({
      id: `expiring-product-${p.id}`,
      type: 'expiring-product',
      severity: p.isExpired ? 'danger' : 'warning',
      title: `${p.isExpired ? 'منتهي الصلاحية' : 'قارب على الانتهاء'}: ${p.nameAr}`,
      message: `تاريخ الانتهاء ${formatDate(p.expiryDate)} — الكمية المتوفرة: ${p.totalQty.toLocaleString('en-US')}`,
      date: p.expiryDate,
      meta: p.sku,
    });
  });

  // Sort: danger first, then warning, then info; within each group by date desc
  alerts.sort((a, b) => {
    const severityOrder = { danger: 0, warning: 1, info: 2 };
    if (severityOrder[a.severity] !== severityOrder[b.severity]) {
      return severityOrder[a.severity] - severityOrder[b.severity];
    }
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  });

  const filtered = filter === 'all' ? alerts : alerts.filter(a => a.type === filter);

  // ─── Summary counts ──────────────────────────────────────────────────────
  const dangerCount = alerts.filter(a => a.severity === 'danger').length;
  const warningCount = alerts.filter(a => a.severity === 'warning').length;
  const infoCount = alerts.filter(a => a.severity === 'info').length;

  const sendAlertMutation = useMutation({
    mutationFn: () => apiClient.post<{ message?: string }>('/notifications/low-stock-alert'),
    onSuccess: (res) => toast(res.data.message ?? 'تم إرسال تنبيه نواقص المخزون ✓'),
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر إرسال التنبيه'), 'error'),
  });

  return (
    <div>
      <PageHeader
        title="سجل التنبيهات"
        subtitle="تنبيهات النظام المستمدة من بيانات المخزون والفواتير"
        actions={
          <Button
            variant="outline"
            icon={<MessageCircle size={16} />}
            loading={sendAlertMutation.isPending}
            onClick={() => sendAlertMutation.mutate()}
          >
            إرسال تنبيه نواقص المخزون
          </Button>
        }
      />

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-red-200 shadow-sm p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-danger-bg flex items-center justify-center flex-shrink-0">
            <AlertTriangle size={22} className="text-danger" />
          </div>
          <div>
            <p className="text-xs text-app-muted mb-1">تنبيهات حرجة</p>
            <p className="text-2xl font-bold text-danger">{dangerCount}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-amber-200 shadow-sm p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-warning-bg flex items-center justify-center flex-shrink-0">
            <Bell size={22} className="text-warning" />
          </div>
          <div>
            <p className="text-xs text-app-muted mb-1">تحذيرات</p>
            <p className="text-2xl font-bold text-warning">{warningCount}</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0">
            <CheckCircle size={22} className="text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-app-muted mb-1">معلومات</p>
            <p className="text-2xl font-bold text-blue-600">{infoCount}</p>
          </div>
        </div>
      </div>

      {/* Filter tabs */}
      <Card padding="none" className="p-5">
        <div className="flex items-center gap-3 mb-5 flex-wrap">
          <Filter size={16} className="text-app-muted flex-shrink-0" />
          {(Object.keys(filterLabels) as FilterType[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === f
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-app-muted hover:bg-gray-200 hover:text-app-text'
              }`}
            >
              {filterLabels[f]}
              {f !== 'all' && (
                <span className={`mr-1.5 text-xs px-1.5 py-0.5 rounded-full ${filter === f ? 'bg-white/20 text-white' : 'bg-gray-200 text-app-muted'}`}>
                  {alerts.filter(a => a.type === f).length}
                </span>
              )}
            </button>
          ))}
          <span className="mr-auto text-xs text-app-muted">{filtered.length} تنبيه</span>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-16 h-16 rounded-full bg-success-bg flex items-center justify-center">
              <CheckCircle size={32} className="text-success" />
            </div>
            <p className="font-bold text-success text-lg">لا توجد تنبيهات</p>
            <p className="text-app-muted text-sm text-center">
              جميع الأصناف بمستوى آمن وجميع الفواتير في حالة جيدة
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(alert => {
              const cfg = severityConfig[alert.severity];
              return (
                <div
                  key={alert.id}
                  className={`flex items-start gap-3 p-4 rounded-xl border ${cfg.bg} ${cfg.borderColor}`}
                >
                  {/* Icon */}
                  <div className={`flex-shrink-0 mt-0.5 ${cfg.iconColor}`}>
                    {typeIcons[alert.type]}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-app-text">{alert.title}</span>
                      <Badge
                        variant={alert.severity === 'info' ? 'info' : alert.severity}
                      >
                        {alert.severity === 'danger' ? 'حرج' : alert.severity === 'warning' ? 'تحذير' : 'معلومة'}
                      </Badge>
                      {alert.meta && (
                        <span className="text-xs font-mono text-app-muted">{alert.meta}</span>
                      )}
                    </div>
                    <p className="text-xs text-app-muted mt-1">{alert.message}</p>
                  </div>

                  {/* Date */}
                  <div className="flex-shrink-0 text-xs text-app-muted whitespace-nowrap">
                    {formatDate(alert.date)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
