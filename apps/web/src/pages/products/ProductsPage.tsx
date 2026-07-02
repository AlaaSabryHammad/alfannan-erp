import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Upload, X, ImageIcon } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { usePermission } from '../../contexts/AuthContext';
import { formatMoney, formatDate, resolveImageUrl, getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

// --- Types ---
interface Department { id: number; nameAr: string; }
interface Brand { id: number; nameAr: string; }
interface Unit { id: number; nameAr: string; }

interface Product {
  id: number;
  nameAr: string;
  sku: string;
  barcode: string | null;
  departmentId: number | null;
  brandId: number | null;
  unitId: number | null;
  costPrice: number;
  salePrice: number;
  wholesalePrice: number | null;
  halfWholesalePrice: number | null;
  taxRate: number | null;
  expiryDate: string | null;
  reorderPoint: number | null;
  reorderQty: number | null;
  imageUrl: string | null;
  isActive: boolean;
  department?: Department | null;
  brand?: Brand | null;
  unit?: Unit | null;
}

// --- Zod schema ---
const productSchema = z.object({
  nameAr: z.string().min(1, 'الاسم مطلوب'),
  sku: z.string().min(1, 'الرمز مطلوب'),
  barcode: z.string().optional().nullable(),
  departmentId: z.string().optional().nullable(),
  brandId: z.string().optional().nullable(),
  unitId: z.string().optional().nullable(),
  costPrice: z.string().min(1, 'سعر التكلفة مطلوب'),
  salePrice: z.string().min(1, 'سعر البيع مطلوب'),
  wholesalePrice: z.string().optional().nullable(),
  halfWholesalePrice: z.string().optional().nullable(),
  taxRate: z.string().optional().nullable(),
  expiryDate: z.string().optional().nullable(),
  reorderPoint: z.string().optional().nullable(),
  reorderQty: z.string().optional().nullable(),
  imageUrl: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

type ProductFormValues = z.infer<typeof productSchema>;

// --- API helpers ---
const fetchProducts = async (params: { page: number; pageSize: number; search: string }) => {
  const res = await apiClient.get<PaginatedResponse<Product>>('/products', { params });
  return res.data;
};

const fetchDepartments = async () => {
  const res = await apiClient.get<Department[]>('/departments');
  // Flatten tree for select
  const flat: Department[] = [];
  function walk(nodes: (Department & { children?: Department[] })[]) {
    nodes.forEach(n => {
      flat.push({ id: n.id, nameAr: n.nameAr });
      if (n.children?.length) walk(n.children as (Department & { children?: Department[] })[]);
    });
  }
  walk(res.data as (Department & { children?: Department[] })[]);
  return flat;
};

const fetchBrands = async () => {
  const res = await apiClient.get<PaginatedResponse<Brand>>('/brands', { params: { pageSize: 200 } });
  return res.data.data;
};

const fetchUnits = async () => {
  const res = await apiClient.get<PaginatedResponse<Unit>>('/units', { params: { pageSize: 200 } });
  return res.data.data;
};

// --- Toast helper ---
function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// --- Component ---
export function ProductsPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('products.create');
  const canEdit = usePermission('products.edit');
  const canDelete = usePermission('products.delete');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);

  // Image upload state
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['products', page, pageSize, search],
    queryFn: () => fetchProducts({ page, pageSize, search }),
  });

  const { data: departments = [] } = useQuery({ queryKey: ['departments-flat'], queryFn: fetchDepartments });
  const { data: brands = [] } = useQuery({ queryKey: ['brands', 'all'], queryFn: fetchBrands });
  const { data: units = [] } = useQuery({ queryKey: ['units', 'all'], queryFn: fetchUnits });

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<ProductFormValues>({
    resolver: zodResolver(productSchema),
  });

  const watchedImageUrl = watch('imageUrl');

  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show local preview immediately
    const localUrl = URL.createObjectURL(file);
    setImagePreview(localUrl);

    // Upload to API
    setImageUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      const res = await apiClient.post<{ url: string }>('/uploads/image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setValue('imageUrl', res.data.url, { shouldValidate: true });
      toast('تم رفع الصورة بنجاح');
    } catch {
      toast('فشل رفع الصورة', 'error');
      setImagePreview(null);
    } finally {
      setImageUploading(false);
    }
  };

  const handleRemoveImage = () => {
    setValue('imageUrl', '', { shouldValidate: false });
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiClient.post('/products', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      toast('تم إضافة الصنف بنجاح');
      setModalOpen(false);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الإضافة'), 'error'),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      apiClient.put(`/products/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      toast('تم تعديل الصنف بنجاح');
      setModalOpen(false);
      setEditTarget(null);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء التعديل'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/products/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['products'] });
      toast('تم حذف الصنف');
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحذف'), 'error'),
  });

  const openCreate = () => {
    setEditTarget(null);
    reset({
      nameAr: '', sku: '', barcode: '', departmentId: '', brandId: '', unitId: '',
      costPrice: '', salePrice: '', wholesalePrice: '', halfWholesalePrice: '', taxRate: '',
      expiryDate: '', reorderPoint: '', reorderQty: '', imageUrl: '', isActive: true,
    });
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setModalOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditTarget(p);
    reset({
      nameAr: p.nameAr,
      sku: p.sku,
      barcode: p.barcode ?? '',
      departmentId: p.departmentId ? String(p.departmentId) : '',
      brandId: p.brandId ? String(p.brandId) : '',
      unitId: p.unitId ? String(p.unitId) : '',
      costPrice: String(p.costPrice),
      salePrice: String(p.salePrice),
      wholesalePrice: p.wholesalePrice != null ? String(p.wholesalePrice) : '',
      halfWholesalePrice: p.halfWholesalePrice != null ? String(p.halfWholesalePrice) : '',
      taxRate: p.taxRate != null ? String(p.taxRate) : '',
      expiryDate: p.expiryDate ? p.expiryDate.slice(0, 10) : '',
      reorderPoint: p.reorderPoint != null ? String(p.reorderPoint) : '',
      reorderQty: p.reorderQty != null ? String(p.reorderQty) : '',
      imageUrl: p.imageUrl ?? '',
      isActive: p.isActive,
    });
    // Show existing image as preview (resolve to absolute URL)
    setImagePreview(resolveImageUrl(p.imageUrl));
    if (fileInputRef.current) fileInputRef.current.value = '';
    setModalOpen(true);
  };

  const onSubmit = (values: ProductFormValues) => {
    const body: Record<string, unknown> = {
      nameAr: values.nameAr,
      sku: values.sku,
      barcode: values.barcode || null,
      departmentId: values.departmentId ? parseInt(values.departmentId) : null,
      brandId: values.brandId ? parseInt(values.brandId) : null,
      unitId: values.unitId ? parseInt(values.unitId) : null,
      costPrice: parseFloat(values.costPrice),
      salePrice: parseFloat(values.salePrice),
      wholesalePrice: values.wholesalePrice ? parseFloat(values.wholesalePrice) : null,
      halfWholesalePrice: values.halfWholesalePrice ? parseFloat(values.halfWholesalePrice) : null,
      taxRate: values.taxRate ? parseFloat(values.taxRate) : 0,
      expiryDate: values.expiryDate || null,
      reorderPoint: values.reorderPoint ? parseFloat(values.reorderPoint) : null,
      reorderQty: values.reorderQty ? parseFloat(values.reorderQty) : null,
      imageUrl: values.imageUrl || null,
      isActive: values.isActive ?? true,
    };

    if (editTarget) {
      editMutation.mutate({ id: editTarget.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const columns: Column<Product>[] = [
    {
      key: 'imageUrl',
      header: 'الصورة',
      render: (row) => {
        const src = resolveImageUrl(row.imageUrl);
        return src ? (
          <img src={src} alt={row.nameAr} className="w-10 h-10 rounded-lg object-cover border border-app-border" />
        ) : (
          <div className="w-10 h-10 rounded-lg bg-gray-100 border border-app-border flex items-center justify-center">
            <ImageIcon size={16} className="text-gray-300" />
          </div>
        );
      },
    },
    { key: 'nameAr', header: 'الاسم', sortable: true },
    { key: 'sku', header: 'الرمز (SKU)' },
    {
      key: 'department',
      header: 'القسم',
      render: (row) => row.department?.nameAr ?? <span className="text-app-muted text-xs">—</span>,
    },
    {
      key: 'brand',
      header: 'العلامة التجارية',
      render: (row) => row.brand?.nameAr ?? <span className="text-app-muted text-xs">—</span>,
    },
    {
      key: 'unit',
      header: 'الوحدة',
      render: (row) => row.unit?.nameAr ?? <span className="text-app-muted text-xs">—</span>,
    },
    {
      key: 'costPrice',
      header: 'سعر التكلفة',
      render: (row) => <span className="font-mono text-xs">{formatMoney(row.costPrice)}</span>,
    },
    {
      key: 'salePrice',
      header: 'سعر البيع',
      render: (row) => <span className="font-mono text-xs font-semibold text-primary">{formatMoney(row.salePrice)}</span>,
    },
    {
      key: 'expiryDate',
      header: 'انتهاء الصلاحية',
      render: (row) => {
        if (!row.expiryDate) return <span className="text-app-muted text-xs">—</span>;
        const days = Math.ceil((new Date(row.expiryDate).getTime() - Date.now()) / 86_400_000);
        const color = days < 0 ? 'text-danger' : days <= 30 ? 'text-warning' : 'text-app-muted';
        return <span className={`text-xs font-medium ${color}`}>{formatDate(row.expiryDate)}</span>;
      },
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
        title="الأصناف"
        subtitle="إدارة منتجات وأصناف المخزون"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={openCreate}>
              إضافة صنف
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
          emptyText="لا توجد أصناف — أضف صنفاً جديداً"
          exportTitle="قائمة الأصناف"
        />
      </div>

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditTarget(null); reset(); setImagePreview(null); }}
        title={editTarget ? 'تعديل الصنف' : 'إضافة صنف جديد'}
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => { setModalOpen(false); setEditTarget(null); reset(); setImagePreview(null); }}>
              إلغاء
            </Button>
            <Button loading={isSaving} onClick={handleSubmit(onSubmit)}>
              {editTarget ? 'حفظ التعديلات' : 'إضافة الصنف'}
            </Button>
          </>
        }
      >
        <form className="grid grid-cols-2 gap-4" onSubmit={handleSubmit(onSubmit)}>
          <Input label="الاسم بالعربية" required {...register('nameAr')} error={errors.nameAr?.message} />
          <Input label="الرمز (SKU)" required {...register('sku')} error={errors.sku?.message} />
          <Input label="الباركود" {...register('barcode')} error={errors.barcode?.message} />
          <Select label="القسم" {...register('departmentId')} error={errors.departmentId?.message}>
            <option value="">— اختر القسم —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.nameAr}</option>)}
          </Select>
          <Select label="العلامة التجارية" {...register('brandId')} error={errors.brandId?.message}>
            <option value="">— اختر العلامة —</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.nameAr}</option>)}
          </Select>
          <Select label="وحدة القياس" {...register('unitId')} error={errors.unitId?.message}>
            <option value="">— اختر الوحدة —</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.nameAr}</option>)}
          </Select>
          <Input
            label="سعر التكلفة (ر.س)"
            type="number"
            step="0.01"
            required
            {...register('costPrice')}
            error={errors.costPrice?.message}
          />
          <Input
            label="سعر البيع (ر.س)"
            type="number"
            step="0.01"
            required
            {...register('salePrice')}
            error={errors.salePrice?.message}
          />
          <Input
            label="سعر الجملة (اختياري)"
            type="number"
            step="0.01"
            {...register('wholesalePrice')}
          />
          <Input
            label="سعر نصف الجملة (اختياري)"
            type="number"
            step="0.01"
            {...register('halfWholesalePrice')}
          />
          <Input
            label="نسبة الضريبة % (اختياري)"
            type="number"
            step="0.01"
            {...register('taxRate')}
          />
          <Input
            label="تاريخ انتهاء الصلاحية (اختياري)"
            type="date"
            {...register('expiryDate')}
          />
          <Input
            label="حد إعادة الطلب (اختياري)"
            type="number"
            step="0.01"
            {...register('reorderPoint')}
          />
          <Input
            label="الكمية المقترحة لإعادة الطلب (اختياري)"
            type="number"
            step="0.01"
            {...register('reorderQty')}
          />
          {/* Image upload */}
          <div className="col-span-2">
            <label className="block text-sm font-medium text-app-text mb-1.5">صورة الصنف</label>
            <div className="flex items-start gap-4">
              {/* Preview box */}
              <div className="w-20 h-20 rounded-xl border border-app-border bg-gray-50 flex-shrink-0 overflow-hidden flex items-center justify-center">
                {imagePreview ? (
                  <img src={imagePreview} alt="معاينة" className="w-full h-full object-cover" />
                ) : (
                  <ImageIcon size={24} className="text-gray-300" />
                )}
              </div>
              <div className="flex flex-col gap-2 flex-1">
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleImageFileChange}
                />
                <Button
                  type="button"
                  variant="outline"
                  icon={<Upload size={14} />}
                  loading={imageUploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {imageUploading ? 'جارٍ الرفع...' : 'رفع صورة'}
                </Button>
                {(imagePreview || watchedImageUrl) && (
                  <button
                    type="button"
                    onClick={handleRemoveImage}
                    className="flex items-center gap-1 text-xs text-danger hover:underline"
                  >
                    <X size={12} /> إزالة الصورة
                  </button>
                )}
                {/* Fallback manual URL entry */}
                <Input
                  placeholder="أو أدخل رابط URL للصورة"
                  {...register('imageUrl')}
                  error={errors.imageUrl?.message}
                  onChange={(e) => {
                    register('imageUrl').onChange(e);
                    setImagePreview(e.target.value ? resolveImageUrl(e.target.value) : null);
                  }}
                />
              </div>
            </div>
          </div>
          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" id="isActive" {...register('isActive')} className="w-4 h-4 accent-primary" />
            <label htmlFor="isActive" className="text-sm font-medium text-app-text">صنف نشط</label>
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
          هل تريد حذف الصنف <span className="font-bold">{deleteTarget?.nameAr}</span>؟ لن يمكن التراجع عن هذا الإجراء.
        </p>
      </Modal>
    </div>
  );
}
