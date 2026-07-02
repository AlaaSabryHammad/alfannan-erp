import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Eye, Trash2, ArrowLeftRight, CheckCircle2, Clock } from 'lucide-react';
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

interface Warehouse {
  id: number;
  nameAr: string;
}

interface Product {
  id: number;
  nameAr: string;
  sku: string;
  unit?: { nameAr: string } | null;
}

interface TransferItem {
  id: number;
  productId: number;
  qty: number;
  product: Product;
}

interface StockTransfer {
  id: number;
  transferNo: string;
  date: string;
  status: 'DONE' | 'PENDING';
  notes?: string | null;
  fromWarehouse: Warehouse;
  toWarehouse: Warehouse;
  items: TransferItem[];
}

// ─── Zod ──────────────────────────────────────────────────────────────────────

const lineSchema = z.object({
  productId: z.string().min(1, 'اختر منتجاً'),
  qty: z.string().min(1, 'الكمية مطلوبة'),
});

const createSchema = z.object({
  fromWarehouseId: z.string().min(1, 'اختر المستودع المصدر'),
  toWarehouseId: z.string().min(1, 'اختر المستودع الوجهة'),
  status: z.enum(['DONE', 'PENDING']),
  notes: z.string().optional(),
  items: z.array(lineSchema).min(1, 'أضف بنداً واحداً على الأقل'),
}).refine(
  (d) => d.fromWarehouseId !== d.toWarehouseId,
  { message: 'لا يمكن التحويل من وإلى نفس المستودع', path: ['toWarehouseId'] }
);

type CreateFormValues = z.infer<typeof createSchema>;

// ─── Toast ────────────────────────────────────────────────────────────────────

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// ─── API ──────────────────────────────────────────────────────────────────────

const fetchTransfers = async (params: { page: number; pageSize: number; search: string }) => {
  const res = await apiClient.get<PaginatedResponse<StockTransfer>>('/stock-transfers', { params });
  return res.data;
};

const fetchTransferById = async (id: number): Promise<StockTransfer> => {
  const res = await apiClient.get<StockTransfer>(`/stock-transfers/${id}`);
  return res.data;
};

const fetchWarehousesAll = async (): Promise<Warehouse[]> => {
  const res = await apiClient.get<PaginatedResponse<Warehouse>>('/warehouses', {
    params: { page: 1, pageSize: 200 },
  });
  return res.data.data;
};

const fetchProductsAll = async (): Promise<Product[]> => {
  const res = await apiClient.get<PaginatedResponse<Product>>('/products', {
    params: { page: 1, pageSize: 500 },
  });
  return res.data.data;
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────

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

// ─── Transfer Detail Modal ────────────────────────────────────────────────────

function TransferDetailModal({
  transferId,
  open,
  onClose,
}: {
  transferId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: transfer, isLoading } = useQuery({
    queryKey: ['stock-transfer-detail', transferId],
    queryFn: () => fetchTransferById(transferId!),
    enabled: open && transferId != null,
  });

  const totalQty = (transfer?.items ?? []).reduce((s, item) => s + Number(item.qty), 0);

  return (
    <Modal open={open} onClose={onClose} title="تفاصيل التحويل المخزني" size="xl">
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <span className="inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : transfer ? (
        <div className="space-y-4">
          {/* Header info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-app-muted">رقم التحويل: </span>
              <span className="font-bold text-primary">{transfer.transferNo}</span>
            </div>
            <div>
              <span className="text-app-muted">التاريخ: </span>
              <span className="font-medium">{formatDate(transfer.date)}</span>
            </div>
            <div>
              <span className="text-app-muted">المستودع المصدر: </span>
              <span className="font-medium">{transfer.fromWarehouse?.nameAr}</span>
            </div>
            <div>
              <span className="text-app-muted">المستودع الوجهة: </span>
              <span className="font-medium">{transfer.toWarehouse?.nameAr}</span>
            </div>
            <div>
              <span className="text-app-muted">الحالة: </span>
              <Badge variant={transfer.status === 'DONE' ? 'success' : 'warning'}>
                {transfer.status === 'DONE' ? 'تم' : 'قيد التنفيذ'}
              </Badge>
            </div>
            <div>
              <span className="text-app-muted">إجمالي الكمية: </span>
              <span className="font-bold text-app-text">{totalQty}</span>
            </div>
            {transfer.notes && (
              <div className="col-span-2">
                <span className="text-app-muted">ملاحظات: </span>
                <span className="font-medium">{transfer.notes}</span>
              </div>
            )}
          </div>

          {/* Items table */}
          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-app-border">
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">المنتج</th>
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">الكود</th>
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">الوحدة</th>
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">الكمية</th>
                </tr>
              </thead>
              <tbody>
                {(transfer.items ?? []).map((item) => (
                  <tr key={item.id} className="border-b border-app-border last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{item.product.nameAr}</div>
                    </td>
                    <td className="px-4 py-3 text-app-muted text-xs font-mono">{item.product.sku}</td>
                    <td className="px-4 py-3 text-app-muted text-xs">
                      {item.product.unit?.nameAr ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-primary">{item.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="text-center text-app-muted py-8">تعذر تحميل بيانات التحويل</p>
      )}
    </Modal>
  );
}

// ─── Create Transfer Modal ────────────────────────────────────────────────────

function CreateTransferModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses', 'dropdown'],
    queryFn: fetchWarehousesAll,
    enabled: open,
  });
  const { data: products = [] } = useQuery({
    queryKey: ['products', 'dropdown'],
    queryFn: fetchProductsAll,
    enabled: open,
  });

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors },
  } = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: {
      status: 'PENDING',
      items: [{ productId: '', qty: '1' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  const createMutation = useMutation({
    mutationFn: (body: object) => apiClient.post('/stock-transfers', body),
    onSuccess: () => {
      toast('تم إنشاء التحويل المخزني بنجاح');
      reset();
      onSuccess();
      onClose();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الإنشاء'), 'error'),
  });

  const onSubmit = (values: CreateFormValues) => {
    const body = {
      fromWarehouseId: parseInt(values.fromWarehouseId),
      toWarehouseId: parseInt(values.toWarehouseId),
      status: values.status,
      notes: values.notes || undefined,
      items: values.items.map((item) => ({
        productId: parseInt(item.productId),
        qty: parseFloat(item.qty),
      })),
    };
    createMutation.mutate(body);
  };

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="تحويل مخزني جديد"
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>
            إلغاء
          </Button>
          <Button loading={createMutation.isPending} onClick={handleSubmit(onSubmit)}>
            حفظ التحويل
          </Button>
        </>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
        {/* Header fields */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-app-text mb-1">
              المستودع المصدر <span className="text-danger">*</span>
            </label>
            <select
              {...register('fromWarehouseId')}
              className="w-full rounded-lg border border-app-border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="">— اختر المستودع المصدر —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.nameAr}</option>
              ))}
            </select>
            {errors.fromWarehouseId && (
              <p className="text-xs text-danger mt-1">{errors.fromWarehouseId.message}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-app-text mb-1">
              المستودع الوجهة <span className="text-danger">*</span>
            </label>
            <select
              {...register('toWarehouseId')}
              className="w-full rounded-lg border border-app-border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="">— اختر المستودع الوجهة —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.nameAr}</option>
              ))}
            </select>
            {errors.toWarehouseId && (
              <p className="text-xs text-danger mt-1">{errors.toWarehouseId.message}</p>
            )}
          </div>

          <Select label="الحالة" {...register('status')}>
            <option value="PENDING">قيد التنفيذ</option>
            <option value="DONE">تم (يحرك المخزون فوراً)</option>
          </Select>

          <Input
            label="ملاحظات"
            placeholder="اختياري"
            {...register('notes')}
          />
        </div>

        {/* Line Items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-app-text">الأصناف المحولة</h4>
            <button
              type="button"
              onClick={() => append({ productId: '', qty: '1' })}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <Plus size={12} />
              إضافة صنف
            </button>
          </div>

          {errors.items && typeof errors.items.message === 'string' && (
            <p className="text-xs text-danger mb-2">{errors.items.message}</p>
          )}

          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-app-border">
                  <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted w-3/4">المنتج</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted w-1/5">الكمية</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field, index) => (
                  <tr key={field.id} className="border-b border-app-border last:border-0">
                    <td className="px-3 py-2">
                      <select
                        {...register(`items.${index}.productId`)}
                        className="w-full rounded-lg border border-app-border px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
                      >
                        <option value="">— اختر —</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nameAr} ({p.sku})
                          </option>
                        ))}
                      </select>
                      {errors.items?.[index]?.productId && (
                        <p className="text-xs text-danger mt-0.5">
                          {errors.items[index]?.productId?.message}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        {...register(`items.${index}.qty`)}
                        type="number"
                        min="0.001"
                        step="0.001"
                        className="w-full rounded-lg border border-app-border px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
                      />
                      {errors.items?.[index]?.qty && (
                        <p className="text-xs text-danger mt-0.5">
                          {errors.items[index]?.qty?.message}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {fields.length > 1 && (
                        <button
                          type="button"
                          onClick={() => remove(index)}
                          className="p-1 rounded hover:bg-red-50 text-app-muted hover:text-danger transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Info note */}
        <div className="bg-primary-50 rounded-xl p-3 text-xs text-primary">
          <strong>ملاحظة:</strong> اختيار حالة "تم" يحرك المخزون فوراً من المستودع المصدر إلى الوجهة.
          الحالة "قيد التنفيذ" تسجل التحويل دون تحريك المخزون.
        </div>
      </form>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function StockTransfersPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('transfers.create');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [viewId, setViewId] = useState<number | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['stock-transfers', page, pageSize, search],
    queryFn: () => fetchTransfers({ page, pageSize, search }),
  });

  // All transfers for KPIs
  const { data: allData } = useQuery({
    queryKey: ['stock-transfers-all'],
    queryFn: () => fetchTransfers({ page: 1, pageSize: 1000, search: '' }),
    staleTime: 1000 * 60 * 2,
  });

  const allTransfers = allData?.data ?? [];
  const totalTransfers = allData?.pagination.total ?? 0;
  const doneCount = allTransfers.filter((t) => t.status === 'DONE').length;
  const pendingCount = allTransfers.filter((t) => t.status === 'PENDING').length;
  const totalQty = allTransfers.reduce(
    (s, t) => s + t.items.reduce((si, item) => si + Number(item.qty), 0),
    0
  );

  const openView = (row: StockTransfer) => {
    setViewId(row.id);
    setViewOpen(true);
  };

  const columns: Column<StockTransfer>[] = [
    {
      key: 'transferNo',
      header: 'رقم التحويل',
      render: (row) => (
        <span className="font-mono font-semibold text-primary text-xs">{row.transferNo}</span>
      ),
    },
    {
      key: 'fromWarehouse',
      header: 'المستودع المصدر',
      render: (row) => (
        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-full">
          {row.fromWarehouse?.nameAr}
        </span>
      ),
    },
    {
      key: 'toWarehouse',
      header: 'المستودع الوجهة',
      render: (row) => (
        <span className="text-xs bg-primary-50 text-primary px-2 py-1 rounded-full">
          {row.toWarehouse?.nameAr}
        </span>
      ),
    },
    {
      key: 'totalQty',
      header: 'الكمية الإجمالية',
      render: (row) => (
        <span className="font-mono font-bold text-app-text">
          {row.items.reduce((s, item) => s + Number(item.qty), 0)}
        </span>
      ),
    },
    {
      key: 'date',
      header: 'تاريخ التحويل',
      render: (row) => <span className="text-sm">{formatDate(row.date)}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (row) => (
        <Badge variant={row.status === 'DONE' ? 'success' : 'warning'}>
          {row.status === 'DONE' ? 'تم' : 'قيد التنفيذ'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'العمليات',
      render: (row) => (
        <button
          onClick={() => openView(row)}
          className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary transition-colors"
          title="عرض التفاصيل"
        >
          <Eye size={14} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="التحويلات المخزنية"
        subtitle="إدارة تحويلات المخزون بين المستودعات"
        actions={
          canCreate ? (
            <Button icon={<ArrowLeftRight size={16} />} onClick={() => setCreateOpen(true)}>
              تحويل مخزني جديد
            </Button>
          ) : undefined
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard
          icon={<ArrowLeftRight size={22} className="text-primary" />}
          label="إجمالي التحويلات"
          value={totalTransfers.toLocaleString('ar-EG')}
          color="bg-primary-50"
        />
        <KpiCard
          icon={<CheckCircle2 size={22} className="text-success" />}
          label="تحويلات مكتملة"
          value={doneCount.toLocaleString('ar-EG')}
          color="bg-green-50"
        />
        <KpiCard
          icon={<Clock size={22} className="text-warning" />}
          label="قيد التنفيذ"
          value={pendingCount.toLocaleString('ar-EG')}
          color="bg-amber-50"
        />
        <KpiCard
          icon={<ArrowLeftRight size={22} className="text-blue-600" />}
          label="إجمالي الكميات المحولة"
          value={totalQty.toLocaleString('ar-EG')}
          color="bg-blue-50"
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
          emptyText="لا توجد بيانات متاحة في هذا الجدول"
        />
      </div>

      {/* Create Modal */}
      <CreateTransferModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['stock-transfers'] });
          qc.invalidateQueries({ queryKey: ['stock-transfers-all'] });
          qc.invalidateQueries({ queryKey: ['stock-balances'] });
        }}
      />

      {/* View Modal */}
      <TransferDetailModal
        transferId={viewId}
        open={viewOpen}
        onClose={() => { setViewOpen(false); setViewId(null); }}
      />
    </div>
  );
}
