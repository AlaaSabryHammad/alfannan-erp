import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Tag } from 'lucide-react';
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
interface Brand {
  id: number;
  nameAr: string;
  logoUrl: string | null;
  sortOrder: number;
}

// --- Zod schema ---
const brandSchema = z.object({
  nameAr: z.string().min(1, 'الاسم مطلوب'),
  logoUrl: z.string().optional().nullable(),
  sortOrder: z.string().optional(),
});

type BrandFormValues = z.infer<typeof brandSchema>;

// --- API ---
const fetchBrands = async (params: { page: number; pageSize: number; search: string }) => {
  const res = await apiClient.get<PaginatedResponse<Brand>>('/brands', { params });
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
export function BrandsPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('brands.create');
  const canEdit = usePermission('brands.edit');
  const canDelete = usePermission('brands.delete');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Brand | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Brand | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['brands', page, pageSize, search],
    queryFn: () => fetchBrands({ page, pageSize, search }),
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<BrandFormValues>({
    resolver: zodResolver(brandSchema),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/brands', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brands'] });
      toast('تم إضافة العلامة التجارية بنجاح');
      setModalOpen(false);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الإضافة'), 'error'),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiClient.put(`/brands/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brands'] });
      toast('تم تعديل العلامة التجارية بنجاح');
      setModalOpen(false);
      setEditTarget(null);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء التعديل'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/brands/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['brands'] });
      toast('تم حذف العلامة التجارية');
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحذف'), 'error'),
  });

  const openCreate = () => {
    setEditTarget(null);
    reset({ nameAr: '', logoUrl: '', sortOrder: '0' });
    setModalOpen(true);
  };

  const openEdit = (b: Brand) => {
    setEditTarget(b);
    reset({
      nameAr: b.nameAr,
      logoUrl: b.logoUrl ?? '',
      sortOrder: String(b.sortOrder),
    });
    setModalOpen(true);
  };

  const onSubmit = (values: BrandFormValues) => {
    const body: Record<string, unknown> = {
      nameAr: values.nameAr,
      logoUrl: values.logoUrl || null,
      sortOrder: values.sortOrder ? parseInt(values.sortOrder) : 0,
    };
    if (editTarget) {
      editMutation.mutate({ id: editTarget.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const columns: Column<Brand>[] = [
    {
      key: 'id',
      header: '#',
      render: (_, idx) => <span className="text-app-muted text-xs">{idx + 1}</span>,
    },
    {
      key: 'logoUrl',
      header: 'الشعار',
      render: (row) =>
        row.logoUrl ? (
          <img src={row.logoUrl} alt={row.nameAr} className="w-10 h-10 rounded-lg object-contain border border-app-border p-1" />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-gray-100 border border-app-border flex items-center justify-center">
            <Tag size={14} className="text-app-muted" />
          </div>
        ),
    },
    { key: 'nameAr', header: 'الاسم', sortable: true },
    { key: 'sortOrder', header: 'الترتيب' },
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
        title="العلامات التجارية"
        subtitle="إدارة العلامات التجارية للمنتجات"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={openCreate}>
              إضافة علامة تجارية
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
          emptyText="لا توجد علامات تجارية — أضف علامة جديدة"
        />
      </div>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditTarget(null); reset(); }}
        title={editTarget ? 'تعديل العلامة التجارية' : 'إضافة علامة تجارية جديدة'}
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
          <Input label="الاسم بالعربية" required {...register('nameAr')} error={errors.nameAr?.message} />
          <Input label="رابط الشعار (URL)" {...register('logoUrl')} error={errors.logoUrl?.message} />
          <Input label="الترتيب" type="number" {...register('sortOrder')} error={errors.sortOrder?.message} />
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
          هل تريد حذف العلامة التجارية <span className="font-bold">{deleteTarget?.nameAr}</span>؟
        </p>
      </Modal>
    </div>
  );
}
