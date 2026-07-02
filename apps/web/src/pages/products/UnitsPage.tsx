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
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { usePermission } from '../../contexts/AuthContext';
import { getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

// --- Types ---
interface Unit {
  id: number;
  nameAr: string;
  code: string;
}

// --- Zod schema ---
const unitSchema = z.object({
  nameAr: z.string().min(1, 'الاسم مطلوب'),
  code: z.string().min(1, 'الرمز مطلوب'),
});

type UnitFormValues = z.infer<typeof unitSchema>;

// --- API ---
const fetchUnits = async (params: { page: number; pageSize: number; search: string }) => {
  const res = await apiClient.get<PaginatedResponse<Unit>>('/units', { params });
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
export function UnitsPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('units.create');
  const canEdit = usePermission('units.edit');
  const canDelete = usePermission('units.delete');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Unit | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Unit | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['units', page, pageSize, search],
    queryFn: () => fetchUnits({ page, pageSize, search }),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<UnitFormValues>({
    resolver: zodResolver(unitSchema),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/units', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['units'] });
      toast('تم إضافة وحدة القياس بنجاح');
      setModalOpen(false);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الإضافة'), 'error'),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiClient.put(`/units/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['units'] });
      toast('تم تعديل وحدة القياس بنجاح');
      setModalOpen(false);
      setEditTarget(null);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء التعديل'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/units/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['units'] });
      toast('تم حذف وحدة القياس');
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحذف'), 'error'),
  });

  const openCreate = () => {
    setEditTarget(null);
    reset({ nameAr: '', code: '' });
    setModalOpen(true);
  };

  const openEdit = (u: Unit) => {
    setEditTarget(u);
    reset({ nameAr: u.nameAr, code: u.code });
    setModalOpen(true);
  };

  const onSubmit = (values: UnitFormValues) => {
    const body: Record<string, unknown> = {
      nameAr: values.nameAr,
      code: values.code.toUpperCase(),
    };
    if (editTarget) {
      editMutation.mutate({ id: editTarget.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const columns: Column<Unit>[] = [
    {
      key: 'id',
      header: '#',
      render: (_, idx) => <span className="text-app-muted text-xs">{idx + 1}</span>,
    },
    { key: 'nameAr', header: 'الاسم', sortable: true },
    {
      key: 'code',
      header: 'الرمز',
      render: (row) => (
        <span className="font-mono text-xs bg-gray-100 px-2 py-1 rounded-lg">{row.code}</span>
      ),
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
        title="وحدات القياس"
        subtitle="إدارة وحدات قياس المنتجات (حبة، متر، كرتون...)"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={openCreate}>
              إضافة وحدة قياس
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
          emptyText="لا توجد وحدات قياس — أضف وحدة جديدة"
        />
      </div>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditTarget(null); reset(); }}
        title={editTarget ? 'تعديل وحدة القياس' : 'إضافة وحدة قياس جديدة'}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => { setModalOpen(false); setEditTarget(null); reset(); }}>
              إلغاء
            </Button>
            <Button loading={isSaving} onClick={handleSubmit(onSubmit)}>
              {editTarget ? 'حفظ' : 'إضافة'}
            </Button>
          </>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)}>
          <Input label="الاسم بالعربية" required {...register('nameAr')} error={errors.nameAr?.message} />
          <Input
            label="الرمز (CODE)"
            required
            placeholder="مثال: PCS"
            {...register('code')}
            error={errors.code?.message}
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
          هل تريد حذف وحدة القياس <span className="font-bold">{deleteTarget?.nameAr}</span>؟
        </p>
      </Modal>
    </div>
  );
}
