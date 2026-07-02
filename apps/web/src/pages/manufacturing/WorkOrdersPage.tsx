import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ClipboardCheck, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { usePermission } from '../../contexts/AuthContext';
import { formatDate, getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProductLite {
  id: number;
  nameAr: string;
  sku: string;
  unit?: { nameAr: string } | null;
}

interface Warehouse {
  id: number;
  nameAr: string;
}

interface BomLite {
  id: number;
  productId: number;
  notes: string | null;
  product: ProductLite;
}

interface WorkOrderLine {
  id: number;
  componentId: number;
  qtyPerUnit: number;
  qtyRequired: number;
  component: ProductLite;
}

type WorkOrderStatus = 'DRAFT' | 'POSTED' | 'CANCELLED';

interface WorkOrder {
  id: number;
  orderNo: string;
  qty: number;
  status: WorkOrderStatus;
  date: string;
  notes: string | null;
  product: ProductLite;
  warehouse: Warehouse;
  lines: WorkOrderLine[];
}

const statusLabel: Record<WorkOrderStatus, { label: string; variant: 'warning' | 'success' | 'default' }> = {
  DRAFT: { label: 'مسودة', variant: 'warning' },
  POSTED: { label: 'مُرحَّل', variant: 'success' },
  CANCELLED: { label: 'ملغى', variant: 'default' },
};

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

const fetchWorkOrders = async (params: { page: number; pageSize: number }) =>
  (await apiClient.get<PaginatedResponse<WorkOrder>>('/work-orders', { params })).data;
const fetchWorkOrderById = async (id: number): Promise<WorkOrder> => (await apiClient.get<WorkOrder>(`/work-orders/${id}`)).data;
const fetchBomsAll = async (): Promise<BomLite[]> => (await apiClient.get<BomLite[]>('/bom')).data;
const fetchWarehousesAll = async (): Promise<Warehouse[]> =>
  (await apiClient.get<PaginatedResponse<Warehouse>>('/warehouses', { params: { page: 1, pageSize: 200 } })).data.data;

// ─── New Work Order Modal ─────────────────────────────────────────────────────

function NewWorkOrderModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [bomId, setBomId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const { data: boms = [] } = useQuery({ queryKey: ['bom', 'work-order'], queryFn: fetchBomsAll, enabled: open });
  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses', 'work-order'], queryFn: fetchWarehousesAll, enabled: open });

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.post<WorkOrder>('/work-orders', {
        bomId: parseInt(bomId),
        warehouseId: parseInt(warehouseId),
        qty: parseFloat(qty),
        notes: notes || undefined,
      }),
    onSuccess: (res) => {
      handleClose();
      onCreated(res.data.id);
    },
    onError: (err) => setError(getApiErrorMessage(err, 'حدث خطأ أثناء إنشاء أمر التصنيع')),
  });

  const handleClose = () => {
    setBomId('');
    setWarehouseId('');
    setQty('');
    setNotes('');
    setError('');
    onClose();
  };

  const handleSubmit = () => {
    if (!bomId || !warehouseId || !qty || Number(qty) <= 0) {
      setError('يرجى تعبئة جميع الحقول المطلوبة');
      return;
    }
    setError('');
    createMutation.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="أمر تصنيع جديد"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>إلغاء</Button>
          <Button loading={createMutation.isPending} onClick={handleSubmit}>إنشاء الأمر</Button>
        </>
      }
    >
      <div dir="rtl" className="space-y-4">
        <Select label="قائمة المكونات (المنتج النهائي)" value={bomId} onChange={(e) => setBomId(e.target.value)}>
          <option value="">— اختر —</option>
          {boms.map((b) => (
            <option key={b.id} value={String(b.id)}>{b.product.nameAr} ({b.product.sku})</option>
          ))}
        </Select>
        {boms.length === 0 && (
          <p className="text-xs text-warning bg-warning-bg rounded-lg px-3 py-2">
            لا توجد قوائم مكونات معرّفة بعد. أضف قائمة مكونات أولاً من شاشة "قوائم المكونات".
          </p>
        )}
        <Select label="المستودع" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">— اختر المستودع —</option>
          {warehouses.map((w) => (
            <option key={w.id} value={String(w.id)}>{w.nameAr}</option>
          ))}
        </Select>
        <Input label="الكمية المطلوب تصنيعها" type="number" step="0.01" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
        <Input label="ملاحظات (اختياري)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <div className="bg-danger-bg text-danger text-sm font-medium px-4 py-2.5 rounded-lg">{error}</div>}
      </div>
    </Modal>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function WorkOrderDetailModal({
  workOrderId,
  open,
  onClose,
}: {
  workOrderId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const canCreate = usePermission('manufacturing.create');

  const { data: wo, isLoading } = useQuery({
    queryKey: ['work-order-detail', workOrderId],
    queryFn: () => fetchWorkOrderById(workOrderId!),
    enabled: open && workOrderId !== null,
  });

  const postMutation = useMutation({
    mutationFn: () => apiClient.post(`/work-orders/${workOrderId}/post`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['work-order-detail', workOrderId] });
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      toast('تم ترحيل أمر التصنيع — تم استهلاك المكونات وإضافة المنتج التام للمخزون');
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الترحيل'), 'error'),
  });

  const isDraft = wo?.status === 'DRAFT';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={wo ? `أمر تصنيع ${wo.orderNo}` : 'تفاصيل أمر التصنيع'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
          {isDraft && canCreate && (
            <Button icon={<CheckCircle2 size={15} />} loading={postMutation.isPending} onClick={() => postMutation.mutate()}>
              ترحيل الأمر وتحديث المخزون
            </Button>
          )}
        </>
      }
    >
      {isLoading || !wo ? (
        <div className="py-10 text-center text-app-muted text-sm">جارٍ التحميل...</div>
      ) : (
        <div dir="rtl" className="space-y-4">
          <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
            <Badge variant={statusLabel[wo.status].variant}>{statusLabel[wo.status].label}</Badge>
            <div className="text-sm text-app-muted">{formatDate(wo.date)}</div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-primary-50 rounded-xl p-3">
              <p className="text-xs text-primary mb-0.5">المنتج النهائي</p>
              <p className="font-bold text-primary">{wo.product.nameAr}</p>
              <p className="text-xs text-primary/70 mt-0.5">الكمية: {Number(wo.qty).toLocaleString('en-US')}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-app-muted mb-0.5">المستودع</p>
              <p className="font-bold">{wo.warehouse.nameAr}</p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium text-app-text mb-2">المكوّنات المطلوبة</p>
            <div className="overflow-x-auto rounded-xl border border-app-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-app-border text-app-muted">
                    <th className="text-right px-3 py-2.5 font-semibold">المكوّن</th>
                    <th className="text-right px-3 py-2.5 font-semibold">الكمية / وحدة</th>
                    <th className="text-right px-3 py-2.5 font-semibold">الكمية المطلوبة إجمالياً</th>
                  </tr>
                </thead>
                <tbody>
                  {wo.lines.map((l) => (
                    <tr key={l.id} className="border-b border-app-border/60">
                      <td className="px-3 py-2">
                        <div className="font-medium">{l.component.nameAr}</div>
                        <div className="text-app-muted font-mono">{l.component.sku}</div>
                      </td>
                      <td className="px-3 py-2 font-mono">{Number(l.qtyPerUnit).toLocaleString('en-US')}</td>
                      <td className="px-3 py-2 font-mono font-bold">{Number(l.qtyRequired).toLocaleString('en-US')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {wo.notes && (
            <p className="text-sm text-app-muted bg-gray-50 rounded-lg px-3 py-2">{wo.notes}</p>
          )}

          {wo.status === 'POSTED' && (
            <div className="bg-success-bg text-success text-sm font-medium px-4 py-2.5 rounded-lg">
              تم ترحيل هذا الأمر — استُهلكت المكونات وأُضيف المنتج التام إلى مخزون {wo.warehouse.nameAr}.
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function WorkOrdersPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('manufacturing.create');
  const canDelete = usePermission('manufacturing.delete');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WorkOrder | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['work-orders', page, pageSize],
    queryFn: () => fetchWorkOrders({ page, pageSize }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/work-orders/${id}`),
    onSuccess: () => {
      toast('تم حذف أمر التصنيع ✓');
      qc.invalidateQueries({ queryKey: ['work-orders'] });
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر الحذف'), 'error'),
  });

  const columns: Column<WorkOrder>[] = [
    { key: 'orderNo', header: 'رقم الأمر', render: (row) => <span className="font-mono font-bold text-primary">{row.orderNo}</span> },
    { key: 'product', header: 'المنتج النهائي', render: (row) => row.product.nameAr },
    { key: 'warehouse', header: 'المستودع', render: (row) => row.warehouse.nameAr },
    { key: 'qty', header: 'الكمية', render: (row) => <span className="font-mono font-bold">{Number(row.qty).toLocaleString('en-US')}</span> },
    { key: 'date', header: 'التاريخ', render: (row) => formatDate(row.date) },
    {
      key: 'status',
      header: 'الحالة',
      render: (row) => <Badge variant={statusLabel[row.status].variant}>{statusLabel[row.status].label}</Badge>,
    },
    {
      key: 'actions',
      header: 'إجراءات',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setDetailId(row.id)}
            className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary transition-colors"
            title="عرض / إدارة"
          >
            <ClipboardCheck size={14} />
          </button>
          {canDelete && row.status === 'DRAFT' && (
            <button
              onClick={() => setDeleteTarget(row)}
              className="p-1.5 rounded-lg hover:bg-danger/10 text-app-muted hover:text-danger transition-colors"
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
        title="أوامر التصنيع"
        subtitle="تحويل المواد الخام إلى منتجات نهائية بحسب قوائم المكونات، مع تحديث المخزون تلقائياً عند الترحيل"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={() => setNewModalOpen(true)}>أمر تصنيع جديد</Button>
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
          rowKey={(r) => r.id}
          emptyText="لا توجد أوامر تصنيع حتى الآن"
        />
      </div>

      <NewWorkOrderModal
        open={newModalOpen}
        onClose={() => setNewModalOpen(false)}
        onCreated={(id) => { qc.invalidateQueries({ queryKey: ['work-orders'] }); setDetailId(id); }}
      />

      <WorkOrderDetailModal
        workOrderId={detailId}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
      />

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="تأكيد الحذف"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>
              حذف
            </Button>
          </>
        }
      >
        <p className="text-sm text-app-text">
          سيتم حذف أمر التصنيع <span className="font-mono font-bold">{deleteTarget?.orderNo}</span>.
        </p>
      </Modal>
    </div>
  );
}
