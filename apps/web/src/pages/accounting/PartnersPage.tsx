import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus,
  Pencil,
  Trash2,
  Users,
  Wallet,
  TrendingUp,
  BarChart3,
  Mail,
  Phone,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { usePermission } from '../../contexts/AuthContext';
import { formatMoney, getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Partner {
  id: number;
  nameAr: string;
  email: string | null;
  phone: string | null;
  capitalRequired: number;
  capitalPaid: number;
  profitSharePct: number;
  currentBalance: number;
  status: 'ACTIVE' | 'INACTIVE';
}

interface PartnerSummary {
  totalCapitalRequired: number;
  totalCapitalPaid: number;
  paymentPct: number;
  netCurrentBalance: number;
  partnerCount: number;
}

// ─── Zod schema ───────────────────────────────────────────────────────────────

const partnerSchema = z.object({
  nameAr: z.string().min(1, 'اسم الشريك مطلوب'),
  email: z.string().email('بريد إلكتروني غير صالح').optional().or(z.literal('')),
  phone: z.string().optional(),
  capitalRequired: z.string().optional(),
  capitalPaid: z.string().optional(),
  profitSharePct: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

type PartnerFormValues = z.infer<typeof partnerSchema>;

// ─── Toast helper ─────────────────────────────────────────────────────────────

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  sub,
  color,
  iconColor,
  subColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  color: string;
  iconColor: string;
  subColor?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5 flex items-center gap-4">
      <div
        className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${color} ${iconColor}`}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs text-app-muted mb-1">{label}</p>
        <p className="text-xl font-bold text-app-text truncate">{value}</p>
        {sub && (
          <p className={`text-xs mt-0.5 font-medium ${subColor ?? 'text-app-muted'}`}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function PartnersPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('partners.create');
  const canEdit = usePermission('partners.edit');
  const canDelete = usePermission('partners.delete');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Partner | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Partner | null>(null);
  const [profitModalOpen, setProfitModalOpen] = useState(false);

  // Partners list
  const { data, isLoading } = useQuery({
    queryKey: ['partners', page, pageSize, search],
    queryFn: async () => {
      const res = await apiClient.get<PaginatedResponse<Partner>>('/partners', {
        params: { page, pageSize, search },
      });
      return res.data;
    },
  });

  // Summary KPIs
  const { data: summary } = useQuery<PartnerSummary>({
    queryKey: ['partners-summary'],
    queryFn: async () => {
      const res = await apiClient.get<PartnerSummary>('/partners/summary');
      return res.data;
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PartnerFormValues>({
    resolver: zodResolver(partnerSchema),
    defaultValues: { status: 'ACTIVE' },
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiClient.post('/partners', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partners'] });
      qc.invalidateQueries({ queryKey: ['partners-summary'] });
      toast('تم تسجيل الشريك بنجاح');
      setModalOpen(false);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء التسجيل'), 'error'),
  });

  const editMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: number;
      body: Record<string, unknown>;
    }) => apiClient.put(`/partners/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partners'] });
      qc.invalidateQueries({ queryKey: ['partners-summary'] });
      toast('تم تعديل بيانات الشريك بنجاح');
      setModalOpen(false);
      setEditTarget(null);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء التعديل'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/partners/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['partners'] });
      qc.invalidateQueries({ queryKey: ['partners-summary'] });
      toast('تم حذف الشريك');
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحذف'), 'error'),
  });

  const openCreate = () => {
    setEditTarget(null);
    reset({
      nameAr: '',
      email: '',
      phone: '',
      capitalRequired: '0',
      capitalPaid: '0',
      profitSharePct: '0',
      status: 'ACTIVE',
    });
    setModalOpen(true);
  };

  const openEdit = (p: Partner) => {
    setEditTarget(p);
    reset({
      nameAr: p.nameAr,
      email: p.email ?? '',
      phone: p.phone ?? '',
      capitalRequired: String(p.capitalRequired ?? 0),
      capitalPaid: String(p.capitalPaid ?? 0),
      profitSharePct: String(p.profitSharePct ?? 0),
      status: p.status,
    });
    setModalOpen(true);
  };

  const onSubmit = (values: PartnerFormValues) => {
    const body: Record<string, unknown> = {
      nameAr: values.nameAr,
      email: values.email || null,
      phone: values.phone || null,
      capitalRequired: values.capitalRequired
        ? parseFloat(values.capitalRequired)
        : 0,
      capitalPaid: values.capitalPaid ? parseFloat(values.capitalPaid) : 0,
      profitSharePct: values.profitSharePct
        ? parseFloat(values.profitSharePct)
        : 0,
      status: values.status,
    };
    if (editTarget) {
      editMutation.mutate({ id: editTarget.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const isSaving = createMutation.isPending || editMutation.isPending;

  // Table columns
  const columns: Column<Partner>[] = [
    {
      key: 'nameAr',
      header: 'اسم الشريك',
      sortable: true,
      render: (row) => (
        <div>
          <p className="font-semibold text-app-text">{row.nameAr}</p>
          <p className="text-xs text-app-muted mt-0.5">رقم الشريك: #{row.id}</p>
        </div>
      ),
    },
    {
      key: 'capitalRequired',
      header: 'رأس المال المقرر',
      render: (row) => (
        <span className="font-mono text-sm">
          {formatMoney(Number(row.capitalRequired))}
        </span>
      ),
    },
    {
      key: 'capitalPaid',
      header: 'رأس المال المسدد',
      render: (row) => (
        <span className="font-mono text-sm text-success font-semibold">
          {formatMoney(Number(row.capitalPaid))}
        </span>
      ),
    },
    {
      key: 'profitSharePct',
      header: 'نسبة الأرباح',
      render: (row) => (
        <span className="font-mono text-sm font-bold text-primary">
          {Number(row.profitSharePct).toFixed(0)}٪
        </span>
      ),
    },
    {
      key: 'currentBalance',
      header: 'الرصيد الجاري',
      render: (row) => {
        const bal = Number(row.currentBalance);
        const isNegative = bal < 0;
        return (
          <Badge variant={isNegative ? 'danger' : 'success'}>
            {isNegative
              ? `عليه: ${formatMoney(Math.abs(bal))}`
              : `له: ${formatMoney(bal)}`}
          </Badge>
        );
      },
    },
    {
      key: 'email',
      header: 'بيانات الاتصال',
      render: (row) => (
        <div className="text-xs text-app-muted space-y-0.5">
          {row.email && (
            <div className="flex items-center gap-1">
              <Mail size={11} />
              <span>{row.email}</span>
            </div>
          )}
          {row.phone && (
            <div className="flex items-center gap-1">
              <Phone size={11} />
              <span className="font-mono">{row.phone}</span>
            </div>
          )}
          {!row.email && !row.phone && (
            <span className="text-app-muted">—</span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (row) => (
        <Badge variant={row.status === 'ACTIVE' ? 'success' : 'danger'}>
          {row.status === 'ACTIVE' ? 'نشط' : 'غير نشط'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'العمليات',
      render: (row) => (
        <div className="flex items-center gap-1">
          {canEdit && (
            <button
              onClick={() => openEdit(row)}
              className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary transition-colors"
              title="تعديل"
            >
              <Pencil size={14} />
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
        title="لوحة تحكم نظام الشركاء"
        subtitle="إدارة حقوق الملكية وحصص الشركاء وتوزيع الأرباح"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => setProfitModalOpen(true)}
              className="border-orange-400 text-orange-600 hover:bg-orange-50"
            >
              توزيع الأرباح الدورية
            </Button>
            {canCreate && (
              <Button icon={<Plus size={16} />} onClick={openCreate}>
                تسجيل شريك جديد
              </Button>
            )}
          </div>
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <KpiCard
          icon={<Wallet size={22} />}
          label="إجمالي رأس المال المقرر"
          value={formatMoney(summary?.totalCapitalRequired ?? 0)}
          color="bg-primary-50"
          iconColor="text-primary"
        />
        <KpiCard
          icon={<TrendingUp size={22} />}
          label="رأس المال المدفوع فعلياً"
          value={formatMoney(summary?.totalCapitalPaid ?? 0)}
          sub={`نسبة السداد: ${summary?.paymentPct ?? 0}٪`}
          color="bg-success-bg"
          iconColor="text-success"
          subColor="text-success"
        />
        <KpiCard
          icon={<BarChart3 size={22} />}
          label="صافي الحسابات الجارية"
          value={formatMoney(summary?.netCurrentBalance ?? 0)}
          sub={
            (summary?.netCurrentBalance ?? 0) < 0
              ? 'مدين للشركاء عليه'
              : 'رصيد موجب'
          }
          color={
            (summary?.netCurrentBalance ?? 0) < 0
              ? 'bg-danger-bg'
              : 'bg-success-bg'
          }
          iconColor={
            (summary?.netCurrentBalance ?? 0) < 0
              ? 'text-danger'
              : 'text-success'
          }
          subColor={
            (summary?.netCurrentBalance ?? 0) < 0 ? 'text-danger' : 'text-success'
          }
        />
        <KpiCard
          icon={<Users size={22} />}
          label="الشركاء المساهمين"
          value={String(summary?.partnerCount ?? 0)}
          color="bg-purple-50"
          iconColor="text-purple-600"
        />
      </div>

      {/* Partners Table */}
      <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5">
        <div className="mb-4">
          <h3 className="font-bold text-app-text text-base">
            بيانات الشركاء والحصص المالية بالتفصيل
          </h3>
          <p className="text-sm text-app-muted mt-0.5">
            جميع بيانات رأس المال ونسب توزيع الأرباح
          </p>
        </div>
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
          emptyText="لا يوجد شركاء — أضف شريكاً جديداً"
        />
      </div>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditTarget(null);
          reset();
        }}
        title={editTarget ? 'تعديل بيانات الشريك' : 'تسجيل شريك جديد'}
        size="lg"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setModalOpen(false);
                setEditTarget(null);
                reset();
              }}
            >
              إلغاء
            </Button>
            <Button loading={isSaving} onClick={handleSubmit(onSubmit)}>
              {editTarget ? 'حفظ التعديلات' : 'تسجيل الشريك'}
            </Button>
          </>
        }
      >
        <form
          className="grid grid-cols-2 gap-4"
          onSubmit={handleSubmit(onSubmit)}
        >
          <Input
            label="اسم الشريك"
            required
            placeholder="الاسم الكامل"
            {...register('nameAr')}
            error={errors.nameAr?.message}
            className="col-span-2"
          />
          <Input
            label="البريد الإلكتروني"
            placeholder="example@domain.com"
            type="email"
            {...register('email')}
            error={errors.email?.message}
          />
          <Input
            label="رقم الهاتف"
            placeholder="05xxxxxxxx"
            {...register('phone')}
            error={errors.phone?.message}
          />
          <Input
            label="رأس المال المقرر (ر.س)"
            type="number"
            step="0.01"
            placeholder="0.00"
            {...register('capitalRequired')}
            error={errors.capitalRequired?.message}
          />
          <Input
            label="رأس المال المسدد (ر.س)"
            type="number"
            step="0.01"
            placeholder="0.00"
            {...register('capitalPaid')}
            error={errors.capitalPaid?.message}
          />
          <Input
            label="نسبة توزيع الأرباح (%)"
            type="number"
            step="0.01"
            min="0"
            max="100"
            placeholder="0"
            {...register('profitSharePct')}
            error={errors.profitSharePct?.message}
          />
          <Select
            label="الحالة"
            {...register('status')}
            error={errors.status?.message}
          >
            <option value="ACTIVE">نشط</option>
            <option value="INACTIVE">غير نشط</option>
          </Select>
        </form>
      </Modal>

      {/* Profit Distribution Info Modal */}
      <Modal
        open={profitModalOpen}
        onClose={() => setProfitModalOpen(false)}
        title="توزيع الأرباح الدورية"
        size="sm"
        footer={
          <Button onClick={() => setProfitModalOpen(false)}>إغلاق</Button>
        }
      >
        <div className="text-sm text-app-text space-y-3">
          <p>
            يتم توزيع الأرباح على الشركاء وفق النسب المحددة لكل شريك في
            بيانات الحساب.
          </p>
          <div className="bg-primary-50 rounded-xl p-4">
            <p className="font-semibold text-primary mb-2">ملخص النسب الحالية:</p>
            {(data?.data ?? []).map((p) => (
              <div key={p.id} className="flex justify-between text-xs py-1 border-b border-primary-50 last:border-0">
                <span className="text-app-text">{p.nameAr}</span>
                <span className="font-bold text-primary">
                  {Number(p.profitSharePct).toFixed(0)}٪
                </span>
              </div>
            ))}
          </div>
          <p className="text-app-muted text-xs">
            لتنفيذ التوزيع الفعلي، يرجى مراجعة المحاسب المالي لإدخال القيود
            المحاسبية اللازمة.
          </p>
        </div>
      </Modal>

      {/* Delete Confirm */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="تأكيد حذف الشريك"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              إلغاء
            </Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.id)
              }
            >
              حذف الشريك
            </Button>
          </>
        }
      >
        <p className="text-sm text-app-text">
          هل تريد حذف الشريك{' '}
          <span className="font-bold">{deleteTarget?.nameAr}</span>؟ لن يمكن
          التراجع عن هذا الإجراء.
        </p>
      </Modal>
    </div>
  );
}
