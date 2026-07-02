import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus,
  Eye,
  Trash2,
  FileText,
  CheckCircle,
  XCircle,
  ShoppingCart,
  BadgeDollarSign,
  Printer,
  Wallet,
  PackageCheck,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { usePermission } from '../../contexts/AuthContext';
import { useDateRange } from '../../contexts/DateRangeContext';
import { formatMoney, formatDate, getApiErrorMessage } from '../../lib/utils';
import { printInvoice } from '../../lib/print';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Supplier {
  id: number;
  nameAr: string;
  company: string | null;
}

interface Warehouse {
  id: number;
  nameAr: string;
}

interface Product {
  id: number;
  nameAr: string;
  sku: string;
  costPrice: number;
  unit?: { nameAr: string } | null;
}

interface PurchaseItem {
  id: number;
  productId: number;
  qty: number;
  unitCost: number;
  lineTotal: number;
  product: Product;
}

interface PurchaseInvoice {
  id: number;
  refNo: string;
  date: string;
  supplier: Supplier;
  warehouse: Warehouse;
  receiveStatus: 'RECEIVED' | 'PENDING';
  paymentStatus: 'PAID' | 'UNPAID' | 'PARTIAL';
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  notes?: string | null;
  items?: PurchaseItem[];
  paidAmount?: number;
  remainingAmount?: number;
  supplierId?: number;
}

// ─── Label Maps ───────────────────────────────────────────────────────────────

const receiveStatusLabel: Record<string, string> = {
  RECEIVED: 'تم الاستلام',
  PENDING: 'قيد الاستلام',
};

const receiveStatusVariant: Record<string, 'success' | 'warning'> = {
  RECEIVED: 'success',
  PENDING: 'warning',
};

const paymentStatusLabel: Record<string, string> = {
  PAID: 'مدفوعة',
  PARTIAL: 'جزئي',
  UNPAID: 'غير مسددة',
};

const paymentStatusVariant: Record<string, 'success' | 'warning' | 'danger'> = {
  PAID: 'success',
  PARTIAL: 'warning',
  UNPAID: 'danger',
};

// ─── Zod ──────────────────────────────────────────────────────────────────────

const lineItemSchema = z.object({
  productId: z.string().min(1, 'اختر منتجاً'),
  qty: z.string().min(1, 'الكمية مطلوبة'),
  unitCost: z.string().min(1, 'سعر الوحدة مطلوب'),
});

const createInvoiceSchema = z.object({
  supplierId: z.string().min(1, 'اختر المورد'),
  warehouseId: z.string().min(1, 'اختر المستودع'),
  date: z.string().optional(),
  discount: z.string().optional(),
  tax: z.string().optional(),
  paymentStatus: z.enum(['PAID', 'UNPAID', 'PARTIAL']),
  receiveStatus: z.enum(['RECEIVED', 'PENDING']),
  notes: z.string().optional(),
  items: z.array(lineItemSchema).min(1, 'أضف بنداً واحداً على الأقل'),
});

type CreateInvoiceValues = z.infer<typeof createInvoiceSchema>;

// ─── Toast ────────────────────────────────────────────────────────────────────

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// ─── API Fetchers ─────────────────────────────────────────────────────────────

const fetchInvoices = async (params: { page: number; pageSize: number; search: string; from?: string | null; to?: string | null }) => {
  const { from, to, ...rest } = params;
  const queryParams: Record<string, string | number> = { ...rest };
  if (from) queryParams.from = from;
  if (to) queryParams.to = to;
  const res = await apiClient.get<PaginatedResponse<PurchaseInvoice>>('/purchase-invoices', { params: queryParams });
  return res.data;
};

const fetchInvoiceById = async (id: number): Promise<PurchaseInvoice> => {
  const res = await apiClient.get<PurchaseInvoice>(`/purchase-invoices/${id}`);
  return res.data;
};

const fetchSuppliersAll = async (): Promise<Supplier[]> => {
  const res = await apiClient.get<PaginatedResponse<Supplier>>('/suppliers', {
    params: { page: 1, pageSize: 200 },
  });
  return res.data.data;
};

const fetchWarehousesAll = async (): Promise<Warehouse[]> => {
  const res = await apiClient.get<PaginatedResponse<Warehouse>>('/warehouses', {
    params: { page: 1, pageSize: 200 },
  });
  return res.data.data;
};

const fetchProductsAll = async (): Promise<Product[]> => {
  const res = await apiClient.get<PaginatedResponse<Product>>('/products', {
    params: { page: 1, pageSize: 500 },
  });
  return res.data.data;
};

// ─── KPI Card ─────────────────────────────────────────────────────────────────

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

// ─── Invoice Detail Modal ─────────────────────────────────────────────────────

// --- Record Payment Modal ---
interface TreasuryAccountOpt {
  id: number;
  code: string;
  nameAr: string;
}

function RecordPaymentModal({
  invoice,
  open,
  onClose,
}: {
  invoice: PurchaseInvoice | null | undefined;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [treasuryAccountId, setTreasuryAccountId] = useState('');
  const [error, setError] = useState('');

  const { data: treasuryAccounts = [] } = useQuery({
    queryKey: ['treasury-accounts'],
    queryFn: async () => (await apiClient.get<{ data: TreasuryAccountOpt[] }>('/treasury/accounts')).data.data,
    enabled: open,
  });

  const remaining = Number(invoice?.remainingAmount ?? invoice?.total ?? 0);

  const payMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/vouchers', {
        type: 'PAYMENT',
        treasuryAccountId: parseInt(treasuryAccountId),
        partyType: 'SUPPLIER',
        partyId: invoice!.supplierId,
        purchaseInvoiceId: invoice!.id,
        amount: parseFloat(amount),
        description: `دفعة على فاتورة ${invoice!.refNo}`,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
      qc.invalidateQueries({ queryKey: ['purchase-invoice-detail', invoice!.id] });
      qc.invalidateQueries({ queryKey: ['supplier-statement'] });
      toast('تم تسجيل الدفعة بنجاح');
      handleClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'حدث خطأ أثناء تسجيل الدفعة')),
  });

  const handleClose = () => {
    setAmount('');
    setTreasuryAccountId('');
    setError('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="تسجيل دفعة"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>إلغاء</Button>
          <Button
            loading={payMutation.isPending}
            disabled={!amount || !treasuryAccountId || parseFloat(amount) <= 0}
            onClick={() => payMutation.mutate()}
          >
            تسجيل الدفعة
          </Button>
        </>
      }
    >
      <div dir="rtl" className="space-y-4">
        <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between text-sm">
          <span className="text-app-muted">المتبقي على الفاتورة</span>
          <span className="font-bold font-mono text-primary">{formatMoney(remaining)}</span>
        </div>
        <Input
          label="المبلغ"
          type="number"
          min="0"
          step="0.01"
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Select label="حساب الخزينة (الدفع من)" value={treasuryAccountId} onChange={(e) => setTreasuryAccountId(e.target.value)}>
          <option value="">— اختر —</option>
          {treasuryAccounts.map((a) => (
            <option key={a.id} value={String(a.id)}>{a.code} — {a.nameAr}</option>
          ))}
        </Select>
        {error && <div className="bg-danger-bg text-danger text-sm font-medium px-4 py-2.5 rounded-lg">{error}</div>}
      </div>
    </Modal>
  );
}

function InvoiceDetailModal({
  invoiceId,
  open,
  onClose,
}: {
  invoiceId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const canRecordPayment = usePermission('treasury.create');
  const [payModalOpen, setPayModalOpen] = useState(false);

  const { data: invoice, isLoading } = useQuery({
    queryKey: ['purchase-invoice-detail', invoiceId],
    queryFn: () => fetchInvoiceById(invoiceId!),
    enabled: open && invoiceId != null,
  });

  const handlePrint = () => {
    if (!invoice) return;
    printInvoice({
      docTitle: 'فاتورة مشتريات',
      refNo: invoice.refNo,
      date: invoice.date,
      partyLabel: 'المورد',
      partyName: invoice.supplier?.nameAr ?? '—',
      warehouse: invoice.warehouse?.nameAr,
      receiveText: receiveStatusLabel[invoice.receiveStatus] ?? invoice.receiveStatus,
      statusText: paymentStatusLabel[invoice.paymentStatus] ?? invoice.paymentStatus,
      items: (invoice.items ?? []).map((it) => ({
        name: it.product.nameAr,
        sku: it.product.sku,
        unit: it.product.unit?.nameAr,
        qty: Number(it.qty),
        unitPrice: Number(it.unitCost),
        lineTotal: Number(it.lineTotal),
      })),
      subtotal: Number(invoice.subtotal),
      discount: Number(invoice.discount),
      tax: Number(invoice.tax),
      total: Number(invoice.total),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="تفاصيل فاتورة الشراء"
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إغلاق</Button>
          {canRecordPayment && invoice && invoice.paymentStatus !== 'PAID' && (
            <Button variant="outline" icon={<Wallet size={15} />} onClick={() => setPayModalOpen(true)}>
              تسجيل دفعة
            </Button>
          )}
          <Button icon={<Printer size={15} />} disabled={!invoice} onClick={handlePrint}>
            طباعة فاتورة الشراء
          </Button>
        </>
      }
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <span className="inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : invoice ? (
        <div className="space-y-4">
          {/* Header info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-app-muted">رقم المرجع: </span>
              <span className="font-bold text-primary">{invoice.refNo}</span>
            </div>
            <div>
              <span className="text-app-muted">التاريخ: </span>
              <span className="font-medium">{formatDate(invoice.date)}</span>
            </div>
            <div>
              <span className="text-app-muted">المورد: </span>
              <span className="font-medium">{invoice.supplier?.nameAr}</span>
            </div>
            <div>
              <span className="text-app-muted">المستودع: </span>
              <span className="font-medium">{invoice.warehouse?.nameAr}</span>
            </div>
            <div>
              <span className="text-app-muted">حالة الاستلام: </span>
              <Badge variant={receiveStatusVariant[invoice.receiveStatus] ?? 'default'}>
                {receiveStatusLabel[invoice.receiveStatus] ?? invoice.receiveStatus}
              </Badge>
            </div>
            <div className="flex items-center gap-4">
              <span>
                <span className="text-app-muted">حالة الدفع: </span>
                <Badge variant={paymentStatusVariant[invoice.paymentStatus] ?? 'default'}>
                  {paymentStatusLabel[invoice.paymentStatus] ?? invoice.paymentStatus}
                </Badge>
              </span>
              {invoice.paymentStatus !== 'PAID' && (
                <span>
                  <span className="text-app-muted">المتبقي: </span>
                  <span className="font-bold text-danger">{formatMoney(Number(invoice.remainingAmount ?? invoice.total))}</span>
                </span>
              )}
            </div>
            {invoice.notes && (
              <div className="col-span-2">
                <span className="text-app-muted">ملاحظات: </span>
                <span className="font-medium">{invoice.notes}</span>
              </div>
            )}
          </div>

          {/* Items table */}
          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-app-border">
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">المنتج</th>
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">الوحدة</th>
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">الكمية</th>
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">سعر الوحدة</th>
                  <th className="px-4 py-3 text-right font-semibold text-app-muted text-xs">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {(invoice.items ?? []).map((item) => (
                  <tr key={item.id} className="border-b border-app-border last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{item.product.nameAr}</div>
                      <div className="text-xs text-app-muted">{item.product.sku}</div>
                    </td>
                    <td className="px-4 py-3 text-app-muted text-xs">
                      {item.product.unit?.nameAr ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono">{item.qty}</td>
                    <td className="px-4 py-3 font-mono text-xs">{formatMoney(Number(item.unitCost))}</td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">
                      {formatMoney(Number(item.lineTotal))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex flex-col items-end gap-1 text-sm border-t border-app-border pt-3">
            <div className="flex items-center gap-8">
              <span className="text-app-muted">المجموع الفرعي:</span>
              <span className="font-mono w-36 text-left">{formatMoney(Number(invoice.subtotal))}</span>
            </div>
            {Number(invoice.discount) > 0 && (
              <div className="flex items-center gap-8">
                <span className="text-app-muted">الخصم:</span>
                <span className="font-mono w-36 text-left text-danger">− {formatMoney(Number(invoice.discount))}</span>
              </div>
            )}
            {Number(invoice.tax) > 0 && (
              <div className="flex items-center gap-8">
                <span className="text-app-muted">الضريبة:</span>
                <span className="font-mono w-36 text-left">{formatMoney(Number(invoice.tax))}</span>
              </div>
            )}
            <div className="flex items-center gap-8 border-t border-app-border pt-2 mt-1">
              <span className="font-bold text-base">إجمالي الفاتورة:</span>
              <span className="font-mono font-bold text-base text-primary w-36 text-left">
                {formatMoney(Number(invoice.total))}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-center text-app-muted py-8">تعذر تحميل بيانات الفاتورة</p>
      )}
      <RecordPaymentModal invoice={invoice} open={payModalOpen} onClose={() => setPayModalOpen(false)} />
    </Modal>
  );
}

// ─── Create Invoice Modal ─────────────────────────────────────────────────────

function CreateInvoiceModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers', 'dropdown'],
    queryFn: fetchSuppliersAll,
    enabled: open,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses', 'dropdown'],
    queryFn: fetchWarehousesAll,
    enabled: open,
  });
  const { data: products = [] } = useQuery({
    queryKey: ['products', 'dropdown'],
    queryFn: fetchProductsAll,
    enabled: open,
  });

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<CreateInvoiceValues>({
    resolver: zodResolver(createInvoiceSchema),
    defaultValues: {
      paymentStatus: 'UNPAID',
      receiveStatus: 'PENDING',
      discount: '0',
      tax: '0',
      items: [{ productId: '', qty: '1', unitCost: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });

  const watchedItems = watch('items');
  const watchedDiscount = watch('discount');
  const watchedTax = watch('tax');

  const subtotal = (watchedItems ?? []).reduce((s, item) => {
    const q = parseFloat(item.qty) || 0;
    const c = parseFloat(item.unitCost) || 0;
    return s + q * c;
  }, 0);
  const discount = parseFloat(watchedDiscount ?? '0') || 0;
  const tax = parseFloat(watchedTax ?? '0') || 0;
  const total = subtotal - discount + tax;

  const createMutation = useMutation({
    mutationFn: (body: object) => apiClient.post('/purchase-invoices', body),
    onSuccess: () => {
      toast('تم إنشاء فاتورة الشراء بنجاح');
      reset();
      onSuccess();
      onClose();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الإنشاء'), 'error'),
  });

  const onSubmit = (values: CreateInvoiceValues) => {
    const body = {
      supplierId: parseInt(values.supplierId),
      warehouseId: parseInt(values.warehouseId),
      date: values.date || undefined,
      discount: parseFloat(values.discount ?? '0') || 0,
      tax: parseFloat(values.tax ?? '0') || 0,
      paymentStatus: values.paymentStatus,
      receiveStatus: values.receiveStatus,
      notes: values.notes || undefined,
      items: values.items.map((item) => ({
        productId: parseInt(item.productId),
        qty: parseFloat(item.qty),
        unitCost: parseFloat(item.unitCost),
      })),
    };
    createMutation.mutate(body);
  };

  const handleProductChange = (index: number, productId: string) => {
    const product = products.find((p) => String(p.id) === productId);
    if (product) {
      setValue(`items.${index}.unitCost`, String(product.costPrice));
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="فاتورة شراء جديدة"
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>
            إلغاء
          </Button>
          <Button loading={createMutation.isPending} onClick={handleSubmit(onSubmit)}>
            حفظ الفاتورة
          </Button>
        </>
      }
    >
      <form className="space-y-5" onSubmit={handleSubmit(onSubmit)}>
        {/* Header row */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-app-text mb-1">
              المورد <span className="text-danger">*</span>
            </label>
            <select
              {...register('supplierId')}
              className="w-full rounded-lg border border-app-border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="">— اختر المورد —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nameAr}{s.company ? ` · ${s.company}` : ''}
                </option>
              ))}
            </select>
            {errors.supplierId && (
              <p className="text-xs text-danger mt-1">{errors.supplierId.message}</p>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-app-text mb-1">
              المستودع <span className="text-danger">*</span>
            </label>
            <select
              {...register('warehouseId')}
              className="w-full rounded-lg border border-app-border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="">— اختر المستودع —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.nameAr}
                </option>
              ))}
            </select>
            {errors.warehouseId && (
              <p className="text-xs text-danger mt-1">{errors.warehouseId.message}</p>
            )}
          </div>

          <Input
            label="تاريخ الفاتورة"
            type="date"
            {...register('date')}
          />

          <Select
            label="حالة الاستلام"
            {...register('receiveStatus')}
          >
            <option value="PENDING">قيد الاستلام</option>
            <option value="RECEIVED">تم الاستلام</option>
          </Select>

          <Select
            label="حالة الدفع"
            {...register('paymentStatus')}
          >
            <option value="UNPAID">غير مسددة</option>
            <option value="PARTIAL">جزئي</option>
            <option value="PAID">مدفوعة</option>
          </Select>

          <Input
            label="ملاحظات"
            placeholder="اختياري"
            {...register('notes')}
          />
        </div>

        {/* Line Items */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-app-text">بنود الفاتورة</h4>
            <button
              type="button"
              onClick={() => append({ productId: '', qty: '1', unitCost: '' })}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <Plus size={12} />
              إضافة بند
            </button>
          </div>

          {errors.items && typeof errors.items.message === 'string' && (
            <p className="text-xs text-danger mb-2">{errors.items.message}</p>
          )}

          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-app-border">
                  <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted w-2/5">المنتج</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted w-1/6">الكمية</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted w-1/5">سعر الوحدة (ر.س)</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted w-1/6">الإجمالي</th>
                  <th className="px-2 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody>
                {fields.map((field, index) => {
                  const q = parseFloat(watchedItems?.[index]?.qty ?? '0') || 0;
                  const c = parseFloat(watchedItems?.[index]?.unitCost ?? '0') || 0;
                  const lineTotal = q * c;
                  return (
                    <tr key={field.id} className="border-b border-app-border last:border-0">
                      <td className="px-3 py-2">
                        <select
                          {...register(`items.${index}.productId`)}
                          onChange={(e) => {
                            register(`items.${index}.productId`).onChange(e);
                            handleProductChange(index, e.target.value);
                          }}
                          className="w-full rounded-lg border border-app-border px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
                        >
                          <option value="">— اختر —</option>
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.nameAr} ({p.sku})
                            </option>
                          ))}
                        </select>
                        {errors.items?.[index]?.productId && (
                          <p className="text-xs text-danger mt-0.5">
                            {errors.items[index]?.productId?.message}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          {...register(`items.${index}.qty`)}
                          type="number"
                          min="0.001"
                          step="0.001"
                          className="w-full rounded-lg border border-app-border px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
                        />
                        {errors.items?.[index]?.qty && (
                          <p className="text-xs text-danger mt-0.5">
                            {errors.items[index]?.qty?.message}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          {...register(`items.${index}.unitCost`)}
                          type="number"
                          min="0"
                          step="0.01"
                          className="w-full rounded-lg border border-app-border px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-primary/30 focus:border-primary"
                        />
                        {errors.items?.[index]?.unitCost && (
                          <p className="text-xs text-danger mt-0.5">
                            {errors.items[index]?.unitCost?.message}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs font-semibold text-primary">
                        {formatMoney(lineTotal)}
                      </td>
                      <td className="px-2 py-2">
                        {fields.length > 1 && (
                          <button
                            type="button"
                            onClick={() => remove(index)}
                            className="p-1 rounded hover:bg-red-50 text-app-muted hover:text-danger transition-colors"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Totals summary */}
        <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Input
              label="الخصم (ر.س)"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              {...register('discount')}
            />
            <Input
              label="الضريبة (ر.س)"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              {...register('tax')}
            />
          </div>
          <div className="flex flex-col justify-end gap-1 text-sm">
            <div className="flex justify-between">
              <span className="text-app-muted">المجموع الفرعي:</span>
              <span className="font-mono font-medium">{formatMoney(subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-app-muted">الخصم:</span>
              <span className="font-mono font-medium text-danger">− {formatMoney(discount)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-app-muted">الضريبة:</span>
              <span className="font-mono font-medium">{formatMoney(tax)}</span>
            </div>
            <div className="flex justify-between border-t border-app-border pt-2 mt-1">
              <span className="font-bold">الإجمالي:</span>
              <span className="font-mono font-bold text-primary text-base">{formatMoney(total)}</span>
            </div>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export function PurchaseInvoicesPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('purchases.create');
  const canDelete = usePermission('purchases.delete');
  const { from, to } = useDateRange();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [viewId, setViewId] = useState<number | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PurchaseInvoice | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<PurchaseInvoice | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-invoices', page, pageSize, search, from, to],
    queryFn: () => fetchInvoices({ page, pageSize, search, from, to }),
  });

  // All invoices for KPIs (also respects date range)
  const { data: allData } = useQuery({
    queryKey: ['purchase-invoices-all', from, to],
    queryFn: () => fetchInvoices({ page: 1, pageSize: 1000, search: '', from, to }),
    staleTime: 1000 * 60 * 2,
  });

  const allInvoices = allData?.data ?? [];
  const totalInvoices = allData?.pagination.total ?? 0;
  const totalPurchasesValue = allInvoices.reduce((s, inv) => s + Number(inv.total), 0);
  const paidAmount = allInvoices
    .filter((i) => i.paymentStatus === 'PAID')
    .reduce((s, i) => s + Number(i.total), 0);
  const unpaidCount = allInvoices.filter((i) => i.paymentStatus !== 'PAID').length;

  const receiveMutation = useMutation({
    mutationFn: (id: number) => apiClient.post(`/purchase-invoices/${id}/receive`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
      qc.invalidateQueries({ queryKey: ['purchase-invoices-all'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['products'] });
      toast('تم استلام البضاعة وترحيلها للمخزون');
      setReceiveTarget(null);
    },
    onError: (err) => {
      toast(getApiErrorMessage(err, 'حدث خطأ أثناء الاستلام'), 'error');
      setReceiveTarget(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/purchase-invoices/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
      qc.invalidateQueries({ queryKey: ['supplier-statement'] });
      toast('تم حذف الفاتورة');
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحذف'), 'error'),
  });

  const openView = (inv: PurchaseInvoice) => {
    setViewId(inv.id);
    setViewOpen(true);
  };

  const columns: Column<PurchaseInvoice>[] = [
    {
      key: 'refNo',
      header: 'رقم المرجع',
      render: (row) => <span className="font-mono font-semibold text-primary text-xs">{row.refNo}</span>,
    },
    {
      key: 'supplier',
      header: 'المورد',
      render: (row) => (
        <div>
          <div className="font-medium">{row.supplier?.nameAr}</div>
          <div className="text-xs text-app-muted">فاتورة مورد</div>
        </div>
      ),
    },
    {
      key: 'warehouse',
      header: 'المستودع',
      render: (row) => (
        <span className="text-sm">{row.warehouse?.nameAr ?? '—'}</span>
      ),
    },
    {
      key: 'date',
      header: 'تاريخ الشراء',
      render: (row) => <span className="text-sm">{formatDate(row.date)}</span>,
    },
    {
      key: 'receiveStatus',
      header: 'حالة الاستلام',
      render: (row) => (
        <Badge variant={receiveStatusVariant[row.receiveStatus] ?? 'default'}>
          {receiveStatusLabel[row.receiveStatus] ?? row.receiveStatus}
        </Badge>
      ),
    },
    {
      key: 'paymentStatus',
      header: 'حالة السداد',
      render: (row) => (
        <Badge variant={paymentStatusVariant[row.paymentStatus] ?? 'default'}>
          {paymentStatusLabel[row.paymentStatus] ?? row.paymentStatus}
        </Badge>
      ),
    },
    {
      key: 'total',
      header: 'الإجمالي',
      render: (row) => (
        <span className="font-mono text-xs font-semibold text-primary">{formatMoney(Number(row.total))}</span>
      ),
    },
    {
      key: 'actions',
      header: 'عمليات',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => openView(row)}
            className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary transition-colors"
            title="عرض التفاصيل"
          >
            <Eye size={14} />
          </button>
          {canCreate && row.receiveStatus === 'PENDING' && (
            <button
              onClick={() => setReceiveTarget(row)}
              className="p-1.5 rounded-lg hover:bg-success-bg text-app-muted hover:text-success transition-colors"
              title="استلام البضاعة"
            >
              <PackageCheck size={14} />
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
        title="فواتير الشراء"
        subtitle="إدارة فواتير المشتريات من الموردين"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
              فاتورة شراء جديدة
            </Button>
          ) : undefined
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard
          icon={<FileText size={22} className="text-primary" />}
          label="إجمالي فواتير الشراء"
          value={totalInvoices.toLocaleString('ar-EG')}
          color="bg-primary-50"
        />
        <KpiCard
          icon={<ShoppingCart size={22} className="text-blue-600" />}
          label="إجمالي قيمة المشتريات"
          value={formatMoney(totalPurchasesValue)}
          color="bg-blue-50"
        />
        <KpiCard
          icon={<CheckCircle size={22} className="text-success" />}
          label="المبالغ المسددة"
          value={formatMoney(paidAmount)}
          color="bg-success-bg"
        />
        <KpiCard
          icon={<XCircle size={22} className="text-danger" />}
          label="فواتير غير مسددة بالكامل"
          value={unpaidCount.toLocaleString('ar-EG')}
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
          emptyText="لا توجد فواتير شراء بعد"
        />
      </div>

      {/* Create Invoice Modal */}
      <CreateInvoiceModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => {
          qc.invalidateQueries({ queryKey: ['purchase-invoices'] });
          qc.invalidateQueries({ queryKey: ['purchase-invoices-all', from, to] });
          qc.invalidateQueries({ queryKey: ['supplier-statement'] });
        }}
      />

      {/* Invoice Detail Modal */}
      <InvoiceDetailModal
        invoiceId={viewId}
        open={viewOpen}
        onClose={() => { setViewOpen(false); setViewId(null); }}
      />

      {/* Receive Confirm */}
      <Modal
        open={!!receiveTarget}
        onClose={() => setReceiveTarget(null)}
        title="تأكيد استلام البضاعة"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setReceiveTarget(null)}>إلغاء</Button>
            <Button
              loading={receiveMutation.isPending}
              icon={<PackageCheck size={15} />}
              onClick={() => receiveTarget && receiveMutation.mutate(receiveTarget.id)}
            >
              استلام
            </Button>
          </>
        }
      >
        <p className="text-sm text-app-text">
          سيتم إضافة بضاعة الفاتورة <span className="font-bold text-primary">{receiveTarget?.refNo}</span> إلى
          مخزون {receiveTarget?.warehouse?.nameAr}، وتحديث متوسط تكلفة الأصناف، وترحيل القيد المحاسبي بتاريخ اليوم.
        </p>
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
          هل تريد حذف الفاتورة <span className="font-bold text-primary">{deleteTarget?.refNo}</span>؟
          لن يمكن التراجع عن هذا الإجراء.
        </p>
      </Modal>
    </div>
  );
}
