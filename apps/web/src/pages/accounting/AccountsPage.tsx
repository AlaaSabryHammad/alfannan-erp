import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Plus,
  Pencil,
  Trash2,
  Landmark,
  TrendingUp,
  TrendingDown,
  Scale,
  Coins,
  FileText,
} from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { usePermission } from '../../contexts/AuthContext';
import { formatMoney, formatDate, getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

interface Account {
  id: number;
  code: string;
  nameAr: string;
  type: AccountType;
  parentId: number | null;
  openingBalance: number;
  currentBalance: number;
  isActive: boolean;
  children: Account[];
}

interface AccountGroup {
  type: AccountType;
  accounts: Account[];
  total: number;
}

function countAccounts(accounts: Account[]): number {
  return accounts.reduce((sum, a) => sum + 1 + countAccounts(a.children), 0);
}

// Flat list item (from /api/accounts for parent select)
interface AccountFlat {
  id: number;
  code: string;
  nameAr: string;
  type: AccountType;
}

// ─── Zod schema ───────────────────────────────────────────────────────────────

const accountSchema = z.object({
  code: z.string().min(1, 'رمز الحساب مطلوب'),
  nameAr: z.string().min(1, 'اسم الحساب مطلوب'),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
  parentId: z.string().optional(),
  openingBalance: z.string().optional(),
  isActive: z.string().optional(),
});

type AccountFormValues = z.infer<typeof accountSchema>;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

const TYPE_META: Record<
  AccountType,
  { label: string; icon: React.ReactNode; color: string; iconColor: string }
> = {
  ASSET: {
    label: 'الأصول',
    icon: <Landmark size={22} />,
    color: 'bg-primary-50',
    iconColor: 'text-primary',
  },
  LIABILITY: {
    label: 'الخصوم (الالتزامات)',
    icon: <TrendingDown size={22} />,
    color: 'bg-danger-bg',
    iconColor: 'text-danger',
  },
  EQUITY: {
    label: 'حقوق الملكية',
    icon: <Scale size={22} />,
    color: 'bg-purple-50',
    iconColor: 'text-purple-600',
  },
  REVENUE: {
    label: 'الإيرادات',
    icon: <TrendingUp size={22} />,
    color: 'bg-success-bg',
    iconColor: 'text-success',
  },
  EXPENSE: {
    label: 'المصروفات',
    icon: <Coins size={22} />,
    color: 'bg-warning-bg',
    iconColor: 'text-warning',
  },
};

const TYPE_ORDER: AccountType[] = [
  'ASSET',
  'LIABILITY',
  'EQUITY',
  'REVENUE',
  'EXPENSE',
];

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  icon,
  label,
  value,
  color,
  iconColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
  iconColor: string;
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
        <p className="text-lg font-bold text-app-text truncate">{value}</p>
      </div>
    </div>
  );
}

// ─── Account Row (with child indent) ─────────────────────────────────────────

function AccountRow({
  account,
  depth,
  onEdit,
  onDelete,
  onLedger,
  canEdit,
  canDelete,
}: {
  account: Account;
  depth: number;
  onEdit: (a: Account) => void;
  onDelete: (a: Account) => void;
  onLedger: (a: Account) => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  return (
    <tr className="border-b border-app-border last:border-0 hover:bg-gray-50 transition-colors">
      <td className="py-3 px-4 text-sm font-mono text-app-muted">
        {account.code}
      </td>
      <td className="py-3 px-4 text-sm text-app-text">
        {depth > 0 ? (
          <span
            className="inline-flex items-center gap-1"
            style={{ paddingRight: depth * 20 }}
          >
            <span className="text-app-muted text-xs ml-2 pl-2">└ ─</span>
            {account.nameAr}
          </span>
        ) : (
          <span className="font-semibold">{account.nameAr}</span>
        )}
      </td>
      <td className="py-3 px-4 text-sm font-mono text-left" dir="ltr">
        <span
          className={
            Number(account.currentBalance) < 0
              ? 'text-danger font-semibold'
              : 'text-app-text'
          }
        >
          {formatMoney(Number(account.currentBalance))}
        </span>
      </td>
      <td className="py-3 px-4">
        <Badge variant={account.isActive ? 'success' : 'danger'}>
          {account.isActive ? 'نشط' : 'غير نشط'}
        </Badge>
      </td>
      <td className="py-3 px-4">
        <div className="flex items-center gap-1">
          <button
            onClick={() => onLedger(account)}
            className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary transition-colors"
            title="كشف الحساب"
          >
            <FileText size={14} />
          </button>
          {canEdit && (
            <button
              onClick={() => onEdit(account)}
              className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary transition-colors"
              title="تعديل"
            >
              <Pencil size={14} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => onDelete(account)}
              className="p-1.5 rounded-lg hover:bg-red-50 text-app-muted hover:text-danger transition-colors"
              title="حذف"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ─── Account Group Section ────────────────────────────────────────────────────

function renderAccountRows(
  accounts: Account[],
  depth: number,
  props: {
    onEdit: (a: Account) => void;
    onDelete: (a: Account) => void;
    onLedger: (a: Account) => void;
    canEdit: boolean;
    canDelete: boolean;
  }
): React.ReactNode[] {
  return accounts.flatMap((a) => [
    <AccountRow key={a.id} account={a} depth={depth} {...props} />,
    ...renderAccountRows(a.children, depth + 1, props),
  ]);
}

function AccountGroupSection({
  group,
  onEdit,
  onDelete,
  onLedger,
  canEdit,
  canDelete,
}: {
  group: AccountGroup;
  onEdit: (a: Account) => void;
  onDelete: (a: Account) => void;
  onLedger: (a: Account) => void;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const meta = TYPE_META[group.type];
  const accountCount = countAccounts(group.accounts);

  return (
    <div className="bg-white rounded-2xl border border-app-border shadow-sm overflow-hidden mb-4">
      {/* Section header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-app-border bg-gray-50/60">
        <div className="flex items-center gap-3">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${meta.color} ${meta.iconColor}`}
          >
            {meta.icon}
          </div>
          <div>
            <h3 className="font-bold text-app-text text-base">
              {meta.label}
              <span className="mr-2 text-sm font-normal text-app-muted">
                ({accountCount} حساب)
              </span>
            </h3>
          </div>
        </div>
        <div className="text-sm font-mono font-bold text-app-text" dir="ltr">
          {formatMoney(group.total)}
        </div>
      </div>

      {/* Table */}
      {group.accounts.length === 0 ? (
        <div className="py-8 text-center text-app-muted text-sm">
          لا توجد حسابات في هذا النوع
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full" dir="rtl">
            <thead>
              <tr className="border-b border-app-border bg-gray-50 text-xs text-app-muted">
                <th className="py-2.5 px-4 text-right font-medium w-28">
                  رمز الحساب
                </th>
                <th className="py-2.5 px-4 text-right font-medium">
                  اسم الحساب
                </th>
                <th className="py-2.5 px-4 text-right font-medium w-44">
                  الرصيد الحالي
                </th>
                <th className="py-2.5 px-4 text-right font-medium w-24">
                  الحالة
                </th>
                <th className="py-2.5 px-4 text-right font-medium w-24">
                  العمليات
                </th>
              </tr>
            </thead>
            <tbody>
              {renderAccountRows(group.accounts, 0, {
                onEdit,
                onDelete,
                onLedger,
                canEdit,
                canDelete,
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Ledger Types ─────────────────────────────────────────────────────────────

interface LedgerLine {
  entryNo: string;
  date: string;
  description: string;
  sourceType: string;
  debit: number;
  credit: number;
  balance: number;
}

interface LedgerData {
  account: { id: number; code: string; nameAr: string; type: string; currentBalance: number };
  lines: LedgerLine[];
  closingBalance: number;
}

// ─── Account Ledger Modal ─────────────────────────────────────────────────────

function LedgerModal({
  accountId,
  accountName,
  open,
  onClose,
}: {
  accountId: number | null;
  accountName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery<LedgerData>({
    queryKey: ['account-ledger', accountId],
    queryFn: async () =>
      (await apiClient.get<LedgerData>(`/accounts/${accountId}/ledger`)).data,
    enabled: open && accountId !== null,
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`كشف حساب: ${accountName}`}
      size="xl"
      footer={<Button variant="outline" onClick={onClose}>إغلاق</Button>}
    >
      {isLoading ? (
        <div className="py-8 text-center text-app-muted text-sm">جارٍ التحميل...</div>
      ) : !data ? (
        <div className="py-8 text-center text-app-muted text-sm">لا توجد بيانات</div>
      ) : (
        <div dir="rtl">
          {/* Account info header */}
          <div className="flex items-center justify-between mb-4 bg-gray-50 rounded-xl px-4 py-3">
            <div>
              <span className="font-mono text-xs text-app-muted">{data.account.code}</span>
              <span className="mx-2 font-bold text-app-text">{data.account.nameAr}</span>
            </div>
            <div className="text-left">
              <p className="text-xs text-app-muted mb-0.5">الرصيد الختامي</p>
              <p className={`font-mono font-bold text-sm ${Number(data.closingBalance) < 0 ? 'text-danger' : 'text-primary'}`}>
                {formatMoney(Number(data.closingBalance))}
              </p>
            </div>
          </div>

          {/* Lines table */}
          {data.lines.length === 0 ? (
            <div className="py-10 text-center bg-gray-50 rounded-xl">
              <FileText size={32} className="text-app-muted mx-auto mb-2" />
              <p className="text-app-muted text-sm">لا توجد حركات لهذا الحساب</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-app-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50 border-b border-app-border text-app-muted">
                    <th className="text-right px-3 py-2.5 font-semibold">التاريخ</th>
                    <th className="text-right px-3 py-2.5 font-semibold">البيان</th>
                    <th className="text-right px-3 py-2.5 font-semibold">رقم القيد</th>
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
                      <td className="px-3 py-2 font-mono text-primary">{line.entryNo}</td>
                      <td className="px-3 py-2 font-mono font-bold text-primary">
                        {Number(line.debit) > 0 ? formatMoney(Number(line.debit)) : '—'}
                      </td>
                      <td className="px-3 py-2 font-mono font-bold text-success">
                        {Number(line.credit) > 0 ? formatMoney(Number(line.credit)) : '—'}
                      </td>
                      <td className={`px-3 py-2 font-mono font-bold ${Number(line.balance) < 0 ? 'text-danger' : 'text-app-text'}`}>
                        {formatMoney(Number(line.balance))}
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export function AccountsPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('accounts.create');
  const canEdit = usePermission('accounts.edit');
  const canDelete = usePermission('accounts.delete');

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [ledgerTarget, setLedgerTarget] = useState<Account | null>(null);

  // Fetch grouped tree
  const { data: treeData, isLoading } = useQuery<AccountGroup[]>({
    queryKey: ['accounts-tree'],
    queryFn: async () => {
      const res = await apiClient.get<AccountGroup[]>('/accounts/tree');
      return res.data;
    },
  });

  // Flat list for parent select in form
  const { data: flatData } = useQuery<{ data: AccountFlat[] }>({
    queryKey: ['accounts-flat'],
    queryFn: async () => {
      const res = await apiClient.get<{ data: AccountFlat[] }>('/accounts', {
        params: { page: 1, pageSize: 200 },
      });
      return res.data;
    },
  });

  const flatAccounts = flatData?.data ?? [];

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: { type: 'ASSET', isActive: 'true' },
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiClient.post('/accounts', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts-tree'] });
      qc.invalidateQueries({ queryKey: ['accounts-flat'] });
      toast('تم إضافة الحساب بنجاح');
      setModalOpen(false);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الإضافة'), 'error'),
  });

  const editMutation = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: number;
      body: Record<string, unknown>;
    }) => apiClient.put(`/accounts/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts-tree'] });
      qc.invalidateQueries({ queryKey: ['accounts-flat'] });
      toast('تم تعديل الحساب بنجاح');
      setModalOpen(false);
      setEditTarget(null);
      reset();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء التعديل'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/accounts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['accounts-tree'] });
      qc.invalidateQueries({ queryKey: ['accounts-flat'] });
      toast('تم حذف الحساب');
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحذف'), 'error'),
  });

  const openCreate = () => {
    setEditTarget(null);
    reset({
      code: '',
      nameAr: '',
      type: 'ASSET',
      parentId: '',
      openingBalance: '0',
      isActive: 'true',
    });
    setModalOpen(true);
  };

  const openEdit = (a: Account) => {
    setEditTarget(a);
    reset({
      code: a.code,
      nameAr: a.nameAr,
      type: a.type,
      parentId: a.parentId ? String(a.parentId) : '',
      openingBalance: String(a.openingBalance ?? 0),
      isActive: a.isActive ? 'true' : 'false',
    });
    setModalOpen(true);
  };

  const onSubmit = (values: AccountFormValues) => {
    const body: Record<string, unknown> = {
      code: values.code,
      nameAr: values.nameAr,
      type: values.type,
      parentId:
        values.parentId && values.parentId !== ''
          ? parseInt(values.parentId)
          : null,
      openingBalance: values.openingBalance
        ? parseFloat(values.openingBalance)
        : 0,
      isActive: values.isActive !== 'false',
    };
    if (editTarget) {
      editMutation.mutate({ id: editTarget.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  const isSaving = createMutation.isPending || editMutation.isPending;

  // KPI totals from tree
  const kpiMap: Record<AccountType, number> = {
    ASSET: 0,
    LIABILITY: 0,
    EQUITY: 0,
    REVENUE: 0,
    EXPENSE: 0,
  };
  if (treeData) {
    for (const group of treeData) {
      kpiMap[group.type] = group.total;
    }
  }

  return (
    <div>
      <PageHeader
        title="شجرة الحسابات المالية"
        subtitle="إدارة دليل الحسابات مصنفة حسب النوع المحاسبي"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={openCreate}>
              إضافة حساب مالي جديد
            </Button>
          ) : undefined
        }
      />

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        {TYPE_ORDER.map((type) => {
          const meta = TYPE_META[type];
          return (
            <KpiCard
              key={type}
              icon={meta.icon}
              label={meta.label}
              value={formatMoney(kpiMap[type])}
              color={meta.color}
              iconColor={meta.iconColor}
            />
          );
        })}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="py-16 text-center text-app-muted text-sm">
          جارٍ تحميل الحسابات...
        </div>
      )}

      {/* Group sections */}
      {treeData &&
        TYPE_ORDER.map((type) => {
          const group = treeData.find((g) => g.type === type);
          if (!group) return null;
          return (
            <AccountGroupSection
              key={type}
              group={group}
              onEdit={openEdit}
              onDelete={setDeleteTarget}
              onLedger={setLedgerTarget}
              canEdit={canEdit}
              canDelete={canDelete}
            />
          );
        })}

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditTarget(null);
          reset();
        }}
        title={editTarget ? 'تعديل الحساب المالي' : 'إضافة حساب مالي جديد'}
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
              {editTarget ? 'حفظ التعديلات' : 'إضافة الحساب'}
            </Button>
          </>
        }
      >
        <form
          className="grid grid-cols-2 gap-4"
          onSubmit={handleSubmit(onSubmit)}
        >
          <Input
            label="رمز الحساب"
            required
            placeholder="مثال: 1000"
            {...register('code')}
            error={errors.code?.message}
          />
          <Input
            label="اسم الحساب"
            required
            placeholder="اسم الحساب بالعربية"
            {...register('nameAr')}
            error={errors.nameAr?.message}
          />
          <Select
            label="نوع الحساب"
            {...register('type')}
            error={errors.type?.message}
          >
            {TYPE_ORDER.map((t) => (
              <option key={t} value={t}>
                {TYPE_META[t].label}
              </option>
            ))}
          </Select>
          <Select
            label="الحساب الرئيسي (اختياري)"
            {...register('parentId')}
            error={errors.parentId?.message}
          >
            <option value="">— لا يوجد —</option>
            {flatAccounts
              .filter((a) => !editTarget || a.id !== editTarget.id)
              .map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.code} — {a.nameAr}
                </option>
              ))}
          </Select>
          <Input
            label="الرصيد الافتتاحي (ر.س)"
            type="number"
            step="0.01"
            placeholder="0.00"
            {...register('openingBalance')}
            error={errors.openingBalance?.message}
          />
          <Select
            label="الحالة"
            {...register('isActive')}
            error={errors.isActive?.message}
          >
            <option value="true">نشط</option>
            <option value="false">غير نشط</option>
          </Select>
        </form>
      </Modal>

      {/* Delete Confirm */}
      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="تأكيد حذف الحساب"
        size="sm"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
            >
              إلغاء
            </Button>
            <Button
              variant="danger"
              loading={deleteMutation.isPending}
              onClick={() =>
                deleteTarget && deleteMutation.mutate(deleteTarget.id)
              }
            >
              حذف الحساب
            </Button>
          </>
        }
      >
        <p className="text-sm text-app-text">
          هل تريد حذف الحساب{' '}
          <span className="font-bold">
            {deleteTarget?.code} — {deleteTarget?.nameAr}
          </span>
          ؟ لن يمكن التراجع عن هذا الإجراء.
        </p>
      </Modal>

      {/* Account Ledger Modal */}
      <LedgerModal
        accountId={ledgerTarget?.id ?? null}
        accountName={ledgerTarget ? `${ledgerTarget.code} — ${ledgerTarget.nameAr}` : ''}
        open={!!ledgerTarget}
        onClose={() => setLedgerTarget(null)}
      />
    </div>
  );
}
