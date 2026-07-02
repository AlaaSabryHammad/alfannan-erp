import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, TrendingDown } from 'lucide-react';
import apiClient from '../../lib/api';
import { usePermission } from '../../contexts/AuthContext';
import { formatMoney, formatDate, getApiErrorMessage } from '../../lib/utils';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import type { PaginatedResponse, PaginationMeta } from '../../types';

type AssetCategory = 'EQUIPMENT' | 'VEHICLE' | 'FURNITURE' | 'BUILDING' | 'OTHER';
type AssetStatus = 'ACTIVE' | 'DISPOSED';

interface FixedAsset {
  id: number;
  assetCode: string;
  nameAr: string;
  category: AssetCategory;
  purchaseDate: string;
  purchaseCost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  accumulatedDepreciation: number;
  bookValue: number;
  status: AssetStatus;
  description: string | null;
}

interface AssetKpis {
  totalCost: number;
  totalAccumulatedDepreciation: number;
  totalBookValue: number;
  count: number;
}

interface AssetsResponse {
  data: FixedAsset[];
  pagination: PaginationMeta;
  kpis: AssetKpis;
}

const CATEGORY_LABEL: Record<AssetCategory, string> = {
  EQUIPMENT: 'معدات',
  VEHICLE: 'مركبات',
  FURNITURE: 'أثاث',
  BUILDING: 'عقارات',
  OTHER: 'أخرى',
};

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2500);
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="bg-white rounded-2xl border border-app-border shadow-sm p-4">
      <p className="text-xs text-app-muted mb-1">{label}</p>
      <p className={`text-lg font-bold ${tone}`}>{value}</p>
    </div>
  );
}

export function FixedAssetsPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('assets.create');
  const canDelete = usePermission('assets.delete');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FixedAsset | null>(null);

  const { data, isLoading } = useQuery<AssetsResponse>({
    queryKey: ['fixed-assets', page, pageSize, search],
    queryFn: async () => {
      const res = await apiClient.get<AssetsResponse>('/fixed-assets', {
        params: { page, pageSize, search },
      });
      return res.data;
    },
  });

  const depreciateMutation = useMutation({
    mutationFn: (id: number) => apiClient.post(`/fixed-assets/${id}/depreciate`, {}),
    onSuccess: (res) => {
      toast(`تم ترحيل إهلاك شهري بقيمة ${formatMoney(res.data.depreciationAmount)} ✓`);
      qc.invalidateQueries({ queryKey: ['fixed-assets'] });
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر ترحيل الإهلاك'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/fixed-assets/${id}`),
    onSuccess: () => {
      toast('تم حذف الأصل وعكس قيوده ✓');
      qc.invalidateQueries({ queryKey: ['fixed-assets'] });
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر حذف الأصل'), 'error'),
  });

  const kpis = data?.kpis;

  const columns: Array<Column<FixedAsset>> = [
    {
      key: 'assetCode',
      header: 'رمز الأصل',
      render: (r) => <span className="font-mono font-medium">{r.assetCode}</span>,
    },
    {
      key: 'nameAr',
      header: 'اسم الأصل',
      render: (r) => (
        <div>
          <p className="font-medium text-app-text">{r.nameAr}</p>
          <p className="text-xs text-app-muted">{r.description ?? '—'}</p>
        </div>
      ),
    },
    {
      key: 'category',
      header: 'الفئة',
      render: (r) => <Badge variant="info">{CATEGORY_LABEL[r.category]}</Badge>,
    },
    {
      key: 'purchaseCost',
      header: 'تكلفة الشراء',
      render: (r) => <span className="font-mono">{formatMoney(r.purchaseCost)}</span>,
    },
    {
      key: 'accumulatedDepreciation',
      header: 'مجمع الإهلاك',
      render: (r) => <span className="font-mono text-app-muted">− {formatMoney(r.accumulatedDepreciation)}</span>,
    },
    {
      key: 'bookValue',
      header: 'القيمة الدفترية',
      render: (r) => <span className="font-mono font-bold text-primary">{formatMoney(r.bookValue)}</span>,
    },
    {
      key: 'usefulLifeMonths',
      header: 'العمر (شهر)',
      render: (r) => <span className="text-app-muted">{r.usefulLifeMonths}</span>,
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (r) => <Badge variant={r.status === 'ACTIVE' ? 'success' : 'default'}>{r.status === 'ACTIVE' ? 'نشط' : 'متخلص منه'}</Badge>,
    },
    {
      key: 'actions',
      header: 'إجراءات',
      render: (r) => (
        <div className="flex items-center gap-1">
          {canCreate && r.status === 'ACTIVE' && (
            <button
              onClick={() => depreciateMutation.mutate(r.id)}
              disabled={depreciateMutation.isPending}
              title="ترحيل إهلاك شهري"
              className="p-1.5 text-app-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
            >
              <TrendingDown size={16} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => setDeleteTarget(r)}
              title="حذف"
              className="p-1.5 text-app-muted hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="الأصول الثابتة"
        subtitle="إدارة الأصول وحساب الإهلاك الشهري وترحيله محاسبياً"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
              أصل جديد
            </Button>
          ) : null
        }
      />

      {/* KPIs */}
      {kpis && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <KpiCard label="عدد الأصول" value={String(kpis.count)} tone="text-app-text" />
          <KpiCard label="إجمالي التكلفة" value={formatMoney(kpis.totalCost)} tone="text-primary" />
          <KpiCard label="مجمع الإهلاك" value={formatMoney(kpis.totalAccumulatedDepreciation)} tone="text-danger" />
          <KpiCard label="صافي القيمة الدفترية" value={formatMoney(kpis.totalBookValue)} tone="text-success" />
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5">
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          pagination={data?.pagination as PaginationMeta | undefined}
          loading={isLoading}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
          onSearch={(q) => {
            setSearch(q);
            setPage(1);
          }}
          searchValue={search}
          rowKey={(r) => r.id}
          emptyText="لا توجد أصول ثابتة بعد"
          exportTitle="تقرير الأصول الثابتة"
        />
      </div>

      {createOpen && (
        <CreateAssetModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ['fixed-assets'] });
          }}
        />
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="تأكيد الحذف"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              إلغاء
            </Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              حذف وعكس القيود
            </Button>
          </>
        }
      >
        <p className="text-sm text-app-text">
          سيتم حذف الأصل <span className="font-bold">{deleteTarget?.nameAr}</span> وعكس جميع قيوده (الشراء والإهلاكات).
        </p>
      </Modal>
    </div>
  );
}

// ── Create asset modal ────────────────────────────────────────────────────────
function CreateAssetModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [nameAr, setNameAr] = useState('');
  const [category, setCategory] = useState<AssetCategory>('EQUIPMENT');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [purchaseCost, setPurchaseCost] = useState('');
  const [salvageValue, setSalvageValue] = useState('');
  const [usefulLifeMonths, setUsefulLifeMonths] = useState('');
  const [description, setDescription] = useState('');

  const mutation = useMutation({
    mutationFn: (payload: unknown) => apiClient.post('/fixed-assets', payload),
    onSuccess: () => {
      toast('تم إنشاء الأصل وقيد الشراء بنجاح ✓');
      onCreated();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر إنشاء الأصل'), 'error'),
  });

  function handleSubmit() {
    if (!nameAr || !purchaseCost || !usefulLifeMonths) {
      toast('يرجى إدخال الاسم والتكلفة والعمر', 'error');
      return;
    }
    mutation.mutate({
      nameAr,
      category,
      purchaseDate,
      purchaseCost: Number(purchaseCost),
      salvageValue: Number(salvageValue) || 0,
      usefulLifeMonths: Number(usefulLifeMonths),
      description: description || undefined,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="أصل ثابت جديد"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={handleSubmit} loading={mutation.isPending}>
            حفظ وقيد الشراء
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input label="اسم الأصل" value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="مثال: كمبيوتر مكتبي" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label="الفئة" value={category} onChange={(e) => setCategory(e.target.value as AssetCategory)}>
            <option value="EQUIPMENT">معدات</option>
            <option value="VEHICLE">مركبات</option>
            <option value="FURNITURE">أثاث</option>
            <option value="BUILDING">عقارات</option>
            <option value="OTHER">أخرى</option>
          </Select>
          <Input label="تاريخ الشراء" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input label="تكلفة الشراء (ر.س)" type="number" value={purchaseCost} onChange={(e) => setPurchaseCost(e.target.value)} />
          <Input label="القيمة المتبقية" type="number" value={salvageValue} onChange={(e) => setSalvageValue(e.target.value)} placeholder="0" />
          <Input label="العمر الافتراضي (شهر)" type="number" value={usefulLifeMonths} onChange={(e) => setUsefulLifeMonths(e.target.value)} />
        </div>
        <Input label="الوصف (اختياري)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <div className="bg-primary-50 rounded-lg p-3 text-xs text-app-muted">
          سيتم إنشاء قيد محاسبي تلقائي: مدين «الأصول الثابتة» / دائن «النقدية» بقيمة التكلفة. يمكن ترحيل الإهلاك شهرياً لاحقاً.
        </div>
      </div>
    </Modal>
  );
}
