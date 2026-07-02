import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Users, UserCheck, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { useAuth, usePermission } from '../../contexts/AuthContext';
import { formatDate, getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

// ─── Types ─────────────────────────────────────────────────────────────────────
interface UserRow {
  id: number;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: string;
  roleId: number;
  role: { id: number; code: string; nameAr: string };
}

interface RoleOption {
  id: number;
  code: string;
  nameAr: string;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────
const createSchema = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  email: z.string().email('البريد الإلكتروني غير صحيح'),
  password: z.string().min(6, 'كلمة المرور 6 أحرف على الأقل'),
  roleId: z.string().min(1, 'اختر دوراً'),
  isActive: z.boolean().optional().default(true),
});

const editSchema = z.object({
  name: z.string().min(1, 'الاسم مطلوب'),
  email: z.string().email('البريد الإلكتروني غير صحيح'),
  password: z.string().optional(),
  roleId: z.string().min(1, 'اختر دوراً'),
  isActive: z.boolean().optional(),
});

type CreateFormValues = z.infer<typeof createSchema>;
type EditFormValues = z.infer<typeof editSchema>;

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5 flex items-center gap-4">
      <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>{icon}</div>
      <div>
        <p className="text-xs text-app-muted mb-1">{label}</p>
        <p className="text-xl font-bold text-app-text">{value}</p>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export function UsersPage() {
  const { user: currentUser } = useAuth();
  const qc = useQueryClient();
  const canCreate = usePermission('users.create');
  const canEdit = usePermission('users.edit');
  const canDelete = usePermission('users.delete');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['users', page, pageSize, search],
    queryFn: async () => (await apiClient.get<PaginatedResponse<UserRow>>('/users', { params: { page, pageSize, search } })).data,
  });

  const { data: rolesData } = useQuery({
    queryKey: ['roles-options'],
    queryFn: async () => (await apiClient.get<RoleOption[]>('/roles')).data,
  });

  const roles: RoleOption[] = rolesData ?? [];
  const allUsers = data?.data ?? [];
  const totalUsers = data?.pagination.total ?? 0;
  const activeUsers = allUsers.filter(u => u.isActive).length;

  // Create form
  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', email: '', password: '', roleId: '', isActive: true },
  });

  // Edit form
  const editForm = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: '', email: '', password: '', roleId: '' },
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/users', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast('تم إضافة المستخدم بنجاح');
      setModalOpen(false);
      createForm.reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الإضافة'), 'error'),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => apiClient.put(`/users/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast('تم تعديل بيانات المستخدم بنجاح');
      setModalOpen(false);
      setEditTarget(null);
      editForm.reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء التعديل'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/users/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast('تم حذف المستخدم');
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحذف'), 'error'),
  });

  const openCreate = () => {
    setEditTarget(null);
    createForm.reset({ name: '', email: '', password: '', roleId: '', isActive: true });
    setModalOpen(true);
  };

  const openEdit = (u: UserRow) => {
    setEditTarget(u);
    editForm.reset({ name: u.name, email: u.email, password: '', roleId: String(u.roleId), isActive: u.isActive });
    setModalOpen(true);
  };

  const onCreateSubmit = (values: CreateFormValues) => {
    createMutation.mutate({
      name: values.name,
      email: values.email,
      password: values.password,
      roleId: parseInt(values.roleId),
      isActive: values.isActive ?? true,
    });
  };

  const onEditSubmit = (values: EditFormValues) => {
    const body: Record<string, unknown> = {
      name: values.name,
      email: values.email,
      roleId: parseInt(values.roleId),
      isActive: values.isActive,
    };
    if (values.password && values.password.length >= 6) {
      body.password = values.password;
    }
    editMutation.mutate({ id: editTarget!.id, body });
  };

  const roleCodeColors: Record<string, 'info' | 'success' | 'warning' | 'danger' | 'default'> = {
    ADMIN: 'danger',
    MANAGER: 'warning',
    ACCOUNTANT: 'info',
    STOREKEEPER: 'success',
    CASHIER: 'default',
  };

  const columns: Column<UserRow>[] = [
    { key: 'name', header: 'الاسم', sortable: true },
    { key: 'email', header: 'البريد الإلكتروني', render: (row) => <span className="font-mono text-xs">{row.email}</span> },
    {
      key: 'role',
      header: 'الدور',
      render: (row) => (
        <Badge variant={roleCodeColors[row.role.code] ?? 'default'}>{row.role.nameAr}</Badge>
      ),
    },
    {
      key: 'isActive',
      header: 'الحالة',
      render: (row) => (
        <Badge variant={row.isActive ? 'success' : 'danger'}>{row.isActive ? 'نشط' : 'غير نشط'}</Badge>
      ),
    },
    {
      key: 'createdAt',
      header: 'تاريخ الإنشاء',
      render: (row) => <span className="text-app-muted text-xs">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'actions',
      header: 'إجراءات',
      render: (row) => (
        <div className="flex items-center gap-1">
          {canEdit && (
            <button onClick={() => openEdit(row)} className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary transition-colors" title="تعديل">
              <Pencil size={14} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => setDeleteTarget(row)}
              className="p-1.5 rounded-lg hover:bg-red-50 text-app-muted hover:text-danger transition-colors"
              title="حذف"
              disabled={row.id === currentUser?.id}
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
        title="المستخدمون"
        subtitle="إدارة حسابات المستخدمين وتعيين الأدوار"
        actions={canCreate ? <Button icon={<Plus size={16} />} onClick={openCreate}>إضافة مستخدم</Button> : undefined}
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard icon={<Users size={22} className="text-primary" />} label="إجمالي المستخدمين" value={totalUsers.toLocaleString('en-US')} color="bg-primary-50" />
        <KpiCard icon={<UserCheck size={22} className="text-success" />} label="المستخدمون النشطون" value={activeUsers.toLocaleString('en-US')} color="bg-success-bg" />
        <KpiCard icon={<ShieldCheck size={22} className="text-warning" />} label="عدد الأدوار" value={roles.length.toLocaleString('en-US')} color="bg-warning-bg" />
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
          emptyText="لا يوجد مستخدمون — أضف مستخدماً جديداً"
        />
      </div>

      {/* Create Modal */}
      {!editTarget && (
        <Modal
          open={modalOpen}
          onClose={() => { setModalOpen(false); createForm.reset(); }}
          title="إضافة مستخدم جديد"
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => { setModalOpen(false); createForm.reset(); }}>إلغاء</Button>
              <Button loading={isSaving} onClick={createForm.handleSubmit(onCreateSubmit)}>إضافة المستخدم</Button>
            </>
          }
        >
          <form className="grid grid-cols-2 gap-4" onSubmit={createForm.handleSubmit(onCreateSubmit)}>
            <Input label="الاسم الكامل" required placeholder="أحمد محمد" {...createForm.register('name')} error={createForm.formState.errors.name?.message} />
            <Input label="البريد الإلكتروني" required type="email" placeholder="user@store.com" {...createForm.register('email')} error={createForm.formState.errors.email?.message} />
            <Input label="كلمة المرور" required type="password" placeholder="6 أحرف على الأقل" {...createForm.register('password')} error={createForm.formState.errors.password?.message} />
            <Select label="الدور" required {...createForm.register('roleId')} error={createForm.formState.errors.roleId?.message}>
              <option value="">اختر دوراً...</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.nameAr}</option>)}
            </Select>
            <div className="col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" {...createForm.register('isActive')} defaultChecked className="w-4 h-4 rounded accent-primary" />
                <span className="text-sm text-app-text">الحساب نشط</span>
              </label>
            </div>
          </form>
        </Modal>
      )}

      {/* Edit Modal */}
      {editTarget && (
        <Modal
          open={modalOpen}
          onClose={() => { setModalOpen(false); setEditTarget(null); editForm.reset(); }}
          title={`تعديل بيانات: ${editTarget.name}`}
          size="lg"
          footer={
            <>
              <Button variant="outline" onClick={() => { setModalOpen(false); setEditTarget(null); editForm.reset(); }}>إلغاء</Button>
              <Button loading={isSaving} onClick={editForm.handleSubmit(onEditSubmit)}>حفظ التعديلات</Button>
            </>
          }
        >
          <form className="grid grid-cols-2 gap-4" onSubmit={editForm.handleSubmit(onEditSubmit)}>
            <Input label="الاسم الكامل" required {...editForm.register('name')} error={editForm.formState.errors.name?.message} />
            <Input label="البريد الإلكتروني" required type="email" {...editForm.register('email')} error={editForm.formState.errors.email?.message} />
            <Input label="كلمة المرور الجديدة" type="password" placeholder="اتركه فارغاً للإبقاء على الحالية" {...editForm.register('password')} error={editForm.formState.errors.password?.message} />
            <Select label="الدور" required {...editForm.register('roleId')} error={editForm.formState.errors.roleId?.message}>
              <option value="">اختر دوراً...</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.nameAr}</option>)}
            </Select>
            <div className="col-span-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" {...editForm.register('isActive')} className="w-4 h-4 rounded accent-primary" />
                <span className="text-sm text-app-text">الحساب نشط</span>
              </label>
            </div>
          </form>
        </Modal>
      )}

      {/* Delete Confirm */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="تأكيد الحذف"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>حذف</Button>
          </>
        }
      >
        <p className="text-sm text-app-text">
          هل تريد حذف المستخدم <span className="font-bold">{deleteTarget?.name}</span>؟ لن يمكن التراجع عن هذا الإجراء.
        </p>
      </Modal>
    </div>
  );
}
