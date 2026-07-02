import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { usePermission } from '../../contexts/AuthContext';
import { getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

// --- Types ---
interface CostCenter {
  id: number;
  code: string;
  nameAr: string;
  isActive: boolean;
}

// --- Zod schema ---
const costCenterSchema = z.object({
  code: z.string().min(1, 'الرمز مطلوب'),
  nameAr: z.string().min(1, 'الاسم مطلوب'),
});

type CostCenterFormValues = z.infer<typeof costCenterSchema>;

// --- API ---
const fetchCostCenters = async (params: { page: number; pageSize: number; search: string }) => {
  const res = await apiClient.get<PaginatedResponse<CostCenter>>('/cost-centers', { params });
  return res.data;
};

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// --- Component ---
export function CostCentersPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('accounts.create');
  const canEdit = usePermission('accounts.edit');
  const canDelete = usePermission('accounts.delete');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CostCenter | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CostCenter | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['cost-centers', page, pageSize, search],
    queryFn: () => fetchCostCenters({ page, pageSize, search }),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CostCenterFormValues>({
    resolver: zodResolver(costCenterSchema),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/cost-centers', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cost-centers'] });
      toast('تم إضافة مركز التكلفة بنجاح');
      setModalOpen(false);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الإضافة'), 'error'),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiClient.put(`/cost-centers/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cost-centers'] });
      toast('تم تعديل مركز التكلفة بنجاح');
      setModalOpen(false);
      setEditTarget(null);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء التعديل'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/cost-centers/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cost-centers'] });
      toast('تم حذف مركز التكلفة');
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحذف'), 'error'),
  });

  const openCreate = () => {
    setEditTarget(null);
    reset({ code: '', nameAr: '' });
    setModalOpen(true);
  };

  const openEdit = (c: CostCenter) => {
    setEditTarget(c);
    reset({ code: c.code, nameAr: c.nameAr });
    setModalOpen(true);
  };

  const onSubmit = (values: CostCenterFormValues) => {
    const body: Record<string, unknown> = { code: values.code, nameAr: values.nameAr };
    if (editTarget) {
      editMutation.mutate({ id: editTarget.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const columns: Column<CostCenter>[] = [
    {
      key: 'id',
      header: '#',
      render: (_, idx) => <span className="text-app-muted text-xs">{idx + 1}</span>,
    },
    { key: 'code', header: 'الرمز', render: (row) => <span className="font-mono font-bold text-primary">{row.code}</span> },
    { key: 'nameAr', header: 'الاسم', sortable: true },
    {
      key: 'isActive',
      header: 'الحالة',
      render: (row) => <Badge variant={row.isActive ? 'success' : 'default'}>{row.isActive ? 'نشط' : 'غير نشط'}</Badge>,
    },
    {
      key: 'actions',
      header: 'إجراءات',
      render: (row) => (
        <div className="flex items-center gap-1">
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
        title="مراكز التكلفة"
        subtitle="تصنيف الإيرادات والمصروفات حسب الفرع أو النشاط لقياس ربحيته"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={openCreate}>
              إضافة مركز تكلفة
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
          emptyText="لا توجد مراكز تكلفة — أضف مركزاً جديداً"
        />
      </div>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditTarget(null); reset(); }}
        title={editTarget ? 'تعديل مركز التكلفة' : 'إضافة مركز تكلفة جديد'}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setModalOpen(false); setEditTarget(null); reset(); }}>
              إلغاء
            </Button>
            <Button loading={isSaving} onClick={handleSubmit(onSubmit)}>
              {editTarget ? 'حفظ التعديلات' : 'إضافة'}
            </Button>
          </>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)}>
          <Input label="الرمز" placeholder="مثال: CC-01" required {...register('code')} error={errors.code?.message} />
          <Input label="الاسم بالعربية" placeholder="مثال: فرع المعادي" required {...register('nameAr')} error={errors.nameAr?.message} />
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
          هل تريد حذف مركز التكلفة <span className="font-bold">{deleteTarget?.nameAr}</span>؟
        </p>
      </Modal>
    </div>
  );
}
