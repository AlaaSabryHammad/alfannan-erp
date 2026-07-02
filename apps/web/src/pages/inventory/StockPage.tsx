import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { SlidersHorizontal } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { usePermission } from '../../contexts/AuthContext';
import { getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

// --- Types ---
interface StockBalance {
  id: number;
  quantity: number;
  product: {
    id: number;
    nameAr: string;
    sku: string;
    unit: { nameAr: string; code: string } | null;
    brand: { nameAr: string } | null;
    department: { nameAr: string } | null;
  };
  warehouse: { id: number; nameAr: string };
}

interface Warehouse { id: number; nameAr: string; isActive: boolean; }

// --- Zod schema for adjust ---
const adjustSchema = z.object({
  quantity: z.string().min(1, 'الكمية مطلوبة'),
  reason: z.string().optional(),
});

type AdjustFormValues = z.infer<typeof adjustSchema>;

// --- API ---
const fetchBalances = async (params: {
  page: number; pageSize: number; search: string; warehouseId: string;
}) => {
  const p: Record<string, unknown> = { page: params.page, pageSize: params.pageSize, search: params.search };
  if (params.warehouseId) p.warehouseId = params.warehouseId;
  const res = await apiClient.get<PaginatedResponse<StockBalance>>('/stock/balances', { params: p });
  return res.data;
};

const fetchWarehouses = async () => {
  const res = await apiClient.get<PaginatedResponse<Warehouse>>('/warehouses', { params: { pageSize: 200 } });
  return res.data.data;
};

// Low-stock threshold
const LOW_STOCK = 5;

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// --- Component ---
export function StockPage() {
  const qc = useQueryClient();
  const canAdjust = usePermission('stock.adjust');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [adjustTarget, setAdjustTarget] = useState<StockBalance | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['stock-balances', page, pageSize, search, warehouseId],
    queryFn: () => fetchBalances({ page, pageSize, search, warehouseId }),
  });

  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses-all'], queryFn: fetchWarehouses });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<AdjustFormValues>({
    resolver: zodResolver(adjustSchema),
  });

  const adjustMutation = useMutation({
    mutationFn: (body: { productId: number; warehouseId: number; quantity: number; reason?: string }) =>
      apiClient.post('/stock/adjust', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-balances'] });
      toast('تم تسوية المخزون بنجاح');
      setAdjustTarget(null);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء التسوية'), 'error'),
  });

  const openAdjust = (row: StockBalance) => {
    setAdjustTarget(row);
    reset({ quantity: String(row.quantity), reason: '' });
  };

  const onAdjustSubmit = (values: AdjustFormValues) => {
    if (!adjustTarget) return;
    adjustMutation.mutate({
      productId: adjustTarget.product.id,
      warehouseId: adjustTarget.warehouse.id,
      quantity: parseFloat(values.quantity),
      reason: values.reason,
    });
  };

  const columns: Column<StockBalance>[] = [
    {
      key: 'product',
      header: 'المنتج',
      sortable: true,
      render: (row) => (
        <div>
          <div className="font-medium text-app-text">{row.product.nameAr}</div>
          <div className="text-xs text-app-muted font-mono">{row.product.sku}</div>
        </div>
      ),
    },
    {
      key: 'department',
      header: 'القسم',
      render: (row) => row.product.department?.nameAr ?? <span className="text-app-muted text-xs">—</span>,
    },
    {
      key: 'brand',
      header: 'العلامة',
      render: (row) => row.product.brand?.nameAr ?? <span className="text-app-muted text-xs">—</span>,
    },
    {
      key: 'warehouse',
      header: 'المستودع',
      render: (row) => (
        <span className="text-xs bg-primary-50 text-primary px-2 py-1 rounded-full">
          {row.warehouse.nameAr}
        </span>
      ),
    },
    {
      key: 'quantity',
      header: 'الكمية',
      render: (row) => (
        <div className="flex items-center gap-2">
          <span className={`font-bold text-base ${row.quantity <= LOW_STOCK ? 'text-warning' : 'text-app-text'}`}>
            {row.quantity}
          </span>
          {row.quantity <= LOW_STOCK && (
            <Badge variant="warning">مخزون منخفض</Badge>
          )}
          {row.quantity === 0 && (
            <Badge variant="danger">نفد</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'unit',
      header: 'الوحدة',
      render: (row) => row.product.unit?.nameAr ?? <span className="text-app-muted text-xs">—</span>,
    },
    {
      key: 'actions',
      header: 'إجراءات',
      render: (row) => canAdjust ? (
        <button
          onClick={() => openAdjust(row)}
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:bg-primary-50 border border-primary/30 px-2.5 py-1.5 rounded-lg transition-colors"
        >
          <SlidersHorizontal size={12} />
          تسوية
        </button>
      ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="رصيد المخزون"
        subtitle="عرض أرصدة المخزون حسب المنتج والمستودع"
      />

      {/* Warehouse filter */}
      <div className="mb-4 flex items-center gap-3">
        <div className="w-72">
          <Select
            value={warehouseId}
            onChange={(e) => { setWarehouseId(e.target.value); setPage(1); }}
          >
            <option value="">كافة المستودعات</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.nameAr}</option>
            ))}
          </Select>
        </div>
        {warehouseId && (
          <button
            onClick={() => { setWarehouseId(''); setPage(1); }}
            className="text-xs text-app-muted hover:text-app-text underline"
          >
            إلغاء التصفية
          </button>
        )}
      </div>

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
          emptyText="لا توجد أرصدة مخزون — تحقق من الفلتر المحدد"
        />
      </div>

      {/* Adjust Modal */}
      {canAdjust && (
        <Modal
          open={!!adjustTarget}
          onClose={() => { setAdjustTarget(null); reset(); }}
          title="تسوية المخزون"
          size="sm"
          footer={
            <>
              <Button variant="outline" onClick={() => { setAdjustTarget(null); reset(); }}>إلغاء</Button>
              <Button loading={adjustMutation.isPending} onClick={handleSubmit(onAdjustSubmit)}>
                تأكيد التسوية
              </Button>
            </>
          }
        >
          {adjustTarget && (
            <div className="flex flex-col gap-4">
              <div className="bg-gray-50 rounded-xl p-3 text-sm">
                <div className="font-semibold text-app-text">{adjustTarget.product.nameAr}</div>
                <div className="text-xs text-app-muted mt-1">
                  المستودع: {adjustTarget.warehouse.nameAr} · الرصيد الحالي: {adjustTarget.quantity}
                </div>
              </div>
              <form className="flex flex-col gap-4" onSubmit={handleSubmit(onAdjustSubmit)}>
                <Input
                  label="الكمية الجديدة"
                  type="number"
                  step="0.01"
                  required
                  {...register('quantity')}
                  error={errors.quantity?.message}
                />
                <Input
                  label="سبب التسوية"
                  placeholder="اختياري"
                  {...register('reason')}
                />
              </form>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
