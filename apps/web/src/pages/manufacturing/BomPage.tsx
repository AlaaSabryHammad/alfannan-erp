import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Layers } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { usePermission } from '../../contexts/AuthContext';
import { getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginatedResponse } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ProductLite {
  id: number;
  nameAr: string;
  sku: string;
  costPrice?: number;
  unit?: { nameAr: string } | null;
}

interface BomLine {
  id?: number;
  componentId: number;
  qtyPerUnit: number;
  component?: ProductLite;
}

interface Bom {
  id: number;
  productId: number;
  notes: string | null;
  product: ProductLite;
  lines: BomLine[];
}

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

const fetchBoms = async (): Promise<Bom[]> => (await apiClient.get<Bom[]>('/bom')).data;
const fetchProductsAll = async (): Promise<ProductLite[]> =>
  (await apiClient.get<PaginatedResponse<ProductLite>>('/products', { params: { page: 1, pageSize: 1000 } })).data.data;

// ─── Create / Edit Modal ──────────────────────────────────────────────────────

function BomFormModal({
  open,
  onClose,
  editTarget,
}: {
  open: boolean;
  onClose: () => void;
  editTarget: Bom | null;
}) {
  const qc = useQueryClient();
  // The parent remounts this component (via `key`) whenever editTarget changes,
  // so it's safe to seed state directly from editTarget here.
  const [productId, setProductId] = useState(editTarget ? String(editTarget.productId) : '');
  const [notes, setNotes] = useState(editTarget?.notes ?? '');
  const [lines, setLines] = useState<{ componentId: string; qtyPerUnit: string }[]>(
    editTarget ? editTarget.lines.map((l) => ({ componentId: String(l.componentId), qtyPerUnit: String(l.qtyPerUnit) })) : [{ componentId: '', qtyPerUnit: '' }]
  );
  const [error, setError] = useState('');

  const { data: products = [] } = useQuery({ queryKey: ['products', 'bom'], queryFn: fetchProductsAll, enabled: open });

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        productId: parseInt(productId),
        notes: notes || undefined,
        lines: lines
          .filter((l) => l.componentId && l.qtyPerUnit)
          .map((l) => ({ componentId: parseInt(l.componentId), qtyPerUnit: parseFloat(l.qtyPerUnit) })),
      };
      return editTarget ? apiClient.put(`/bom/${editTarget.id}`, body) : apiClient.post('/bom', body);
    },
    onSuccess: () => {
      toast(editTarget ? 'تم تحديث قائمة المكونات ✓' : 'تم إنشاء قائمة المكونات ✓');
      qc.invalidateQueries({ queryKey: ['bom'] });
      handleClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'حدث خطأ أثناء الحفظ')),
  });

  const handleClose = () => {
    setProductId('');
    setNotes('');
    setLines([{ componentId: '', qtyPerUnit: '' }]);
    setError('');
    onClose();
  };

  const handleSubmit = () => {
    if (!productId) {
      setError('يرجى اختيار المنتج النهائي');
      return;
    }
    const validLines = lines.filter((l) => l.componentId && l.qtyPerUnit);
    if (validLines.length === 0) {
      setError('يرجى إضافة مكوّن واحد على الأقل');
      return;
    }
    setError('');
    mutation.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={editTarget ? `تعديل قائمة مكونات — ${editTarget.product.nameAr}` : 'قائمة مكونات جديدة'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>إلغاء</Button>
          <Button loading={mutation.isPending} onClick={handleSubmit}>حفظ</Button>
        </>
      }
    >
      <div dir="rtl" className="space-y-4">
        <Select label="المنتج النهائي" value={productId} onChange={(e) => setProductId(e.target.value)} disabled={!!editTarget}>
          <option value="">— اختر المنتج —</option>
          {products.map((p) => (
            <option key={p.id} value={String(p.id)}>{p.nameAr} ({p.sku})</option>
          ))}
        </Select>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-medium text-app-text">المكوّنات (المواد الخام)</label>
            <button
              type="button"
              onClick={() => setLines((prev) => [...prev, { componentId: '', qtyPerUnit: '' }])}
              className="text-xs text-primary font-medium hover:underline"
            >
              + إضافة مكوّن
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="flex-1">
                  <Select
                    value={line.componentId}
                    onChange={(e) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, componentId: e.target.value } : l)))}
                  >
                    <option value="">— اختر المكوّن —</option>
                    {products.filter((p) => String(p.id) !== productId).map((p) => (
                      <option key={p.id} value={String(p.id)}>{p.nameAr} ({p.sku})</option>
                    ))}
                  </Select>
                </div>
                <div className="w-36">
                  <Input
                    type="number"
                    step="0.0001"
                    placeholder="الكمية / وحدة"
                    value={line.qtyPerUnit}
                    onChange={(e) => setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, qtyPerUnit: e.target.value } : l)))}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}
                  disabled={lines.length === 1}
                  className="p-2 text-app-muted hover:text-danger disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        </div>

        <Input label="ملاحظات (اختياري)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && <div className="bg-danger-bg text-danger text-sm font-medium px-4 py-2.5 rounded-lg">{error}</div>}
      </div>
    </Modal>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function BomPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('manufacturing.create');
  const canDelete = usePermission('manufacturing.delete');
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Bom | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Bom | null>(null);

  const { data: boms = [], isLoading } = useQuery({ queryKey: ['bom'], queryFn: fetchBoms });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/bom/${id}`),
    onSuccess: () => {
      toast('تم حذف قائمة المكونات ✓');
      qc.invalidateQueries({ queryKey: ['bom'] });
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر الحذف'), 'error'),
  });

  const columns: Column<Bom>[] = [
    {
      key: 'product',
      header: 'المنتج النهائي',
      render: (row) => (
        <div>
          <div className="font-medium">{row.product.nameAr}</div>
          <div className="text-xs text-app-muted font-mono">{row.product.sku}</div>
        </div>
      ),
    },
    {
      key: 'lines',
      header: 'المكوّنات',
      render: (row) => (
        <div className="flex flex-wrap gap-1">
          {row.lines.map((l) => (
            <span key={l.componentId} className="text-xs bg-gray-100 rounded-full px-2 py-0.5">
              {l.component?.nameAr} × {Number(l.qtyPerUnit).toLocaleString('en-US')}
            </span>
          ))}
        </div>
      ),
    },
    { key: 'notes', header: 'ملاحظات', render: (row) => row.notes ?? '—' },
    {
      key: 'actions',
      header: 'إجراءات',
      render: (row) => (
        <div className="flex items-center gap-1">
          {canCreate && (
            <button
              onClick={() => { setEditTarget(row); setFormOpen(true); }}
              className="p-1.5 text-app-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
              title="تعديل"
            >
              <Pencil size={15} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => setDeleteTarget(row)}
              className="p-1.5 text-app-muted hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
              title="حذف"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="قوائم المكونات (BOM)"
        subtitle="تعريف المواد الخام والكميات اللازمة لتصنيع كل منتج نهائي"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={() => { setEditTarget(null); setFormOpen(true); }}>
              قائمة مكونات جديدة
            </Button>
          ) : undefined
        }
      />

      <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5">
        <DataTable
          columns={columns}
          data={boms}
          loading={isLoading}
          rowKey={(r) => r.id}
          emptyText="لا توجد قوائم مكونات معرّفة بعد"
        />
        {boms.length === 0 && !isLoading && (
          <div className="flex items-center gap-3 mt-2 py-4 px-4 bg-primary-50 rounded-xl">
            <Layers size={22} className="text-primary flex-shrink-0" />
            <p className="text-sm text-primary/90">عرّف قائمة مكونات لكل منتج تصنّعه محلياً حتى تتمكن من إنشاء أوامر تصنيع له.</p>
          </div>
        )}
      </div>

      <BomFormModal
        key={editTarget?.id ?? 'new'}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        editTarget={editTarget}
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
          سيتم حذف قائمة مكونات <span className="font-bold">{deleteTarget?.product.nameAr}</span>.
          لا يمكن الحذف إذا كانت مرتبطة بأوامر تصنيع سابقة.
        </p>
      </Modal>
    </div>
  );
}
