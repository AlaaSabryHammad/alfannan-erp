import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Users, UserCheck, Wallet, FileText, Printer } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { usePermission } from '../../contexts/AuthContext';
import { formatMoney, formatDate, getApiErrorMessage } from '../../lib/utils';
import { printStatement } from '../../lib/print';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

// --- Types ---
interface Supplier {
  id: number;
  nameAr: string;
  company: string | null;
  phone: string | null;
  openingBalance: number;
  currentBalance: number;
  status: 'ACTIVE' | 'INACTIVE';
}

// --- Zod schema ---
const supplierSchema = z.object({
  nameAr: z.string().min(1, 'اسم المورد مطلوب'),
  company: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  openingBalance: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
});

type SupplierFormValues = z.infer<typeof supplierSchema>;

// --- Toast helper ---
function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// --- API helpers ---
const fetchSuppliers = async (params: { page: number; pageSize: number; search: string }) => {
  const res = await apiClient.get<PaginatedResponse<Supplier>>('/suppliers', { params });
  return res.data;
};

// --- KPI Card ---
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

// --- Statement (كشف حساب) Modal ---
interface StatementLine {
  date: string;
  refNo: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
}

interface StatementData {
  supplier: { id: number; nameAr: string; company: string | null };
  openingBalance: number;
  lines: StatementLine[];
  closingBalance: number;
}

function StatementModal({
  supplierId,
  supplierName,
  open,
  onClose,
}: {
  supplierId: number | null;
  supplierName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<StatementData>({
    queryKey: ['supplier-statement', supplierId],
    queryFn: async () => (await apiClient.get<StatementData>(`/suppliers/${supplierId}/statement`)).data,
    enabled: open && supplierId !== null,
  });

  const handlePrint = () => {
    if (!data) return;
    printStatement({
      docTitle: 'كشف حساب مورد',
      partyLabel: 'المورد',
      partyName: supplierName,
      openingBalance: data.openingBalance,
      lines: data.lines,
      closingBalance: data.closingBalance,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`كشف حساب: ${supplierName}`}
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
          <Button icon={<Printer size={15} />} disabled={!data} onClick={handlePrint}>طباعة كشف الحساب</Button>
        </>
      }
    >
      {isLoading ? (
        <div className="py-8 text-center text-app-muted text-sm">جارٍ التحميل...</div>
      ) : !data ? (
        <div className="py-8 text-center text-app-muted text-sm">لا توجد بيانات</div>
      ) : (
        <div dir="rtl">
          <div className="flex items-center justify-between mb-4 bg-gray-50 rounded-xl px-4 py-3">
            <div>
              <p className="text-xs text-app-muted mb-0.5">الرصيد الافتتاحي</p>
              <p className="font-mono font-bold text-sm">{formatMoney(data.openingBalance)}</p>
            </div>
            <div className="text-left">
              <p className="text-xs text-app-muted mb-0.5">الرصيد الختامي (مستحق للمورد)</p>
              <p className={`font-mono font-bold text-sm ${data.closingBalance > 0 ? 'text-danger' : 'text-success'}`}>
                {formatMoney(data.closingBalance)}
              </p>
            </div>
          </div>

          {data.lines.length === 0 ? (
            <div className="py-10 text-center bg-gray-50 rounded-xl">
              <FileText size={32} className="text-app-muted mx-auto mb-2" />
              <p className="text-app-muted text-sm">لا توجد حركات لهذا المورد</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-app-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-app-border text-app-muted">
                    <th className="text-right px-3 py-2.5 font-semibold">التاريخ</th>
                    <th className="text-right px-3 py-2.5 font-semibold">البيان</th>
                    <th className="text-right px-3 py-2.5 font-semibold w-28">مدين</th>
                    <th className="text-right px-3 py-2.5 font-semibold w-28">دائن</th>
                    <th className="text-right px-3 py-2.5 font-semibold w-32">الرصيد الجاري</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((line, idx) => (
                    <tr key={idx} className="border-b border-app-border/60 hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap text-app-muted">{formatDate(line.date)}</td>
                      <td className="px-3 py-2 text-app-text max-w-xs truncate">{line.description}</td>
                      <td className="px-3 py-2 font-mono font-bold text-primary">
                        {line.debit > 0 ? formatMoney(line.debit) : '—'}
                      </td>
                      <td className="px-3 py-2 font-mono font-bold text-success">
                        {line.credit > 0 ? formatMoney(line.credit) : '—'}
                      </td>
                      <td className={`px-3 py-2 font-mono font-bold ${line.balance < 0 ? 'text-danger' : 'text-app-text'}`}>
                        {formatMoney(line.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

// --- Component ---
export function SuppliersPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('suppliers.create');
  const canEdit = usePermission('suppliers.edit');
  const canDelete = usePermission('suppliers.delete');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Supplier | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Supplier | null>(null);
  const [statementTarget, setStatementTarget] = useState<Supplier | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', page, pageSize, search],
    queryFn: () => fetchSuppliers({ page, pageSize, search }),
  });

  // Fetch all suppliers for KPIs (large page)
  const { data: allData } = useQuery({
    queryKey: ['suppliers', 'all'],
    queryFn: () => fetchSuppliers({ page: 1, pageSize: 1000, search: '' }),
    staleTime: 1000 * 60 * 2,
  });

  const allSuppliers = allData?.data ?? [];
  const totalSuppliers = allData?.pagination.total ?? 0;
  const activeSuppliers = allSuppliers.filter((s) => s.status === 'ACTIVE').length;
  const totalDue = allSuppliers.reduce((sum, s) => sum + Number(s.currentBalance ?? 0), 0);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<SupplierFormValues>({
    resolver: zodResolver(supplierSchema),
    defaultValues: { status: 'ACTIVE' },
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/suppliers', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      toast('تم إضافة المورد بنجاح');
      setModalOpen(false);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الإضافة'), 'error'),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiClient.put(`/suppliers/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      toast('تم تعديل بيانات المورد بنجاح');
      setModalOpen(false);
      setEditTarget(null);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء التعديل'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/suppliers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['suppliers'] });
      toast('تم حذف المورد');
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحذف'), 'error'),
  });

  const openCreate = () => {
    setEditTarget(null);
    reset({ nameAr: '', company: '', phone: '', openingBalance: '', status: 'ACTIVE' });
    setModalOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditTarget(s);
    reset({
      nameAr: s.nameAr,
      company: s.company ?? '',
      phone: s.phone ?? '',
      openingBalance: String(s.openingBalance ?? 0),
      status: s.status,
    });
    setModalOpen(true);
  };

  const onSubmit = (values: SupplierFormValues) => {
    const body: Record<string, unknown> = {
      nameAr: values.nameAr,
      company: values.company || null,
      phone: values.phone || null,
      openingBalance: values.openingBalance ? parseFloat(values.openingBalance) : 0,
      status: values.status,
    };
    if (editTarget) {
      editMutation.mutate({ id: editTarget.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const columns: Column<Supplier>[] = [
    { key: 'nameAr', header: 'المورد', sortable: true },
    {
      key: 'company',
      header: 'الشركة',
      render: (row) =>
        row.company ? (
          <span>{row.company}</span>
        ) : (
          <span className="text-app-muted text-xs">—</span>
        ),
    },
    {
      key: 'phone',
      header: 'رقم الهاتف',
      render: (row) =>
        row.phone ? (
          <span className="font-mono text-sm">{row.phone}</span>
        ) : (
          <span className="text-app-muted text-xs">—</span>
        ),
    },
    {
      key: 'openingBalance',
      header: 'الرصيد الافتتاحي',
      render: (row) => <span className="font-mono text-xs">{formatMoney(Number(row.openingBalance))}</span>,
    },
    {
      key: 'currentBalance',
      header: 'الرصيد الحالي',
      render: (row) => (
        <span className={`font-mono text-xs font-semibold ${Number(row.currentBalance) > 0 ? 'text-danger' : 'text-success'}`}>
          {formatMoney(Number(row.currentBalance))}
        </span>
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
      header: 'إجراءات',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setStatementTarget(row)}
            className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary transition-colors"
            title="كشف حساب"
          >
            <FileText size={14} />
          </button>
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

  const isSaving = createMutation.isPending || editMutation.isPending;

  return (
    <div>
      <PageHeader
        title="الموردون"
        subtitle="إدارة بيانات الموردين والحسابات"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={openCreate}>
              إضافة مورد جديد
            </Button>
          ) : undefined
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard
          icon={<Users size={22} className="text-primary" />}
          label="إجمالي الموردين"
          value={totalSuppliers.toLocaleString('ar-EG')}
          color="bg-primary-50"
        />
        <KpiCard
          icon={<UserCheck size={22} className="text-success" />}
          label="الموردون النشطون"
          value={activeSuppliers.toLocaleString('ar-EG')}
          color="bg-success-bg"
        />
        <KpiCard
          icon={<Wallet size={22} className="text-danger" />}
          label="إجمالي مستحقات الموردين"
          value={formatMoney(totalDue)}
          color="bg-danger-bg"
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
          emptyText="لا يوجد موردون — أضف مورداً جديداً"
        />
      </div>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditTarget(null); reset(); }}
        title={editTarget ? 'تعديل بيانات المورد' : 'إضافة مورد جديد'}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => { setModalOpen(false); setEditTarget(null); reset(); }}>
              إلغاء
            </Button>
            <Button loading={isSaving} onClick={handleSubmit(onSubmit)}>
              {editTarget ? 'حفظ التعديلات' : 'إضافة المورد'}
            </Button>
          </>
        }
      >
        <form className="grid grid-cols-2 gap-4" onSubmit={handleSubmit(onSubmit)}>
          <Input
            label="اسم المورد"
            required
            placeholder="الاسم الكامل"
            {...register('nameAr')}
            error={errors.nameAr?.message}
          />
          <Input
            label="اسم الشركة"
            placeholder="اختياري"
            {...register('company')}
            error={errors.company?.message}
          />
          <Input
            label="رقم الهاتف"
            placeholder="05xxxxxxxx"
            {...register('phone')}
            error={errors.phone?.message}
          />
          <Select label="الحالة" {...register('status')} error={errors.status?.message}>
            <option value="ACTIVE">نشط</option>
            <option value="INACTIVE">غير نشط</option>
          </Select>
          <Input
            label="الرصيد الافتتاحي (ر.س)"
            type="number"
            step="0.01"
            placeholder="0.00"
            {...register('openingBalance')}
            error={errors.openingBalance?.message}
            className="col-span-2"
          />
        </form>
      </Modal>

      {/* Delete Confirm */}
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
          هل تريد حذف المورد <span className="font-bold">{deleteTarget?.nameAr}</span>؟ لن يمكن التراجع عن هذا الإجراء.
        </p>
      </Modal>

      <StatementModal
        supplierId={statementTarget?.id ?? null}
        supplierName={statementTarget?.nameAr ?? ''}
        open={!!statementTarget}
        onClose={() => setStatementTarget(null)}
      />
    </div>
  );
}
