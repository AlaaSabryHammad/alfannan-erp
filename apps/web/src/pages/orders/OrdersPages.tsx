/**
 * عروض الأسعار وأوامر البيع/الشراء — ثلاث صفحات من مكوّن عام واحد
 *
 * QuotationsPage · SalesOrdersPage · PurchaseOrdersPage
 * قائمة + إنشاء ببنود + إجراءات دورة الحياة (إرسال/قبول/تحويل/تنفيذ/إلغاء).
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Send, CheckCircle, XCircle, ArrowLeftRight, PackageCheck, Ban, Printer } from 'lucide-react';
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
import { printInvoice } from '../../lib/print';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

interface Party { id: number; nameAr: string }
interface ProductOpt { id: number; nameAr: string; sku: string; salePrice: number; costPrice: number }

interface Doc {
  id: number;
  refNo?: string;
  orderNo?: string;
  date: string;
  status: string;
  subtotal: number; discount: number; tax: number; total: number;
  customer?: Party; supplier?: Party; warehouse?: Party;
  quotation?: { id: number; refNo: string } | null;
  invoice?: { id: number; refNo: string } | null;
  salesOrder?: { id: number; orderNo: string } | null;
  items?: Array<{
    qty: number; unitPrice?: number; unitCost?: number; lineTotal: number;
    product: { nameAr: string; sku: string; unit?: { nameAr: string } | null };
  }>;
}

type Flavor = 'quotation' | 'salesOrder' | 'purchaseOrder';

const CFG: Record<Flavor, {
  title: string; subtitle: string; printTitle: string; endpoint: string; queryKey: string;
  numberKey: 'refNo' | 'orderNo'; partyKey: 'customer' | 'supplier'; partyLabel: string;
  partyEndpoint: string; priceLabel: string; needsWarehouse: boolean;
  viewPerm: string; createPerm: string; deletePerm: string;
  statusLabels: Record<string, string>;
  statusVariants: Record<string, 'success' | 'warning' | 'danger' | 'default'>;
}> = {
  quotation: {
    title: 'عروض الأسعار', subtitle: 'عروض أسعار للعملاء — تتحول إلى أوامر بيع', printTitle: 'عرض سعر',
    endpoint: '/quotations', queryKey: 'quotations', numberKey: 'refNo',
    partyKey: 'customer', partyLabel: 'العميل', partyEndpoint: '/customers',
    priceLabel: 'سعر الوحدة', needsWarehouse: false,
    viewPerm: 'quotations.view', createPerm: 'quotations.create', deletePerm: 'quotations.delete',
    statusLabels: { DRAFT: 'مسودة', SENT: 'أُرسل', ACCEPTED: 'مقبول', REJECTED: 'مرفوض', CONVERTED: 'محوّل' },
    statusVariants: { DRAFT: 'default', SENT: 'warning', ACCEPTED: 'success', REJECTED: 'danger', CONVERTED: 'success' },
  },
  salesOrder: {
    title: 'أوامر البيع', subtitle: 'أوامر بيع مؤكدة — تنفيذها يُنشئ الفاتورة', printTitle: 'أمر بيع',
    endpoint: '/sales-orders', queryKey: 'sales-orders', numberKey: 'orderNo',
    partyKey: 'customer', partyLabel: 'العميل', partyEndpoint: '/customers',
    priceLabel: 'سعر الوحدة', needsWarehouse: true,
    viewPerm: 'salesorders.view', createPerm: 'salesorders.create', deletePerm: 'salesorders.delete',
    statusLabels: { PENDING: 'بانتظار التنفيذ', FULFILLED: 'مُنفَّذ', CANCELLED: 'ملغى' },
    statusVariants: { PENDING: 'warning', FULFILLED: 'success', CANCELLED: 'danger' },
  },
  purchaseOrder: {
    title: 'أوامر الشراء', subtitle: 'أوامر شراء للموردين — تتحول إلى فواتير شراء', printTitle: 'أمر شراء',
    endpoint: '/purchase-orders', queryKey: 'purchase-orders', numberKey: 'orderNo',
    partyKey: 'supplier', partyLabel: 'المورد', partyEndpoint: '/suppliers',
    priceLabel: 'تكلفة الوحدة', needsWarehouse: true,
    viewPerm: 'purchaseorders.view', createPerm: 'purchaseorders.create', deletePerm: 'purchaseorders.delete',
    statusLabels: { PENDING: 'بانتظار التحويل', CONVERTED: 'محوّل لفاتورة', CANCELLED: 'ملغى' },
    statusVariants: { PENDING: 'warning', CONVERTED: 'success', CANCELLED: 'danger' },
  },
};

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

// ── Create modal ──────────────────────────────────────────────────────────────

function CreateDocModal({ flavor, open, onClose, onSuccess }: {
  flavor: Flavor; open: boolean; onClose: () => void; onSuccess: () => void;
}) {
  const cfg = CFG[flavor];
  const [partyId, setPartyId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [discount, setDiscount] = useState('0');
  const [tax, setTax] = useState('0');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Array<{ productId: string; qty: string; price: string }>>([{ productId: '', qty: '1', price: '' }]);
  const [error, setError] = useState('');

  const { data: parties = [] } = useQuery({
    queryKey: [cfg.queryKey, 'parties'],
    queryFn: async () => (await apiClient.get<PaginatedResponse<Party>>(cfg.partyEndpoint, { params: { page: 1, pageSize: 200 } })).data.data,
    enabled: open,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses', 'dropdown'],
    queryFn: async () => (await apiClient.get<PaginatedResponse<Party>>('/warehouses', { params: { page: 1, pageSize: 200 } })).data.data,
    enabled: open && cfg.needsWarehouse,
  });
  const { data: products = [] } = useQuery({
    queryKey: ['products', 'dropdown'],
    queryFn: async () => (await apiClient.get<PaginatedResponse<ProductOpt>>('/products', { params: { page: 1, pageSize: 500 } })).data.data,
    enabled: open,
  });

  const subtotal = rows.reduce((s, r) => s + (parseFloat(r.qty) || 0) * (parseFloat(r.price) || 0), 0);
  const total = subtotal - (parseFloat(discount) || 0) + (parseFloat(tax) || 0);

  const priceField = flavor === 'purchaseOrder' ? 'unitCost' : 'unitPrice';

  const createMutation = useMutation({
    mutationFn: () => apiClient.post(cfg.endpoint, {
      [flavor === 'purchaseOrder' ? 'supplierId' : 'customerId']: parseInt(partyId),
      ...(cfg.needsWarehouse ? { warehouseId: parseInt(warehouseId) } : {}),
      discount: parseFloat(discount) || 0,
      tax: parseFloat(tax) || 0,
      notes: notes || undefined,
      items: rows
        .filter((r) => r.productId && (parseFloat(r.qty) || 0) > 0)
        .map((r) => ({ productId: parseInt(r.productId), qty: parseFloat(r.qty), [priceField]: parseFloat(r.price) })),
    }),
    onSuccess: () => { toast('تم الإنشاء بنجاح'); handleClose(); onSuccess(); },
    onError: (err) => setError(getApiErrorMessage(err, 'حدث خطأ أثناء الإنشاء')),
  });

  const handleClose = () => {
    setPartyId(''); setWarehouseId(''); setDiscount('0'); setTax('0'); setNotes('');
    setRows([{ productId: '', qty: '1', price: '' }]); setError('');
    onClose();
  };

  const setRow = (i: number, patch: Partial<{ productId: string; qty: string; price: string }>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const valid = partyId && (!cfg.needsWarehouse || warehouseId) && rows.some((r) => r.productId && (parseFloat(r.qty) || 0) > 0 && (parseFloat(r.price) || 0) > 0);

  return (
    <Modal open={open} onClose={handleClose} title={`${cfg.title} — جديد`} size="xl"
      footer={<>
        <Button variant="outline" onClick={handleClose}>إلغاء</Button>
        <Button loading={createMutation.isPending} disabled={!valid} onClick={() => createMutation.mutate()}>حفظ</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Select label={cfg.partyLabel} value={partyId} onChange={(e) => setPartyId(e.target.value)}>
            <option value="">— اختر —</option>
            {parties.map((p) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}
          </Select>
          {cfg.needsWarehouse && (
            <Select label="المستودع" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">— اختر —</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
            </Select>
          )}
          <Input label="الخصم" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
          <Input label="الضريبة" type="number" min="0" step="0.01" value={tax} onChange={(e) => setTax(e.target.value)} />
          <div className="col-span-2"><Input label="ملاحظات" placeholder="اختياري" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold">البنود</h4>
            <button type="button" className="text-xs text-primary hover:underline flex items-center gap-1"
              onClick={() => setRows((p) => [...p, { productId: '', qty: '1', price: '' }])}>
              <Plus size={12} /> إضافة بند
            </button>
          </div>
          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b border-app-border">
                <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted w-2/5">المنتج</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">الكمية</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">{cfg.priceLabel}</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">الإجمالي</th>
                <th className="px-2 py-2 w-8" />
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-app-border last:border-0">
                    <td className="px-3 py-2">
                      <select value={r.productId}
                        onChange={(e) => {
                          const prod = products.find((p) => String(p.id) === e.target.value);
                          setRow(i, { productId: e.target.value, price: prod ? String(flavor === 'purchaseOrder' ? prod.costPrice : prod.salePrice) : r.price });
                        }}
                        className="w-full rounded-lg border border-app-border px-2 py-1.5 text-xs bg-white">
                        <option value="">— اختر —</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.nameAr} ({p.sku})</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0.01" step="0.01" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })}
                        className="w-20 rounded-lg border border-app-border px-2 py-1.5 text-xs bg-white" />
                    </td>
                    <td className="px-3 py-2">
                      <input type="number" min="0" step="0.01" value={r.price} onChange={(e) => setRow(i, { price: e.target.value })}
                        className="w-24 rounded-lg border border-app-border px-2 py-1.5 text-xs bg-white" />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-primary">
                      {formatMoney((parseFloat(r.qty) || 0) * (parseFloat(r.price) || 0))}
                    </td>
                    <td className="px-2 py-2">
                      {rows.length > 1 && (
                        <button type="button" onClick={() => setRows((p) => p.filter((_, idx) => idx !== i))}
                          className="p-1 rounded hover:bg-red-50 text-app-muted hover:text-danger"><Trash2 size={13} /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-gray-50 rounded-xl p-4 flex justify-end gap-8 text-sm">
          <span className="text-app-muted">المجموع: <span className="font-mono font-medium">{formatMoney(subtotal)}</span></span>
          <span className="font-bold">الإجمالي: <span className="font-mono text-primary">{formatMoney(total)}</span></span>
        </div>

        {error && <div className="bg-danger-bg text-danger text-sm font-medium px-4 py-2.5 rounded-lg">{error}</div>}
      </div>
    </Modal>
  );
}

// ── Generic page ──────────────────────────────────────────────────────────────

function DocsPage({ flavor }: { flavor: Flavor }) {
  const cfg = CFG[flavor];
  const qc = useQueryClient();
  const canCreate = usePermission(cfg.createPerm);
  const canDelete = usePermission(cfg.deletePerm);
  const { branchId } = useBranch();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [actionDoc, setActionDoc] = useState<Doc | null>(null); // convert/fulfill dialog
  const [deleteTarget, setDeleteTarget] = useState<Doc | null>(null);
  // convert/fulfill options
  const [optWarehouse, setOptWarehouse] = useState('');
  const [optPayMethod, setOptPayMethod] = useState('CASH');
  const [optPayStatus, setOptPayStatus] = useState('PAID');
  const [optReceive, setOptReceive] = useState('RECEIVED');

  const { data, isLoading } = useQuery({
    queryKey: [cfg.queryKey, page, pageSize, search, branchId],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, pageSize, search };
      if (branchId != null) params.branchId = branchId;
      return (await apiClient.get<PaginatedResponse<Doc>>(cfg.endpoint, { params })).data;
    },
  });

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses', 'dropdown'],
    queryFn: async () => (await apiClient.get<PaginatedResponse<Party>>('/warehouses', { params: { page: 1, pageSize: 200 } })).data.data,
    enabled: flavor === 'quotation' && actionDoc != null,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: [cfg.queryKey] });
    qc.invalidateQueries({ queryKey: ['quotations'] });
    qc.invalidateQueries({ queryKey: ['sales-orders'] });
    qc.invalidateQueries({ queryKey: ['sales-invoices'] });
    qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
    qc.invalidateQueries({ queryKey: ['stock'] });
  };

  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: object }) => apiClient.post(path, body ?? {}),
    onSuccess: (res) => {
      const refNo = (res.data as { invoiceRefNo?: string })?.invoiceRefNo;
      toast(refNo ? `تم — الفاتورة ${refNo}` : 'تم بنجاح');
      setActionDoc(null);
      invalidate();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`${cfg.endpoint}/${id}`),
    onSuccess: () => { toast('تم الحذف'); setDeleteTarget(null); invalidate(); },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحذف'), 'error'),
  });

  const columns: Column<Doc>[] = [
    { key: 'no', header: 'الرقم', render: (r) => <span className="font-mono font-semibold text-primary text-xs">{r[cfg.numberKey]}</span> },
    { key: 'party', header: cfg.partyLabel, render: (r) => <span className="font-medium">{r[cfg.partyKey]?.nameAr ?? '—'}</span> },
    { key: 'date', header: 'التاريخ', render: (r) => <span className="text-sm">{formatDate(r.date)}</span> },
    {
      key: 'status', header: 'الحالة',
      render: (r) => (
        <div className="flex items-center gap-1.5">
          <Badge variant={cfg.statusVariants[r.status] ?? 'default'}>{cfg.statusLabels[r.status] ?? r.status}</Badge>
          {r.invoice && <span className="font-mono text-[10px] text-app-muted">{r.invoice.refNo}</span>}
          {r.salesOrder && <span className="font-mono text-[10px] text-app-muted">{r.salesOrder.orderNo}</span>}
        </div>
      ),
    },
    { key: 'total', header: 'الإجمالي', render: (r) => <span className="font-mono text-xs font-semibold text-primary">{formatMoney(Number(r.total))}</span> },
    {
      key: 'actions', header: 'عمليات',
      render: (r) => (
        <div className="flex items-center gap-1">
          <button title="طباعة" className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary"
            onClick={() => printInvoice({
              docTitle: cfg.printTitle,
              refNo: r[cfg.numberKey] ?? '',
              date: r.date,
              partyLabel: cfg.partyLabel,
              partyName: r[cfg.partyKey]?.nameAr ?? '—',
              warehouse: r.warehouse?.nameAr,
              statusText: cfg.statusLabels[r.status] ?? r.status,
              items: (r.items ?? []).map((it) => ({
                name: it.product.nameAr,
                sku: it.product.sku,
                unit: it.product.unit?.nameAr,
                qty: Number(it.qty),
                unitPrice: Number(it.unitPrice ?? it.unitCost ?? 0),
                lineTotal: Number(it.lineTotal),
              })),
              subtotal: Number(r.subtotal),
              discount: Number(r.discount),
              tax: Number(r.tax),
              total: Number(r.total),
            })}>
            <Printer size={14} />
          </button>
          {canCreate && flavor === 'quotation' && (r.status === 'DRAFT') && (
            <button title="إرسال للعميل" className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary"
              onClick={() => act.mutate({ path: `${cfg.endpoint}/${r.id}/status`, body: { status: 'SENT' } })}><Send size={14} /></button>
          )}
          {canCreate && flavor === 'quotation' && (r.status === 'DRAFT' || r.status === 'SENT') && (
            <>
              <button title="قبول" className="p-1.5 rounded-lg hover:bg-success-bg text-app-muted hover:text-success"
                onClick={() => act.mutate({ path: `${cfg.endpoint}/${r.id}/status`, body: { status: 'ACCEPTED' } })}><CheckCircle size={14} /></button>
              <button title="رفض" className="p-1.5 rounded-lg hover:bg-red-50 text-app-muted hover:text-danger"
                onClick={() => act.mutate({ path: `${cfg.endpoint}/${r.id}/status`, body: { status: 'REJECTED' } })}><XCircle size={14} /></button>
            </>
          )}
          {canCreate && flavor === 'quotation' && (r.status === 'ACCEPTED') && (
            <button title="تحويل لأمر بيع" className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary"
              onClick={() => { setActionDoc(r); setOptWarehouse(''); }}><ArrowLeftRight size={14} /></button>
          )}
          {canCreate && flavor === 'salesOrder' && r.status === 'PENDING' && (
            <>
              <button title="تنفيذ — إنشاء الفاتورة" className="p-1.5 rounded-lg hover:bg-success-bg text-app-muted hover:text-success"
                onClick={() => { setActionDoc(r); setOptPayMethod('CASH'); setOptPayStatus('PAID'); }}><PackageCheck size={14} /></button>
              <button title="إلغاء الأمر" className="p-1.5 rounded-lg hover:bg-red-50 text-app-muted hover:text-danger"
                onClick={() => act.mutate({ path: `${cfg.endpoint}/${r.id}/cancel` })}><Ban size={14} /></button>
            </>
          )}
          {canCreate && flavor === 'purchaseOrder' && r.status === 'PENDING' && (
            <>
              <button title="تحويل لفاتورة شراء" className="p-1.5 rounded-lg hover:bg-success-bg text-app-muted hover:text-success"
                onClick={() => { setActionDoc(r); setOptReceive('RECEIVED'); setOptPayStatus('UNPAID'); }}><PackageCheck size={14} /></button>
              <button title="إلغاء الأمر" className="p-1.5 rounded-lg hover:bg-red-50 text-app-muted hover:text-danger"
                onClick={() => act.mutate({ path: `${cfg.endpoint}/${r.id}/cancel` })}><Ban size={14} /></button>
            </>
          )}
          {canDelete && (
            <button title="حذف" className="p-1.5 rounded-lg hover:bg-red-50 text-app-muted hover:text-danger"
              onClick={() => setDeleteTarget(r)}><Trash2 size={14} /></button>
          )}
        </div>
      ),
    },
  ];

  const runAction = () => {
    if (!actionDoc) return;
    if (flavor === 'quotation') {
      act.mutate({ path: `${cfg.endpoint}/${actionDoc.id}/convert`, body: { warehouseId: parseInt(optWarehouse) } });
    } else if (flavor === 'salesOrder') {
      act.mutate({ path: `${cfg.endpoint}/${actionDoc.id}/fulfill`, body: { paymentMethod: optPayMethod, paidStatus: optPayStatus } });
    } else {
      act.mutate({ path: `${cfg.endpoint}/${actionDoc.id}/convert`, body: { receiveStatus: optReceive, paymentStatus: optPayStatus } });
    }
  };

  return (
    <div>
      <PageHeader title={cfg.title} subtitle={cfg.subtitle}
        actions={canCreate ? <Button icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>جديد</Button> : undefined} />

      <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5">
        <DataTable columns={columns} data={data?.data ?? []} pagination={data?.pagination as PaginationMeta | undefined}
          loading={isLoading} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          onSearch={(q) => { setSearch(q); setPage(1); }} searchValue={search} rowKey={(r) => r.id}
          emptyText="لا توجد مستندات بعد" />
      </div>

      <CreateDocModal flavor={flavor} open={createOpen} onClose={() => setCreateOpen(false)} onSuccess={invalidate} />

      {/* convert / fulfill dialog */}
      <Modal open={!!actionDoc} onClose={() => setActionDoc(null)}
        title={flavor === 'quotation' ? 'تحويل إلى أمر بيع' : flavor === 'salesOrder' ? 'تنفيذ الأمر — إنشاء الفاتورة' : 'تحويل إلى فاتورة شراء'}
        size="md"
        footer={<>
          <Button variant="outline" onClick={() => setActionDoc(null)}>إلغاء</Button>
          <Button loading={act.isPending} disabled={flavor === 'quotation' && !optWarehouse} onClick={runAction}>تأكيد</Button>
        </>}>
        <div className="space-y-4">
          <p className="text-sm text-app-muted">
            المستند <span className="font-mono font-bold text-primary">{actionDoc?.[cfg.numberKey]}</span> بقيمة{' '}
            <span className="font-mono font-bold">{formatMoney(Number(actionDoc?.total ?? 0))}</span>
          </p>
          {flavor === 'quotation' && (
            <Select label="مستودع الصرف" value={optWarehouse} onChange={(e) => setOptWarehouse(e.target.value)}>
              <option value="">— اختر —</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.nameAr}</option>)}
            </Select>
          )}
          {flavor === 'salesOrder' && (
            <div className="grid grid-cols-2 gap-4">
              <Select label="طريقة الدفع" value={optPayMethod} onChange={(e) => setOptPayMethod(e.target.value)}>
                <option value="CASH">نقدي</option><option value="CARD">شبكة</option><option value="CREDIT">آجل</option>
              </Select>
              <Select label="حالة السداد" value={optPayStatus} onChange={(e) => setOptPayStatus(e.target.value)}>
                <option value="PAID">مدفوعة</option><option value="UNPAID">غير مدفوعة</option>
              </Select>
            </div>
          )}
          {flavor === 'purchaseOrder' && (
            <div className="grid grid-cols-2 gap-4">
              <Select label="حالة الاستلام" value={optReceive} onChange={(e) => setOptReceive(e.target.value)}>
                <option value="RECEIVED">تم الاستلام</option><option value="PENDING">قيد الاستلام</option>
              </Select>
              <Select label="حالة الدفع" value={optPayStatus} onChange={(e) => setOptPayStatus(e.target.value)}>
                <option value="UNPAID">غير مسددة</option><option value="PAID">مدفوعة</option>
              </Select>
            </div>
          )}
        </div>
      </Modal>

      {/* delete confirm */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="تأكيد الحذف" size="sm"
        footer={<>
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
          <Button variant="danger" loading={deleteMutation.isPending}
            onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>حذف</Button>
        </>}>
        <p className="text-sm">هل تريد حذف <span className="font-bold text-primary">{deleteTarget?.[cfg.numberKey]}</span>؟</p>
      </Modal>
    </div>
  );
}

export function QuotationsPage() { return <DocsPage flavor="quotation" />; }
export function SalesOrdersPage() { return <DocsPage flavor="salesOrder" />; }
export function PurchaseOrdersPage() { return <DocsPage flavor="purchaseOrder" />; }
