import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Eye, Trash2, FileText, CheckCircle, Clock, XCircle, Printer, Wallet, MessageCircle, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { usePermission } from '../../contexts/AuthContext';
import { useDateRange } from '../../contexts/DateRangeContext';
import { useBranch } from '../../contexts/BranchContext';
import { formatMoney, formatDate, getApiErrorMessage } from '../../lib/utils';
import { printInvoice } from '../../lib/print';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

// --- Types ---
interface InvoiceProduct {
  id: number;
  nameAr: string;
  sku: string;
  unit?: { nameAr: string } | null;
}

interface InvoiceItem {
  id: number;
  productId: number;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  product: InvoiceProduct;
}

interface Customer {
  id: number;
  nameAr: string;
  company?: string | null;
}

interface SalesInvoice {
  id: number;
  refNo: string;
  date: string;
  customer: Customer;
  paymentMethod: 'CASH' | 'CARD' | 'CREDIT';
  paidStatus: 'PAID' | 'UNPAID' | 'PARTIAL';
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  items?: InvoiceItem[];
  paidAmount?: number;
  remainingAmount?: number;
  customerId?: number;
  zatcaStatus?: 'NOT_CONFIGURED' | 'PENDING' | 'REPORTED' | 'CLEARED' | 'FAILED';
}

const zatcaStatusLabel: Record<string, string> = {
  NOT_CONFIGURED: 'غير مُهيّأة',
  PENDING: 'قيد الانتظار',
  REPORTED: 'مُبلَّغة',
  CLEARED: 'مُصادَق عليها',
  FAILED: 'فشل الإرسال',
};
const zatcaStatusVariant: Record<string, 'default' | 'warning' | 'success' | 'danger'> = {
  NOT_CONFIGURED: 'default',
  PENDING: 'warning',
  REPORTED: 'success',
  CLEARED: 'success',
  FAILED: 'danger',
};

// --- Helpers ---
function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

const paymentMethodLabel: Record<string, string> = {
  CASH: 'نقداً',
  CARD: 'فيزا / بطاقة',
  CREDIT: 'أجل (حساب)',
};

const paidStatusLabel: Record<string, string> = {
  PAID: 'مدفوعة',
  PARTIAL: 'جزئي',
  UNPAID: 'غير مسددة',
};

const paidStatusVariant: Record<string, 'success' | 'warning' | 'danger'> = {
  PAID: 'success',
  PARTIAL: 'warning',
  UNPAID: 'danger',
};

// --- API ---
const fetchInvoices = async (params: { page: number; pageSize: number; search: string; from?: string | null; to?: string | null; branchId?: number | null }) => {
  const { from, to, branchId, ...rest } = params;
  const queryParams: Record<string, string | number> = { ...rest };
  if (from) queryParams.from = from;
  if (to) queryParams.to = to;
  if (branchId != null) queryParams.branchId = branchId;
  const res = await apiClient.get<PaginatedResponse<SalesInvoice>>('/sales-invoices', { params: queryParams });
  return res.data;
};

const fetchInvoiceById = async (id: number) => {
  const res = await apiClient.get<SalesInvoice>(`/sales-invoices/${id}`);
  return res.data;
};

// --- KPI Card ---
function KpiCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        {icon}
      </div>
      <div>
        <p className="text-xs text-app-muted mb-1">{label}</p>
        <p className="text-xl font-bold text-app-text">{value}</p>
      </div>
    </div>
  );
}

// --- Record Payment Modal ---
interface TreasuryAccountOpt {
  id: number;
  code: string;
  nameAr: string;
}

function RecordPaymentModal({
  invoice,
  open,
  onClose,
}: {
  invoice: SalesInvoice | null | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [treasuryAccountId, setTreasuryAccountId] = useState('');
  const [error, setError] = useState('');

  const { data: treasuryAccounts = [] } = useQuery({
    queryKey: ['treasury-accounts'],
    queryFn: async () => (await apiClient.get<{ data: TreasuryAccountOpt[] }>('/treasury/accounts')).data.data,
    enabled: open,
  });

  const remaining = Number(invoice?.remainingAmount ?? invoice?.total ?? 0);

  const payMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/vouchers', {
        type: 'RECEIPT',
        treasuryAccountId: parseInt(treasuryAccountId),
        partyType: 'CUSTOMER',
        partyId: invoice!.customerId,
        salesInvoiceId: invoice!.id,
        amount: parseFloat(amount),
        description: `دفعة على فاتورة ${invoice!.refNo}`,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
      qc.invalidateQueries({ queryKey: ['invoice-detail', invoice!.id] });
      qc.invalidateQueries({ queryKey: ['customer-statement'] });
      toast('تم تسجيل الدفعة بنجاح');
      handleClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'حدث خطأ أثناء تسجيل الدفعة')),
  });

  const handleClose = () => {
    setAmount('');
    setTreasuryAccountId('');
    setError('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="تسجيل دفعة"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>إلغاء</Button>
          <Button
            loading={payMutation.isPending}
            disabled={!amount || !treasuryAccountId || parseFloat(amount) <= 0}
            onClick={() => payMutation.mutate()}
          >
            تسجيل الدفعة
          </Button>
        </>
      }
    >
      <div dir="rtl" className="space-y-4">
        <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between text-sm">
          <span className="text-app-muted">المتبقي على الفاتورة</span>
          <span className="font-bold font-mono text-primary">{formatMoney(remaining)}</span>
        </div>
        <Input
          label="المبلغ"
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Select label="حساب الخزينة (استلام في)" value={treasuryAccountId} onChange={(e) => setTreasuryAccountId(e.target.value)}>
          <option value="">— اختر —</option>
          {treasuryAccounts.map((a) => (
            <option key={a.id} value={String(a.id)}>{a.code} — {a.nameAr}</option>
          ))}
        </Select>
        {error && <div className="bg-danger-bg text-danger text-sm font-medium px-4 py-2.5 rounded-lg">{error}</div>}
      </div>
    </Modal>
  );
}

// --- Invoice Detail Modal ---
function InvoiceDetailModal({
  invoiceId,
  open,
  onClose,
}: {
  invoiceId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const canRecordPayment = usePermission('treasury.create');
  const [payModalOpen, setPayModalOpen] = useState(false);

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['invoice-detail', invoiceId],
    queryFn: () => fetchInvoiceById(invoiceId!),
    enabled: open && invoiceId != null,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await apiClient.get<{ vatNumber?: string }>('/settings')).data,
    enabled: open,
  });

  const handlePrint = () => {
    if (!invoice) return;
    printInvoice({
      docTitle: 'فاتورة مبيعات',
      refNo: invoice.refNo,
      date: invoice.date,
      partyLabel: 'العميل',
      partyName: invoice.customer?.nameAr ?? '—',
      partyExtra: invoice.customer?.company,
      paymentText: paymentMethodLabel[invoice.paymentMethod] ?? invoice.paymentMethod,
      statusText: paidStatusLabel[invoice.paidStatus] ?? invoice.paidStatus,
      items: (invoice.items ?? []).map((it) => ({
        name: it.product.nameAr,
        sku: it.product.sku,
        unit: it.product.unit?.nameAr,
        qty: Number(it.qty),
        unitPrice: Number(it.unitPrice),
        lineTotal: Number(it.lineTotal),
      })),
      subtotal: Number(invoice.subtotal),
      discount: Number(invoice.discount),
      tax: Number(invoice.tax),
      total: Number(invoice.total),
      sellerVatNumber: settings?.vatNumber,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="تفاصيل الفاتورة"
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
          {canRecordPayment && invoice && invoice.paidStatus !== 'PAID' && (
            <Button variant="outline" icon={<Wallet size={15} />} onClick={() => setPayModalOpen(true)}>
              تسجيل دفعة
            </Button>
          )}
          <Button icon={<Printer size={15} />} disabled={!invoice} onClick={handlePrint}>
            طباعة الفاتورة
          </Button>
        </>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <span className="inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : invoice ? (
        <div className="space-y-4">
          {/* Header info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-app-muted">رقم المرجع: </span>
              <span className="font-bold text-primary">{invoice.refNo}</span>
            </div>
            <div>
              <span className="text-app-muted">التاريخ: </span>
              <span className="font-medium">{formatDate(invoice.date)}</span>
            </div>
            <div>
              <span className="text-app-muted">العميل: </span>
              <span className="font-medium">{invoice.customer?.nameAr}</span>
            </div>
            <div>
              <span className="text-app-muted">طريقة الدفع: </span>
              <span className="font-medium">{paymentMethodLabel[invoice.paymentMethod] ?? invoice.paymentMethod}</span>
            </div>
            <div className="col-span-2 flex items-center gap-4">
              <span>
                <span className="text-app-muted">حالة الدفع: </span>
                <Badge variant={paidStatusVariant[invoice.paidStatus] ?? 'default'}>
                  {paidStatusLabel[invoice.paidStatus] ?? invoice.paidStatus}
                </Badge>
              </span>
              {invoice.paidStatus !== 'PAID' && (
                <span>
                  <span className="text-app-muted">المتبقي: </span>
                  <span className="font-bold text-danger">{formatMoney(Number(invoice.remainingAmount ?? invoice.total))}</span>
                </span>
              )}
            </div>
          </div>

          {/* Items table */}
          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-app-border">
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">المنتج</th>
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">الوحدة</th>
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">الكمية</th>
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">سعر الوحدة</th>
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {(invoice.items ?? []).map((item) => (
                  <tr key={item.id} className="border-b border-app-border last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{item.product.nameAr}</div>
                      <div className="text-xs text-app-muted">{item.product.sku}</div>
                    </td>
                    <td className="px-4 py-3 text-app-muted text-xs">
                      {item.product.unit?.nameAr ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono">{item.qty}</td>
                    <td className="px-4 py-3 font-mono text-xs">{formatMoney(Number(item.unitPrice))}</td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">
                      {formatMoney(Number(item.lineTotal))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex flex-col items-end gap-1 text-sm border-t border-app-border pt-3">
            <div className="flex items-center gap-8">
              <span className="text-app-muted">المجموع الفرعي:</span>
              <span className="font-mono w-32 text-left">{formatMoney(Number(invoice.subtotal))}</span>
            </div>
            {Number(invoice.discount) > 0 && (
              <div className="flex items-center gap-8">
                <span className="text-app-muted">الخصم:</span>
                <span className="font-mono w-32 text-left text-danger">− {formatMoney(Number(invoice.discount))}</span>
              </div>
            )}
            {Number(invoice.tax) > 0 && (
              <div className="flex items-center gap-8">
                <span className="text-app-muted">الضريبة:</span>
                <span className="font-mono w-32 text-left">{formatMoney(Number(invoice.tax))}</span>
              </div>
            )}
            <div className="flex items-center gap-8 border-t border-app-border pt-2 mt-1">
              <span className="font-bold text-base">إجمالي الفاتورة:</span>
              <span className="font-mono font-bold text-base text-primary w-32 text-left">
                {formatMoney(Number(invoice.total))}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-center text-app-muted py-8">تعذر تحميل بيانات الفاتورة</p>
      )}
      <RecordPaymentModal invoice={invoice} open={payModalOpen} onClose={() => setPayModalOpen(false)} />
    </Modal>
  );
}

// --- Main Component ---
export function SalesInvoicesPage() {
  const qc = useQueryClient();
  const canDelete = usePermission('sales.delete');
  const { from, to } = useDateRange();
  const { branchId } = useBranch();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [viewId, setViewId] = useState<number | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SalesInvoice | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['sales-invoices', page, pageSize, search, from, to, branchId],
    queryFn: () => fetchInvoices({ page, pageSize, search, from, to, branchId }),
  });

  // All invoices for KPIs (also respects date range + branch)
  const { data: allData } = useQuery({
    queryKey: ['sales-invoices-all', from, to, branchId],
    queryFn: () => fetchInvoices({ page: 1, pageSize: 1000, search: '', from, to, branchId }),
    staleTime: 1000 * 60 * 2,
  });

  const allInvoices = allData?.data ?? [];
  const totalInvoices = allData?.pagination.total ?? 0;
  const totalSales = allInvoices.reduce((s, inv) => s + Number(inv.total), 0);
  const paidCount = allInvoices.filter((i) => i.paidStatus === 'PAID').length;
  const unpaidCount = allInvoices.filter((i) => i.paidStatus !== 'PAID').length;

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/sales-invoices/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
      qc.invalidateQueries({ queryKey: ['customer-statement'] });
      toast('تم حذف الفاتورة');
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحذف'), 'error'),
  });

  const whatsappMutation = useMutation({
    mutationFn: (id: number) => apiClient.post(`/notifications/sales-invoices/${id}/whatsapp`),
    onSuccess: () => toast('تم إرسال تفاصيل الفاتورة عبر واتساب ✓'),
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر الإرسال عبر واتساب'), 'error'),
  });

  const zatcaMutation = useMutation({
    mutationFn: (id: number) => apiClient.post(`/zatca/sales-invoices/${id}/submit`),
    onSuccess: () => {
      toast('تم إرسال الفاتورة إلى هيئة الزكاة ✓');
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر إرسال الفاتورة إلى هيئة الزكاة'), 'error'),
  });

  const openView = (inv: SalesInvoice) => {
    setViewId(inv.id);
    setViewOpen(true);
  };

  const columns: Column<SalesInvoice>[] = [
    {
      key: 'refNo',
      header: 'رقم المرجع',
      render: (row) => <span className="font-mono font-semibold text-primary text-xs">{row.refNo}</span>,
    },
    {
      key: 'customer',
      header: 'العميل',
      render: (row) => (
        <div>
          <div className="font-medium">{row.customer?.nameAr}</div>
          {row.customer?.company && (
            <div className="text-xs text-app-muted">{row.customer.company}</div>
          )}
        </div>
      ),
    },
    {
      key: 'date',
      header: 'تاريخ البيع',
      render: (row) => <span className="text-sm">{formatDate(row.date)}</span>,
    },
    {
      key: 'paymentMethod',
      header: 'طريقة الدفع',
      render: (row) => (
        <span className="text-sm">{paymentMethodLabel[row.paymentMethod] ?? row.paymentMethod}</span>
      ),
    },
    {
      key: 'paidStatus',
      header: 'حالة الدفع',
      render: (row) => (
        <Badge variant={paidStatusVariant[row.paidStatus] ?? 'default'}>
          {paidStatusLabel[row.paidStatus] ?? row.paidStatus}
        </Badge>
      ),
    },
    {
      key: 'total',
      header: 'القيمة الإجمالية',
      render: (row) => (
        <span className="font-mono text-xs font-semibold text-primary">{formatMoney(Number(row.total))}</span>
      ),
    },
    {
      key: 'zatcaStatus',
      header: 'الفوترة الإلكترونية',
      render: (row) => (
        <Badge variant={zatcaStatusVariant[row.zatcaStatus ?? 'NOT_CONFIGURED']}>
          {zatcaStatusLabel[row.zatcaStatus ?? 'NOT_CONFIGURED']}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'إجراءات',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => openView(row)}
            className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary transition-colors"
            title="عرض التفاصيل"
          >
            <Eye size={14} />
          </button>
          <button
            onClick={() => whatsappMutation.mutate(row.id)}
            disabled={whatsappMutation.isPending}
            className="p-1.5 rounded-lg hover:bg-success-bg text-app-muted hover:text-success transition-colors disabled:opacity-50"
            title="إرسال عبر واتساب"
          >
            <MessageCircle size={14} />
          </button>
          {(row.zatcaStatus ?? 'NOT_CONFIGURED') !== 'CLEARED' && (row.zatcaStatus ?? 'NOT_CONFIGURED') !== 'REPORTED' && (
            <button
              onClick={() => zatcaMutation.mutate(row.id)}
              disabled={zatcaMutation.isPending}
              className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary transition-colors disabled:opacity-50"
              title="إرسال إلى هيئة الزكاة"
            >
              <ShieldCheck size={14} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => setDeleteTarget(row)}
              className="p-1.5 rounded-lg hover:bg-red-50 text-app-muted hover:text-danger transition-colors"
              title="حذف"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="فواتير البيع"
        subtitle="سجل الفواتير والمبيعات"
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard
          icon={<FileText size={22} className="text-primary" />}
          label="إجمالي الفواتير"
          value={totalInvoices.toLocaleString('ar-EG')}
          color="bg-primary-50"
        />
        <KpiCard
          icon={<FileText size={22} className="text-blue-600" />}
          label="إجمالي المبيعات"
          value={formatMoney(totalSales)}
          color="bg-blue-50"
        />
        <KpiCard
          icon={<CheckCircle size={22} className="text-success" />}
          label="مدفوعة"
          value={paidCount.toLocaleString('ar-EG')}
          color="bg-success-bg"
        />
        <KpiCard
          icon={<XCircle size={22} className="text-danger" />}
          label="غير مسددة"
          value={unpaidCount.toLocaleString('ar-EG')}
          color="bg-danger-bg"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5">
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          pagination={data?.pagination as PaginationMeta | undefined}
          loading={isLoading}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          onSearch={(q) => { setSearch(q); setPage(1); }}
          searchValue={search}
          rowKey={(r) => r.id}
          emptyText="لا توجد فواتير بيع بعد"
        />
      </div>

      {/* Invoice Detail Modal */}
      <InvoiceDetailModal
        invoiceId={viewId}
        open={viewOpen}
        onClose={() => { setViewOpen(false); setViewId(null); }}
      />

      {/* Delete Confirm */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="تأكيد الحذف"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              حذف
            </Button>
          </>
        }
      >
        <p className="text-sm text-app-text">
          هل تريد حذف الفاتورة <span className="font-bold text-primary">{deleteTarget?.refNo}</span>؟
          لن يمكن التراجع عن هذا الإجراء.
        </p>
      </Modal>
    </div>
  );
}
