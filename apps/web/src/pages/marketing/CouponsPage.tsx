import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, Ticket } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { usePermission } from '../../contexts/AuthContext';
import { formatMoney, formatDate, getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

type CouponType = 'PERCENTAGE' | 'FIXED';

interface Coupon {
  id: number;
  code: string;
  type: CouponType;
  value: number;
  minPurchaseAmount: number;
  maxDiscountAmount: number | null;
  validFrom: string | null;
  validTo: string | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  createdAt: string;
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

const fetchCoupons = async (params: { page: number; pageSize: number; search: string }) =>
  (await apiClient.get<PaginatedResponse<Coupon>>('/coupons', { params })).data;

function isExpired(c: Coupon): boolean {
  if (c.validTo && new Date(c.validTo) < new Date()) return true;
  if (c.usageLimit !== null && c.usedCount >= c.usageLimit) return true;
  return false;
}

// ─── Create / Edit Modal ──────────────────────────────────────────────────────

function CouponFormModal({
  open,
  onClose,
  editTarget,
}: {
  open: boolean;
  onClose: () => void;
  editTarget: Coupon | null;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState(editTarget?.code ?? '');
  const [type, setType] = useState<CouponType>(editTarget?.type ?? 'PERCENTAGE');
  const [value, setValue] = useState(editTarget ? String(editTarget.value) : '');
  const [minPurchaseAmount, setMinPurchaseAmount] = useState(editTarget ? String(editTarget.minPurchaseAmount) : '0');
  const [maxDiscountAmount, setMaxDiscountAmount] = useState(editTarget?.maxDiscountAmount != null ? String(editTarget.maxDiscountAmount) : '');
  const [validFrom, setValidFrom] = useState(editTarget?.validFrom ? editTarget.validFrom.slice(0, 10) : '');
  const [validTo, setValidTo] = useState(editTarget?.validTo ? editTarget.validTo.slice(0, 10) : '');
  const [usageLimit, setUsageLimit] = useState(editTarget?.usageLimit != null ? String(editTarget.usageLimit) : '');
  const [isActive, setIsActive] = useState(editTarget?.isActive ?? true);
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        code,
        type,
        value: parseFloat(value),
        minPurchaseAmount: minPurchaseAmount ? parseFloat(minPurchaseAmount) : 0,
        maxDiscountAmount: maxDiscountAmount ? parseFloat(maxDiscountAmount) : null,
        validFrom: validFrom || null,
        validTo: validTo || null,
        usageLimit: usageLimit ? parseInt(usageLimit) : null,
        isActive,
      };
      return editTarget ? apiClient.put(`/coupons/${editTarget.id}`, body) : apiClient.post('/coupons', body);
    },
    onSuccess: () => {
      toast(editTarget ? 'تم تحديث الكوبون ✓' : 'تم إنشاء الكوبون ✓');
      qc.invalidateQueries({ queryKey: ['coupons'] });
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'حدث خطأ أثناء الحفظ')),
  });

  const handleSubmit = () => {
    if (!code.trim() || !value || Number(value) <= 0) {
      setError('يرجى إدخال كود الكوبون وقيمة صحيحة');
      return;
    }
    setError('');
    mutation.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editTarget ? `تعديل كوبون ${editTarget.code}` : 'كوبون خصم جديد'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button loading={mutation.isPending} onClick={handleSubmit}>حفظ</Button>
        </>
      }
    >
      <div dir="rtl" className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="كود الكوبون" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="مثال: RAMADAN25" />
          <Select label="نوع الخصم" value={type} onChange={(e) => setType(e.target.value as CouponType)}>
            <option value="PERCENTAGE">نسبة %</option>
            <option value="FIXED">مبلغ ثابت</option>
          </Select>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input
            label={type === 'PERCENTAGE' ? 'نسبة الخصم %' : 'مبلغ الخصم'}
            type="number"
            step="0.01"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          {type === 'PERCENTAGE' && (
            <Input
              label="سقف الخصم الأقصى (اختياري)"
              type="number"
              step="0.01"
              value={maxDiscountAmount}
              onChange={(e) => setMaxDiscountAmount(e.target.value)}
            />
          )}
        </div>

        <Input
          label="الحد الأدنى لقيمة الفاتورة (اختياري)"
          type="number"
          step="0.01"
          value={minPurchaseAmount}
          onChange={(e) => setMinPurchaseAmount(e.target.value)}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="ساري من (اختياري)" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
          <Input label="ساري حتى (اختياري)" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
        </div>

        <Input
          label="الحد الأقصى لعدد مرات الاستخدام (اختياري)"
          type="number"
          value={usageLimit}
          onChange={(e) => setUsageLimit(e.target.value)}
          placeholder="بلا حد"
        />

        <label className="flex items-center gap-2 text-sm font-medium text-app-text">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-4 h-4" />
          مُفعّل
        </label>

        {error && <div className="bg-danger-bg text-danger text-sm font-medium px-4 py-2.5 rounded-lg">{error}</div>}
      </div>
    </Modal>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function CouponsPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('marketing.create');
  const canDelete = usePermission('marketing.delete');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Coupon | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Coupon | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['coupons', page, pageSize, search],
    queryFn: () => fetchCoupons({ page, pageSize, search }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/coupons/${id}`),
    onSuccess: () => {
      toast('تم حذف الكوبون ✓');
      qc.invalidateQueries({ queryKey: ['coupons'] });
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر الحذف'), 'error'),
  });

  const columns: Column<Coupon>[] = [
    { key: 'code', header: 'الكود', render: (row) => <span className="font-mono font-bold text-primary">{row.code}</span> },
    {
      key: 'value',
      header: 'الخصم',
      render: (row) => (row.type === 'PERCENTAGE' ? `${Number(row.value)}%` : formatMoney(row.value)),
    },
    {
      key: 'minPurchaseAmount',
      header: 'الحد الأدنى للشراء',
      render: (row) => (Number(row.minPurchaseAmount) > 0 ? formatMoney(row.minPurchaseAmount) : '—'),
    },
    {
      key: 'usage',
      header: 'الاستخدام',
      render: (row) => `${row.usedCount} ${row.usageLimit !== null ? `/ ${row.usageLimit}` : ''}`,
    },
    {
      key: 'validTo',
      header: 'الصلاحية',
      render: (row) => (row.validTo ? formatDate(row.validTo) : 'بلا انتهاء'),
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (row) => {
        if (!row.isActive) return <Badge variant="default">معطّل</Badge>;
        if (isExpired(row)) return <Badge variant="danger">منتهي</Badge>;
        return <Badge variant="success">فعّال</Badge>;
      },
    },
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
        title="كوبونات الخصم"
        subtitle="أكواد خصم تُطبّق في شاشة نقاط البيع — بنسبة % أو بمبلغ ثابت، مع حدود استخدام اختيارية"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={() => { setEditTarget(null); setFormOpen(true); }}>
              كوبون جديد
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
          emptyText="لا توجد كوبونات خصم بعد"
        />
        {(data?.data.length ?? 0) === 0 && !isLoading && (
          <div className="flex items-center gap-3 mt-2 py-4 px-4 bg-primary-50 rounded-xl">
            <Ticket size={22} className="text-primary flex-shrink-0" />
            <p className="text-sm text-primary/90">أنشئ كوبون خصم ليتمكن الكاشير من تطبيقه في شاشة نقاط البيع عبر إدخال الكود.</p>
          </div>
        )}
      </div>

      {formOpen && (
        <CouponFormModal
          key={editTarget?.id ?? 'new'}
          open={formOpen}
          onClose={() => setFormOpen(false)}
          editTarget={editTarget}
        />
      )}

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
          سيتم حذف كوبون <span className="font-mono font-bold">{deleteTarget?.code}</span>.
          إذا كان مستخدَماً في فواتير سابقة، عطّله بدلاً من حذفه.
        </p>
      </Modal>
    </div>
  );
}
