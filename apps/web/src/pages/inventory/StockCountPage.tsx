import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ClipboardCheck, Search, CheckCircle2, XCircle } from 'lucide-react';
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
  barcode: string | null;
  unit?: { nameAr: string } | null;
}

interface StockCountLine {
  id: number;
  productId: number;
  systemQty: number;
  countedQty: number;
  product: Product;
}

type StockCountStatus = 'DRAFT' | 'POSTED';

interface StockCount {
  id: number;
  countNo: string;
  date: string;
  status: StockCountStatus;
  notes: string | null;
  warehouse: Warehouse;
  lines?: StockCountLine[];
  itemCount?: number;
  varianceQty?: number;
}

const statusLabel: Record<StockCountStatus, { label: string; variant: 'warning' | 'success' }> = {
  DRAFT: { label: 'مسودة', variant: 'warning' },
  POSTED: { label: 'مُرحَّل', variant: 'success' },
};

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

const fetchStockCounts = async (params: { page: number; pageSize: number }) => {
  const res = await apiClient.get<PaginatedResponse<StockCount>>('/stock-counts', { params });
  return res.data;
};

const fetchStockCountById = async (id: number): Promise<StockCount> => {
  const res = await apiClient.get<StockCount>(`/stock-counts/${id}`);
  return res.data;
};

const fetchWarehousesAll = async (): Promise<Warehouse[]> => {
  const res = await apiClient.get<PaginatedResponse<Warehouse>>('/warehouses', { params: { page: 1, pageSize: 200 } });
  return res.data.data;
};

const fetchProductsAll = async (): Promise<Product[]> => {
  const res = await apiClient.get<PaginatedResponse<Product>>('/products', { params: { page: 1, pageSize: 1000 } });
  return res.data.data;
};

// ─── New Count Modal ──────────────────────────────────────────────────────────

function NewCountModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const [warehouseId, setWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses', 'stock-count'], queryFn: fetchWarehousesAll, enabled: open });

  const createMutation = useMutation({
    mutationFn: () => apiClient.post<StockCount>('/stock-counts', { warehouseId: parseInt(warehouseId), notes: notes || undefined }),
    onSuccess: (res) => {
      handleClose();
      onCreated(res.data.id);
    },
    onError: (err) => setError(getApiErrorMessage(err, 'حدث خطأ أثناء إنشاء الجرد')),
  });

  const handleClose = () => {
    setWarehouseId('');
    setNotes('');
    setError('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="جرد مخزني جديد"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>إلغاء</Button>
          <Button loading={createMutation.isPending} disabled={!warehouseId} onClick={() => createMutation.mutate()}>
            بدء الجرد
          </Button>
        </>
      }
    >
      <div dir="rtl" className="space-y-4">
        <Select label="المستودع" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">— اختر المستودع —</option>
          {warehouses.map((w) => (
            <option key={w.id} value={String(w.id)}>{w.nameAr}</option>
          ))}
        </Select>
        <Input label="ملاحظات (اختياري)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <div className="bg-danger-bg text-danger text-sm font-medium px-4 py-2.5 rounded-lg">{error}</div>}
      </div>
    </Modal>
  );
}

// ─── Count Detail Modal ───────────────────────────────────────────────────────

function CountDetailModal({
  countId,
  open,
  onClose,
}: {
  countId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const canAdjust = usePermission('stockcount.adjust');
  const [search, setSearch] = useState('');
  const [pendingQty, setPendingQty] = useState<Record<number, string>>({});

  const { data: count, isLoading } = useQuery({
    queryKey: ['stock-count-detail', countId],
    queryFn: () => fetchStockCountById(countId!),
    enabled: open && countId !== null,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products', 'stock-count'],
    queryFn: fetchProductsAll,
    enabled: open,
  });

  const isDraft = count?.status === 'DRAFT';
  const addedProductIds = new Set((count?.lines ?? []).map((l) => l.productId));

  const searchResults = search.trim()
    ? products
        .filter((p) => !addedProductIds.has(p.id))
        .filter((p) =>
          p.nameAr.toLowerCase().includes(search.toLowerCase()) ||
          p.sku.toLowerCase().includes(search.toLowerCase()) ||
          (p.barcode && p.barcode.includes(search)),
        )
        .slice(0, 8)
    : [];

  const upsertLineMutation = useMutation({
    mutationFn: ({ productId, countedQty }: { productId: number; countedQty: number }) =>
      apiClient.put(`/stock-counts/${countId}/lines`, { productId, countedQty }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-count-detail', countId] });
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحفظ'), 'error'),
  });

  const removeLineMutation = useMutation({
    mutationFn: (productId: number) => apiClient.delete(`/stock-counts/${countId}/lines/${productId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock-count-detail', countId] }),
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحذف'), 'error'),
  });

  const postMutation = useMutation({
    mutationFn: () => apiClient.post(`/stock-counts/${countId}/post`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-count-detail', countId] });
      qc.invalidateQueries({ queryKey: ['stock-counts'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      toast('تم ترحيل الجرد وتطبيق الفروقات على المخزون بنجاح');
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء ترحيل الجرد'), 'error'),
  });

  const addProduct = (product: Product) => {
    upsertLineMutation.mutate({ productId: product.id, countedQty: 0 });
    setSearch('');
  };

  const commitCountedQty = (productId: number) => {
    const raw = pendingQty[productId];
    if (raw === undefined) return;
    const qty = parseFloat(raw);
    if (Number.isNaN(qty) || qty < 0) return;
    upsertLineMutation.mutate({ productId, countedQty: qty });
  };

  const totalVariance = (count?.lines ?? []).reduce((s, l) => s + (Number(l.countedQty) - Number(l.systemQty)), 0);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={count ? `جرد ${count.countNo} — ${count.warehouse.nameAr}` : 'تفاصيل الجرد'}
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
          {isDraft && canAdjust && (
            <Button
              icon={<CheckCircle2 size={15} />}
              loading={postMutation.isPending}
              disabled={(count?.lines?.length ?? 0) === 0}
              onClick={() => postMutation.mutate()}
            >
              ترحيل الجرد وتطبيق الفروقات
            </Button>
          )}
        </>
      }
    >
      {isLoading || !count ? (
        <div className="py-10 text-center text-app-muted text-sm">جارٍ التحميل...</div>
      ) : (
        <div dir="rtl" className="space-y-4">
          <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
            <Badge variant={statusLabel[count.status].variant}>{statusLabel[count.status].label}</Badge>
            <div className="text-sm">
              <span className="text-app-muted">صافي الفرق: </span>
              <span className={`font-bold font-mono ${totalVariance === 0 ? 'text-app-text' : totalVariance > 0 ? 'text-success' : 'text-danger'}`}>
                {totalVariance > 0 ? '+' : ''}{totalVariance.toLocaleString('en-US')}
              </span>
            </div>
          </div>

          {isDraft && (
            <div className="relative">
              <Input
                icon={<Search size={14} />}
                placeholder="ابحث بالاسم أو SKU أو الباركود لإضافة صنف..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {searchResults.length > 0 && (
                <div className="absolute z-10 top-full mt-1 w-full bg-white border border-app-border rounded-xl shadow-lg overflow-hidden">
                  {searchResults.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => addProduct(p)}
                      className="w-full text-right px-4 py-2 text-sm hover:bg-primary-50 flex items-center justify-between"
                    >
                      <span>{p.nameAr}</span>
                      <span className="text-xs text-app-muted font-mono">{p.sku}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-app-border text-app-muted">
                  <th className="text-right px-3 py-2.5 font-semibold">الصنف</th>
                  <th className="text-right px-3 py-2.5 font-semibold w-28">الرصيد بالنظام</th>
                  <th className="text-right px-3 py-2.5 font-semibold w-32">الكمية الفعلية</th>
                  <th className="text-right px-3 py-2.5 font-semibold w-24">الفرق</th>
                  {isDraft && <th className="w-12"></th>}
                </tr>
              </thead>
              <tbody>
                {(count.lines ?? []).length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-app-muted">لم تُضف أصناف بعد</td></tr>
                ) : (
                  (count.lines ?? []).map((line) => {
                    const variance = Number(line.countedQty) - Number(line.systemQty);
                    return (
                      <tr key={line.id} className="border-b border-app-border/60">
                        <td className="px-3 py-2">
                          <div className="font-medium">{line.product.nameAr}</div>
                          <div className="text-app-muted font-mono">{line.product.sku}</div>
                        </td>
                        <td className="px-3 py-2 font-mono">{Number(line.systemQty).toLocaleString('en-US')}</td>
                        <td className="px-3 py-2">
                          {isDraft ? (
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              defaultValue={line.countedQty}
                              onChange={(e) => setPendingQty((prev) => ({ ...prev, [line.productId]: e.target.value }))}
                              onBlur={() => commitCountedQty(line.productId)}
                              className="w-24 text-sm border border-app-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/30"
                            />
                          ) : (
                            <span className="font-mono">{Number(line.countedQty).toLocaleString('en-US')}</span>
                          )}
                        </td>
                        <td className={`px-3 py-2 font-mono font-bold ${variance === 0 ? 'text-app-muted' : variance > 0 ? 'text-success' : 'text-danger'}`}>
                          {variance > 0 ? '+' : ''}{variance.toLocaleString('en-US')}
                        </td>
                        {isDraft && (
                          <td className="px-3 py-2">
                            <button
                              onClick={() => removeLineMutation.mutate(line.productId)}
                              className="p-1 rounded-lg hover:bg-red-50 text-app-muted hover:text-danger transition-colors"
                            >
                              <Trash2 size={13} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function StockCountPage() {
  const canAdjust = usePermission('stockcount.adjust');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [detailId, setDetailId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['stock-counts', page, pageSize],
    queryFn: () => fetchStockCounts({ page, pageSize }),
  });

  const columns: Column<StockCount>[] = [
    { key: 'countNo', header: 'رقم الجرد', render: (row) => <span className="font-mono font-bold text-primary">{row.countNo}</span> },
    { key: 'warehouse', header: 'المستودع', render: (row) => row.warehouse.nameAr },
    { key: 'date', header: 'التاريخ', render: (row) => formatDate(row.date) },
    { key: 'itemCount', header: 'عدد الأصناف', render: (row) => row.itemCount ?? 0 },
    {
      key: 'varianceQty',
      header: 'صافي الفرق',
      render: (row) => {
        const v = row.varianceQty ?? 0;
        return (
          <span className={`font-mono font-bold ${v === 0 ? 'text-app-muted' : v > 0 ? 'text-success' : 'text-danger'}`}>
            {v > 0 ? '+' : ''}{v.toLocaleString('en-US')}
          </span>
        );
      },
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (row) => <Badge variant={statusLabel[row.status].variant}>{statusLabel[row.status].label}</Badge>,
    },
    {
      key: 'actions',
      header: 'إجراءات',
      render: (row) => (
        <button
          onClick={() => setDetailId(row.id)}
          className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary transition-colors"
          title="عرض / إدارة"
        >
          <ClipboardCheck size={14} />
        </button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="الجرد المخزني"
        subtitle="جرد فعلي للمخزون ومقارنته بالرصيد المسجل بالنظام، مع ترحيل الفروقات تلقائيًا"
        actions={
          canAdjust ? (
            <Button icon={<Plus size={16} />} onClick={() => setNewModalOpen(true)}>جرد جديد</Button>
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
          emptyText="لا توجد عمليات جرد حتى الآن"
        />
      </div>

      <NewCountModal
        open={newModalOpen}
        onClose={() => setNewModalOpen(false)}
        onCreated={(id) => { setDetailId(id); }}
      />

      <CountDetailModal
        countId={detailId}
        open={detailId !== null}
        onClose={() => setDetailId(null)}
      />
    </div>
  );
}
