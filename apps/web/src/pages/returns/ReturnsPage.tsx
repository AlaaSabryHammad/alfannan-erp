/**
 * المرتجعات — صفحة مشتركة لمرتجعات البيع والشراء
 *
 * نفس الشاشة بنكهتين (config لكل نوع): قائمة المرتجعات، إنشاء مرتجع من فاتورة
 * (يجلب الكميات القابلة للإرجاع من الخادم)، عرض التفاصيل، والحذف مع تأكيد.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Eye, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { usePermission } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import { formatMoney, formatDate, getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Party { id: number; nameAr: string }

interface ReturnItem {
  id: number;
  productId: number;
  qty: number;
  unitPrice?: number;
  unitCost?: number;
  lineTotal: number;
  product: { id: number; nameAr: string; sku: string; unit?: { nameAr: string } | null };
}

interface ReturnDoc {
  id: number;
  refNo: string;
  date: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  refundMethod: 'CASH' | 'BALANCE';
  reason?: string | null;
  customer?: Party;
  supplier?: Party;
  warehouse?: Party;
  salesInvoice?: { id: number; refNo: string };
  purchaseInvoice?: { id: number; refNo: string };
  items?: ReturnItem[];
}

interface InvoiceOption {
  id: number;
  refNo: string;
  date: string;
  total: number;
  customer?: Party;
  supplier?: Party;
}

interface ReturnableLine {
  productId: number;
  product: { id: number; nameAr: string; sku: string; unit?: { nameAr: string } | null } | null;
  invoicedQty: number;
  returnedQty: number;
  returnableQty: number;
  unitPrice?: number;
  unitCost?: number;
}

interface ReturnableResponse {
  invoice: { id: number; refNo: string; subtotal: number; discount: number; tax: number; total: number; customer?: Party; supplier?: Party };
  lines: ReturnableLine[];
}

interface FlavorConfig {
  title: string;
  subtitle: string;
  endpoint: string;          // /sales-returns
  invoicesEndpoint: string;  // /sales-invoices
  invoiceQueryParams?: Record<string, string>;
  invoiceIdField: 'salesInvoiceId' | 'purchaseInvoiceId';
  invoiceKey: 'salesInvoice' | 'purchaseInvoice';
  partyKey: 'customer' | 'supplier';
  partyLabel: string;
  viewPerm: string;
  createPerm: string;
  deletePerm: string;
  queryKey: string;
  cashRefundLabel: string;
  balanceRefundLabel: string;
}

const refundLabel = (cfg: FlavorConfig, m: 'CASH' | 'BALANCE') =>
  m === 'CASH' ? cfg.cashRefundLabel : cfg.balanceRefundLabel;

const round2 = (n: number) => Math.round(n * 100) / 100;

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// ─── Create Return Modal ──────────────────────────────────────────────────────

function CreateReturnModal({ cfg, open, onClose, onSuccess }: {
  cfg: FlavorConfig;
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [invoiceId, setInvoiceId] = useState('');
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [refundMethod, setRefundMethod] = useState<'CASH' | 'BALANCE'>('BALANCE');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const { data: invoices = [] } = useQuery({
    queryKey: [cfg.queryKey, 'invoice-options'],
    queryFn: async () => {
      const res = await apiClient.get<PaginatedResponse<InvoiceOption>>(cfg.invoicesEndpoint, {
        params: { page: 1, pageSize: 100, ...(cfg.invoiceQueryParams ?? {}) },
      });
      return res.data.data;
    },
    enabled: open,
  });

  const { data: returnable, isLoading: loadingLines } = useQuery({
    queryKey: [cfg.queryKey, 'returnable', invoiceId],
    queryFn: async () => (await apiClient.get<ReturnableResponse>(`${cfg.endpoint}/invoice/${invoiceId}`)).data,
    enabled: open && !!invoiceId,
  });

  const lines = returnable?.lines ?? [];
  const invoice = returnable?.invoice;

  // Client-side preview of the proportional totals (server recomputes authoritatively)
  const subtotal = round2(lines.reduce((s, l) => {
    const q = parseFloat(qtys[l.productId] ?? '0') || 0;
    return s + q * Number(l.unitPrice ?? l.unitCost ?? 0);
  }, 0));
  const ratio = invoice && Number(invoice.subtotal) > 0 ? subtotal / Number(invoice.subtotal) : 0;
  const discount = round2(Number(invoice?.discount ?? 0) * ratio);
  const tax = round2(Number(invoice?.tax ?? 0) * ratio);
  const total = round2(subtotal - discount + tax);

  const createMutation = useMutation({
    mutationFn: () => {
      const items = lines
        .map((l) => ({ productId: l.productId, qty: parseFloat(qtys[l.productId] ?? '0') || 0 }))
        .filter((i) => i.qty > 0);
      return apiClient.post(cfg.endpoint, {
        [cfg.invoiceIdField]: parseInt(invoiceId),
        refundMethod,
        reason: reason || undefined,
        items,
      });
    },
    onSuccess: () => {
      toast('تم إنشاء المرتجع بنجاح');
      handleClose();
      onSuccess();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'حدث خطأ أثناء إنشاء المرتجع')),
  });

  const handleClose = () => {
    setInvoiceId('');
    setQtys({});
    setRefundMethod('BALANCE');
    setReason('');
    setError('');
    onClose();
  };

  const hasQty = lines.some((l) => (parseFloat(qtys[l.productId] ?? '0') || 0) > 0);
  const overQty = lines.some((l) => (parseFloat(qtys[l.productId] ?? '0') || 0) > l.returnableQty + 0.0001);

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="مرتجع جديد"
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>إلغاء</Button>
          <Button
            loading={createMutation.isPending}
            disabled={!invoiceId || !hasQty || overQty}
            onClick={() => createMutation.mutate()}
          >
            حفظ المرتجع
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Select label="الفاتورة الأصلية" value={invoiceId} onChange={(e) => { setInvoiceId(e.target.value); setQtys({}); setError(''); }}>
            <option value="">— اختر الفاتورة —</option>
            {invoices.map((inv) => (
              <option key={inv.id} value={String(inv.id)}>
                {inv.refNo} · {(inv.customer ?? inv.supplier)?.nameAr ?? ''} · {formatMoney(Number(inv.total))}
              </option>
            ))}
          </Select>
          <Select label="طريقة الرد" value={refundMethod} onChange={(e) => setRefundMethod(e.target.value as 'CASH' | 'BALANCE')}>
            <option value="BALANCE">{cfg.balanceRefundLabel}</option>
            <option value="CASH">{cfg.cashRefundLabel}</option>
          </Select>
        </div>

        <Input label="السبب" placeholder="اختياري — سبب الإرجاع" value={reason} onChange={(e) => setReason(e.target.value)} />

        {loadingLines && invoiceId && (
          <div className="flex items-center justify-center py-8">
            <span className="inline-block w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {invoiceId && !loadingLines && lines.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-app-border">
                  <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">المنتج</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">بالفاتورة</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">مُرتجَع سابقاً</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">القابل للإرجاع</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">سعر الوحدة</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted w-28">كمية المرتجع</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const q = parseFloat(qtys[l.productId] ?? '0') || 0;
                  const over = q > l.returnableQty + 0.0001;
                  return (
                    <tr key={l.productId} className="border-b border-app-border last:border-0">
                      <td className="px-3 py-2">
                        <div className="font-medium">{l.product?.nameAr ?? `#${l.productId}`}</div>
                        <div className="text-xs text-app-muted">{l.product?.sku}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{l.invoicedQty}</td>
                      <td className="px-3 py-2 font-mono text-xs">{l.returnedQty}</td>
                      <td className="px-3 py-2 font-mono text-xs font-semibold">{l.returnableQty}</td>
                      <td className="px-3 py-2 font-mono text-xs">{formatMoney(Number(l.unitPrice ?? l.unitCost ?? 0))}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min="0"
                          max={l.returnableQty}
                          step="0.01"
                          value={qtys[l.productId] ?? ''}
                          placeholder="0"
                          onChange={(e) => setQtys((prev) => ({ ...prev, [l.productId]: e.target.value }))}
                          className={`w-full rounded-lg border px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-primary/30 ${over ? 'border-danger' : 'border-app-border focus:border-primary'}`}
                        />
                        {over && <p className="text-[10px] text-danger mt-0.5">أقصى كمية {l.returnableQty}</p>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {invoiceId && !loadingLines && lines.length === 0 && (
          <p className="text-center text-sm text-app-muted py-4">لا توجد بنود قابلة للإرجاع في هذه الفاتورة</p>
        )}

        {hasQty && (
          <div className="bg-gray-50 rounded-xl p-4 flex flex-col items-end gap-1 text-sm">
            <div className="flex items-center gap-8">
              <span className="text-app-muted">إجمالي البنود:</span>
              <span className="font-mono w-32 text-left">{formatMoney(subtotal)}</span>
            </div>
            {discount > 0 && (
              <div className="flex items-center gap-8">
                <span className="text-app-muted">نصيب الخصم:</span>
                <span className="font-mono w-32 text-left text-danger">− {formatMoney(discount)}</span>
              </div>
            )}
            {tax > 0 && (
              <div className="flex items-center gap-8">
                <span className="text-app-muted">نصيب الضريبة:</span>
                <span className="font-mono w-32 text-left">{formatMoney(tax)}</span>
              </div>
            )}
            <div className="flex items-center gap-8 border-t border-app-border pt-2 mt-1">
              <span className="font-bold">قيمة المرتجع:</span>
              <span className="font-mono font-bold text-primary w-32 text-left">{formatMoney(total)}</span>
            </div>
          </div>
        )}

        {error && <div className="bg-danger-bg text-danger text-sm font-medium px-4 py-2.5 rounded-lg">{error}</div>}
      </div>
    </Modal>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function ReturnDetailModal({ cfg, returnId, open, onClose }: {
  cfg: FlavorConfig;
  returnId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: ret, isLoading } = useQuery({
    queryKey: [cfg.queryKey, 'detail', returnId],
    queryFn: async () => (await apiClient.get<ReturnDoc>(`${cfg.endpoint}/${returnId}`)).data,
    enabled: open && returnId != null,
  });

  return (
    <Modal open={open} onClose={onClose} title="تفاصيل المرتجع" size="lg"
      footer={<Button variant="outline" onClick={onClose}>إغلاق</Button>}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <span className="inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : ret ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-app-muted">رقم المرتجع: </span><span className="font-bold text-primary">{ret.refNo}</span></div>
            <div><span className="text-app-muted">التاريخ: </span><span className="font-medium">{formatDate(ret.date)}</span></div>
            <div><span className="text-app-muted">الفاتورة الأصلية: </span><span className="font-mono font-medium">{(ret[cfg.invoiceKey])?.refNo ?? '—'}</span></div>
            <div><span className="text-app-muted">{cfg.partyLabel}: </span><span className="font-medium">{(ret[cfg.partyKey])?.nameAr ?? '—'}</span></div>
            <div><span className="text-app-muted">المستودع: </span><span className="font-medium">{ret.warehouse?.nameAr ?? '—'}</span></div>
            <div>
              <span className="text-app-muted">طريقة الرد: </span>
              <Badge variant={ret.refundMethod === 'CASH' ? 'warning' : 'default'}>{refundLabel(cfg, ret.refundMethod)}</Badge>
            </div>
            {ret.reason && <div className="col-span-2"><span className="text-app-muted">السبب: </span><span className="font-medium">{ret.reason}</span></div>}
          </div>

          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-app-border">
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">المنتج</th>
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">الكمية</th>
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">سعر الوحدة</th>
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {(ret.items ?? []).map((item) => (
                  <tr key={item.id} className="border-b border-app-border last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{item.product.nameAr}</div>
                      <div className="text-xs text-app-muted">{item.product.sku}</div>
                    </td>
                    <td className="px-4 py-3 font-mono">{item.qty}</td>
                    <td className="px-4 py-3 font-mono text-xs">{formatMoney(Number(item.unitPrice ?? item.unitCost ?? 0))}</td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">{formatMoney(Number(item.lineTotal))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col items-end gap-1 text-sm border-t border-app-border pt-3">
            <div className="flex items-center gap-8">
              <span className="text-app-muted">إجمالي البنود:</span>
              <span className="font-mono w-36 text-left">{formatMoney(Number(ret.subtotal))}</span>
            </div>
            {Number(ret.discount) > 0 && (
              <div className="flex items-center gap-8">
                <span className="text-app-muted">نصيب الخصم:</span>
                <span className="font-mono w-36 text-left text-danger">− {formatMoney(Number(ret.discount))}</span>
              </div>
            )}
            {Number(ret.tax) > 0 && (
              <div className="flex items-center gap-8">
                <span className="text-app-muted">نصيب الضريبة:</span>
                <span className="font-mono w-36 text-left">{formatMoney(Number(ret.tax))}</span>
              </div>
            )}
            <div className="flex items-center gap-8 border-t border-app-border pt-2 mt-1">
              <span className="font-bold text-base">قيمة المرتجع:</span>
              <span className="font-mono font-bold text-base text-primary w-36 text-left">{formatMoney(Number(ret.total))}</span>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-center text-app-muted py-8">تعذر تحميل بيانات المرتجع</p>
      )}
    </Modal>
  );
}

// ─── Generic Page ─────────────────────────────────────────────────────────────

function ReturnsPage({ cfg }: { cfg: FlavorConfig }) {
  const qc = useQueryClient();
  const canCreate = usePermission(cfg.createPerm);
  const canDelete = usePermission(cfg.deletePerm);
  const { branchId } = useBranch();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [viewId, setViewId] = useState<number | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ReturnDoc | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: [cfg.queryKey, page, pageSize, search, branchId],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, pageSize, search };
      if (branchId != null) params.branchId = branchId;
      const res = await apiClient.get<PaginatedResponse<ReturnDoc>>(cfg.endpoint, { params });
      return res.data;
    },
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: [cfg.queryKey] });
    qc.invalidateQueries({ queryKey: ['stock'] });
    qc.invalidateQueries({ queryKey: ['sales-invoices'] });
    qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`${cfg.endpoint}/${id}`),
    onSuccess: () => {
      invalidateAll();
      toast('تم حذف المرتجع');
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحذف'), 'error'),
  });

  const columns: Column<ReturnDoc>[] = [
    {
      key: 'refNo',
      header: 'رقم المرتجع',
      render: (row) => <span className="font-mono font-semibold text-primary text-xs">{row.refNo}</span>,
    },
    {
      key: 'invoice',
      header: 'الفاتورة الأصلية',
      render: (row) => <span className="font-mono text-xs">{(row[cfg.invoiceKey])?.refNo ?? '—'}</span>,
    },
    {
      key: 'party',
      header: cfg.partyLabel,
      render: (row) => <span className="font-medium">{(row[cfg.partyKey])?.nameAr ?? '—'}</span>,
    },
    {
      key: 'date',
      header: 'التاريخ',
      render: (row) => <span className="text-sm">{formatDate(row.date)}</span>,
    },
    {
      key: 'refundMethod',
      header: 'طريقة الرد',
      render: (row) => (
        <Badge variant={row.refundMethod === 'CASH' ? 'warning' : 'default'}>{refundLabel(cfg, row.refundMethod)}</Badge>
      ),
    },
    {
      key: 'total',
      header: 'قيمة المرتجع',
      render: (row) => <span className="font-mono text-xs font-semibold text-primary">{formatMoney(Number(row.total))}</span>,
    },
    {
      key: 'actions',
      header: 'عمليات',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setViewId(row.id); setViewOpen(true); }}
            className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary transition-colors"
            title="عرض التفاصيل"
          >
            <Eye size={14} />
          </button>
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
        title={cfg.title}
        subtitle={cfg.subtitle}
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
              مرتجع جديد
            </Button>
          ) : undefined
        }
      />

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
          emptyText="لا توجد مرتجعات بعد"
        />
      </div>

      <CreateReturnModal cfg={cfg} open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={invalidateAll} />
      <ReturnDetailModal cfg={cfg} returnId={viewId} open={viewOpen} onClose={() => { setViewOpen(false); setViewId(null); }} />

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
          هل تريد حذف المرتجع <span className="font-bold text-primary">{deleteTarget?.refNo}</span>؟
          سيُعكس أثره على المخزون والحسابات. لن يمكن التراجع عن هذا الإجراء.
        </p>
      </Modal>
    </div>
  );
}

// ─── Flavors ──────────────────────────────────────────────────────────────────

const salesCfg: FlavorConfig = {
  title: 'مرتجعات المبيعات',
  subtitle: 'إشعارات دائن — إرجاع بضاعة من العملاء',
  endpoint: '/sales-returns',
  invoicesEndpoint: '/sales-invoices',
  invoiceIdField: 'salesInvoiceId',
  invoiceKey: 'salesInvoice',
  partyKey: 'customer',
  partyLabel: 'العميل',
  viewPerm: 'sales.view',
  createPerm: 'sales.create',
  deletePerm: 'sales.delete',
  queryKey: 'sales-returns',
  cashRefundLabel: 'ردّ نقدي للعميل',
  balanceRefundLabel: 'على حساب العميل',
};

const purchaseCfg: FlavorConfig = {
  title: 'مرتجعات المشتريات',
  subtitle: 'إشعارات مدين — إرجاع بضاعة إلى الموردين',
  endpoint: '/purchase-returns',
  invoicesEndpoint: '/purchase-invoices',
  invoiceQueryParams: { receiveStatus: 'RECEIVED' },
  invoiceIdField: 'purchaseInvoiceId',
  invoiceKey: 'purchaseInvoice',
  partyKey: 'supplier',
  partyLabel: 'المورد',
  viewPerm: 'purchases.view',
  createPerm: 'purchases.create',
  deletePerm: 'purchases.delete',
  queryKey: 'purchase-returns',
  cashRefundLabel: 'استرداد نقدي من المورد',
  balanceRefundLabel: 'على حساب المورد',
};

export function SalesReturnsPage() {
  return <ReturnsPage cfg={salesCfg} />;
}

export function PurchaseReturnsPage() {
  return <ReturnsPage cfg={purchaseCfg} />;
}
