import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Layers, Tag } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { usePermission } from '../../contexts/AuthContext';
import { getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';

// --- Types ---
interface DeptNode {
  id: number;
  nameAr: string;
  descriptionAr: string | null;
  parentId: number | null;
  icon: string | null;
  children: DeptNode[];
  _count?: { products?: number };
}

// --- Zod schema ---
const deptSchema = z.object({
  nameAr: z.string().min(1, 'الاسم مطلوب'),
  descriptionAr: z.string().optional().nullable(),
  parentId: z.string().optional().nullable(),
  icon: z.string().optional().nullable(),
});

type DeptFormValues = z.infer<typeof deptSchema>;

// --- API ---
const fetchDepartments = async (): Promise<DeptNode[]> => {
  const res = await apiClient.get<DeptNode[]>('/departments');
  return res.data;
};

const fetchFlat = async (): Promise<DeptNode[]> => {
  const res = await apiClient.get<DeptNode[]>('/departments/flat');
  return res.data;
};

function countProducts(node: DeptNode): number {
  return (node._count?.products ?? 0) + node.children.reduce((s, c) => s + countProducts(c), 0);
}

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// --- Department Card ---
function DeptCard({
  node,
  onEdit,
  onDelete,
  canEdit,
  canDelete,
}: {
  node: DeptNode;
  onEdit: (d: DeptNode) => void;
  onDelete: (d: DeptNode) => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const total = countProducts(node);

  return (
    <Card className="flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
            {node.icon ? (
              <span className="text-lg">{node.icon}</span>
            ) : (
              <Layers size={20} className="text-primary" />
            )}
          </div>
          <div>
            <h3 className="font-bold text-app-text">{node.nameAr}</h3>
            {node.descriptionAr && (
              <p className="text-xs text-app-muted mt-0.5">{node.descriptionAr}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {canEdit && (
            <button
              onClick={() => onEdit(node)}
              className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary transition-colors"
            >
              <Pencil size={14} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => onDelete(node)}
              className="p-1.5 rounded-lg hover:bg-red-50 text-app-muted hover:text-danger transition-colors"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Product count */}
      <div className="text-xs text-app-muted">
        إجمالي المنتجات: <span className="font-semibold text-primary">{total}</span>
      </div>

      {/* Sub-department chips */}
      {node.children.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {node.children.map((child) => (
            <span
              key={child.id}
              className="inline-flex items-center gap-1 bg-gray-100 text-app-text text-xs px-2.5 py-1 rounded-full"
            >
              <Tag size={10} />
              {child.nameAr}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

// --- Page ---
export function DepartmentsPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('departments.create');
  const canEdit = usePermission('departments.edit');
  const canDelete = usePermission('departments.delete');

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<DeptNode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeptNode | null>(null);

  const { data: tree = [], isLoading } = useQuery({ queryKey: ['departments'], queryFn: fetchDepartments });
  const { data: flat = [] } = useQuery({ queryKey: ['departments-flat'], queryFn: fetchFlat });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<DeptFormValues>({
    resolver: zodResolver(deptSchema),
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/departments', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      qc.invalidateQueries({ queryKey: ['departments-flat'] });
      toast('تم إضافة القسم بنجاح');
      setModalOpen(false);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الإضافة'), 'error'),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiClient.put(`/departments/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      qc.invalidateQueries({ queryKey: ['departments-flat'] });
      toast('تم تعديل القسم بنجاح');
      setModalOpen(false);
      setEditTarget(null);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء التعديل'), 'error'),
  });

  const openCreate = () => {
    setEditTarget(null);
    reset({ nameAr: '', descriptionAr: '', parentId: '', icon: '' });
    setModalOpen(true);
  };

  const openEdit = (d: DeptNode) => {
    setEditTarget(d);
    reset({
      nameAr: d.nameAr,
      descriptionAr: d.descriptionAr ?? '',
      parentId: d.parentId ? String(d.parentId) : '',
      icon: d.icon ?? '',
    });
    setModalOpen(true);
  };

  const onSubmit = (values: DeptFormValues) => {
    const body: Record<string, unknown> = {
      nameAr: values.nameAr,
      descriptionAr: values.descriptionAr || null,
      parentId: values.parentId ? parseInt(values.parentId) : null,
      icon: values.icon || null,
    };

    if (editTarget) {
      editMutation.mutate({ id: editTarget.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const isSaving = createMutation.isPending || editMutation.isPending;

  return (
    <div>
      <PageHeader
        title="الأقسام"
        subtitle="شجرة أقسام المنتجات والتصنيفات"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={openCreate}>
              إضافة قسم جديد
            </Button>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-app-muted">
          <span className="inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin ml-3" />
          جارٍ التحميل...
        </div>
      ) : tree.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3 text-app-muted">
          <Layers size={48} className="text-gray-300" />
          <p>لا توجد أقسام بعد — أضف قسماً جديداً</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {tree.map((node) => (
            <DeptCard
              key={node.id}
              node={node}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditTarget(null); reset(); }}
        title={editTarget ? 'تعديل القسم' : 'إضافة قسم جديد'}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setModalOpen(false); setEditTarget(null); reset(); }}>
              إلغاء
            </Button>
            <Button loading={isSaving} onClick={handleSubmit(onSubmit)}>
              {editTarget ? 'حفظ التعديلات' : 'إضافة القسم'}
            </Button>
          </>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)}>
          <Input label="الاسم بالعربية" required {...register('nameAr')} error={errors.nameAr?.message} />
          <Input label="الوصف" {...register('descriptionAr')} error={errors.descriptionAr?.message} />
          <Select label="القسم الأب (اختياري)" {...register('parentId')} error={errors.parentId?.message}>
            <option value="">— قسم رئيسي —</option>
            {flat
              .filter((d) => !editTarget || d.id !== editTarget.id)
              .map((d) => <option key={d.id} value={d.id}>{d.nameAr}</option>)
            }
          </Select>
          <Input
            label="أيقونة (emoji اختياري)"
            placeholder="مثال: 📦"
            {...register('icon')}
            error={errors.icon?.message}
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
            <Button variant="danger" onClick={() => setDeleteTarget(null)}>
              حذف
            </Button>
          </>
        }
      >
        <p className="text-sm text-app-text">
          هل تريد حذف القسم <span className="font-bold">{deleteTarget?.nameAr}</span>؟
          {(deleteTarget?.children?.length ?? 0) > 0 && (
            <span className="block mt-2 text-warning text-xs">
              تحذير: هذا القسم يحتوي على أقسام فرعية.
            </span>
          )}
        </p>
      </Modal>
    </div>
  );
}
