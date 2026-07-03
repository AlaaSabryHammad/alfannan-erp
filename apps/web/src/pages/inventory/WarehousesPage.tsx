import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Eye, Warehouse, Package, CheckCircle } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { usePermission } from '../../contexts/AuthContext';
import { getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

// --- Types ---
interface WarehouseManager { id: number; name: string; email: string; }
interface Branch { id: number; nameAr: string; isActive: boolean; }
interface Warehouse {
  id: number;
  nameAr: string;
  location: string | null;
  managerId: number | null;
  branchId: number | null;
  isActive: boolean;
  manager: WarehouseManager | null;
  branch: { id: number; nameAr: string } | null;
  _count?: { stockBalances?: number };
}
interface SimpleUser { id: number; name: string; email: string; }

// --- Zod schema ---
const warehouseSchema = z.object({
  nameAr: z.string().min(1, 'الاسم مطلوب'),
  location: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  branchId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

type WarehouseFormValues = z.infer<typeof warehouseSchema>;

// --- API ---
const fetchWarehouses = async (params: { page: number; pageSize: number; search: string }) => {
  const res = await apiClient.get<PaginatedResponse<Warehouse>>('/warehouses', { params });
  return res.data;
};

const fetchAllWarehouses = async () => {
  const res = await apiClient.get<PaginatedResponse<Warehouse>>('/warehouses', { params: { pageSize: 200 } });
  return res.data.data;
};

const fetchUsers = async () => {
  const res = await apiClient.get<PaginatedResponse<SimpleUser>>('/users', { params: { pageSize: 200 } });
  return res.data.data;
};

const fetchBranches = async () => {
  const res = await apiClient.get<Branch[]>('/branches');
  return res.data;
};

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// --- KPI Card ---
function KpiCard({ label, value, icon, color }: { label: string; value: string | number; icon: React.ReactNode; color: string }) {
  return (
    <Card>
      <div className="flex items-center gap-4">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
          {icon}
        </div>
        <div>
          <p className="text-sm text-app-muted">{label}</p>
          <p className="text-2xl font-bold text-app-text">{value}</p>
        </div>
      </div>
    </Card>
  );
}

// --- Component ---
export function WarehousesPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('warehouses.create');
  const canEdit = usePermission('warehouses.edit');
  const canDelete = usePermission('warehouses.delete');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Warehouse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Warehouse | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['warehouses', page, pageSize, search],
    queryFn: () => fetchWarehouses({ page, pageSize, search }),
  });

  const { data: allWarehouses = [] } = useQuery({ queryKey: ['warehouses-all'], queryFn: fetchAllWarehouses });

  const { data: users = [] } = useQuery({
    queryKey: ['users-all'],
    queryFn: fetchUsers,
    // Gracefully handle if /users endpoint doesn't exist
    retry: false,
  });

  const { data: branches = [] } = useQuery({ queryKey: ['branches'], queryFn: fetchBranches, retry: false });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<WarehouseFormValues>({
    resolver: zodResolver(warehouseSchema),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/warehouses', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      qc.invalidateQueries({ queryKey: ['warehouses-all'] });
      toast('تم إضافة المستودع بنجاح');
      setModalOpen(false);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الإضافة'), 'error'),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiClient.put(`/warehouses/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      qc.invalidateQueries({ queryKey: ['warehouses-all'] });
      toast('تم تعديل المستودع بنجاح');
      setModalOpen(false);
      setEditTarget(null);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء التعديل'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/warehouses/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      qc.invalidateQueries({ queryKey: ['warehouses-all'] });
      toast('تم حذف المستودع');
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحذف'), 'error'),
  });

  const openCreate = () => {
    setEditTarget(null);
    reset({ nameAr: '', location: '', managerId: '', branchId: '', isActive: true });
    setModalOpen(true);
  };

  const openEdit = (w: Warehouse) => {
    setEditTarget(w);
    reset({
      nameAr: w.nameAr,
      location: w.location ?? '',
      managerId: w.managerId ? String(w.managerId) : '',
      branchId: w.branchId ? String(w.branchId) : '',
      isActive: w.isActive,
    });
    setModalOpen(true);
  };

  const onSubmit = (values: WarehouseFormValues) => {
    const body: Record<string, unknown> = {
      nameAr: values.nameAr,
      location: values.location || null,
      managerId: values.managerId ? parseInt(values.managerId) : null,
      branchId: values.branchId ? parseInt(values.branchId) : null,
      isActive: values.isActive ?? true,
    };
    if (editTarget) {
      editMutation.mutate({ id: editTarget.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  // KPI derivations from loaded all-warehouses
  const totalWarehouses = allWarehouses.length;
  const activeWarehouses = allWarehouses.filter((w) => w.isActive).length;
  const totalItems = allWarehouses.reduce((s, w) => s + (w._count?.stockBalances ?? 0), 0);

  const columns: Column<Warehouse>[] = [
    { key: 'nameAr', header: 'الاسم', sortable: true },
    {
      key: 'location',
      header: 'الموقع',
      render: (row) => row.location ?? <span className="text-app-muted text-xs">—</span>,
    },
    {
      key: 'branch',
      header: 'الفرع',
      render: (row) => row.branch?.nameAr ?? <span className="text-app-muted text-xs">— غير مرتبط —</span>,
    },
    {
      key: 'manager',
      header: 'المدير',
      render: (row) => row.manager?.name ?? <span className="text-app-muted text-xs">—</span>,
    },
    {
      key: 'isActive',
      header: 'الحالة',
      render: (row) => (
        <Badge variant={row.isActive ? 'success' : 'danger'}>{row.isActive ? 'نشط' : 'معطل'}</Badge>
      ),
    },
    {
      key: 'actions',
      header: 'إجراءات',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button
            className="p-1.5 rounded-lg hover:bg-gray-100 text-app-muted transition-colors"
            title="عرض"
          >
            <Eye size={14} />
          </button>
          {canEdit && (
            <button
              onClick={() => openEdit(row)}
              className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary transition-colors"
            >
              <Pencil size={14} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => setDeleteTarget(row)}
              className="p-1.5 rounded-lg hover:bg-red-50 text-app-muted hover:text-danger transition-colors"
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
        title="المستودعات"
        subtitle="إدارة مستودعات التخزين والمواقع"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={openCreate}>
              إضافة مستودع جديد
            </Button>
          ) : undefined
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard
          label="إجمالي المستودعات"
          value={totalWarehouses}
          icon={<Warehouse size={22} className="text-primary" />}
          color="bg-primary-50"
        />
        <KpiCard
          label="المستودعات النشطة"
          value={activeWarehouses}
          icon={<CheckCircle size={22} className="text-success" />}
          color="bg-success-bg"
        />
        <KpiCard
          label="إجمالي الأصناف المخزنة"
          value={totalItems}
          icon={<Package size={22} className="text-warning" />}
          color="bg-warning-bg"
        />
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
          emptyText="لا توجد مستودعات — أضف مستودعاً جديداً"
        />
      </div>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditTarget(null); reset(); }}
        title={editTarget ? 'تعديل المستودع' : 'إضافة مستودع جديد'}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setModalOpen(false); setEditTarget(null); reset(); }}>
              إلغاء
            </Button>
            <Button loading={isSaving} onClick={handleSubmit(onSubmit)}>
              {editTarget ? 'حفظ التعديلات' : 'إضافة المستودع'}
            </Button>
          </>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)}>
          <Input label="اسم المستودع" required {...register('nameAr')} error={errors.nameAr?.message} />
          <Input label="الموقع" {...register('location')} error={errors.location?.message} />
          <Select label="الفرع التابع له" {...register('branchId')} error={errors.branchId?.message}>
            <option value="">— بدون فرع —</option>
            {branches.filter((b) => b.isActive).map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
          </Select>
          {users.length > 0 && (
            <Select label="المدير المسؤول" {...register('managerId')} error={errors.managerId?.message}>
              <option value="">— بدون مدير —</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          )}
          <div className="flex items-center gap-2">
            <input type="checkbox" id="isActiveWh" {...register('isActive')} className="w-4 h-4 accent-primary" />
            <label htmlFor="isActiveWh" className="text-sm font-medium text-app-text">مستودع نشط</label>
          </div>
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
          هل تريد حذف المستودع <span className="font-bold">{deleteTarget?.nameAr}</span>؟
        </p>
      </Modal>
    </div>
  );
}
