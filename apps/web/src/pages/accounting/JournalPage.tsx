import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Eye, BookOpen, Trash2, Lock } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { usePermission } from '../../contexts/AuthContext';
import { useDateRange } from '../../contexts/DateRangeContext';
import { formatMoney, formatDate, getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';

// ─── Types ─────────────────────────────────────────────────────────────────────

type SourceType = 'SALES_INVOICE' | 'PURCHASE_INVOICE' | 'EXPENSE' | 'MANUAL' | 'OPENING'
  | 'VOUCHER' | 'DEPRECIATION' | 'PAYROLL' | 'YEAR_CLOSE' | 'RECURRING';

interface JournalEntry {
  id: number;
  entryNo: string;
  date: string;
  description: string;
  sourceType: SourceType;
  sourceId: number | null;
  totalDebit: number;
  totalCredit: number;
}

interface JournalLine {
  id: number;
  account: { code: string; nameAr: string; type: string };
  debit: number;
  credit: number;
  description: string | null;
}

interface JournalEntryDetail extends JournalEntry {
  lines: JournalLine[];
}

interface JournalListResponse {
  data: JournalEntry[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

interface AccountFlat {
  id: number;
  code: string;
  nameAr: string;
  type: string;
}

interface CostCenterFlat {
  id: number;
  code: string;
  nameAr: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SOURCE_TYPE_META: Record<SourceType, { label: string; variant: 'success' | 'info' | 'warning' | 'danger' | 'default' }> = {
  SALES_INVOICE:    { label: 'مبيعات',   variant: 'success' },
  PURCHASE_INVOICE: { label: 'مشتريات',  variant: 'info' },
  EXPENSE:          { label: 'مصروف',    variant: 'warning' },
  MANUAL:           { label: 'يدوي',     variant: 'default' },
  OPENING:          { label: 'افتتاحي',  variant: 'danger' },
  VOUCHER:          { label: 'سند',      variant: 'info' },
  DEPRECIATION:     { label: 'أصول/إهلاك', variant: 'warning' },
  PAYROLL:          { label: 'رواتب',    variant: 'info' },
  YEAR_CLOSE:       { label: 'إقفال سنوي', variant: 'danger' },
  RECURRING:        { label: 'متكرر',     variant: 'default' },
};

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

// ─── Entry Detail Modal ────────────────────────────────────────────────────────

function EntryDetailModal({
  entryId,
  open,
  onClose,
}: {
  entryId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: entry, isLoading } = useQuery<JournalEntryDetail>({
    queryKey: ['journal-entry', entryId],
    queryFn: async () => (await apiClient.get<JournalEntryDetail>(`/journal/${entryId}`)).data,
    enabled: open && entryId !== null,
  });

  const totalDebit = entry?.lines.reduce((s, l) => s + Number(l.debit), 0) ?? 0;
  const totalCredit = entry?.lines.reduce((s, l) => s + Number(l.credit), 0) ?? 0;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={entry ? `تفاصيل القيد ${entry.entryNo}` : 'تفاصيل القيد'}
      size="xl"
      footer={
        <Button variant="outline" onClick={onClose}>إغلاق</Button>
      }
    >
      {isLoading ? (
        <div className="py-8 text-center text-app-muted text-sm">جارٍ التحميل...</div>
      ) : !entry ? (
        <div className="py-8 text-center text-app-muted text-sm">لا توجد بيانات</div>
      ) : (
        <div dir="rtl">
          {/* Entry header */}
          <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
            <div>
              <span className="text-app-muted text-xs">رقم القيد:</span>
              <p className="font-bold font-mono text-primary mt-0.5">{entry.entryNo}</p>
            </div>
            <div>
              <span className="text-app-muted text-xs">التاريخ:</span>
              <p className="font-medium mt-0.5">{formatDate(entry.date)}</p>
            </div>
            <div className="col-span-2">
              <span className="text-app-muted text-xs">البيان:</span>
              <p className="font-medium mt-0.5">{entry.description}</p>
            </div>
          </div>

          {/* Lines table */}
          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-app-border text-xs text-app-muted">
                  <th className="text-right px-4 py-2.5 font-semibold">الحساب</th>
                  <th className="text-right px-4 py-2.5 font-semibold">البيان</th>
                  <th className="text-right px-4 py-2.5 font-semibold w-36">مدين</th>
                  <th className="text-right px-4 py-2.5 font-semibold w-36">دائن</th>
                </tr>
              </thead>
              <tbody>
                {entry.lines.map((line) => (
                  <tr key={line.id} className="border-b border-app-border/60 hover:bg-gray-50">
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-app-muted ml-1">{line.account.code}</span>
                      <span className="font-medium">{line.account.nameAr}</span>
                    </td>
                    <td className="px-4 py-2.5 text-app-muted text-xs">{line.description ?? '—'}</td>
                    <td className="px-4 py-2.5 font-mono font-bold text-primary">
                      {Number(line.debit) > 0 ? formatMoney(Number(line.debit)) : '—'}
                    </td>
                    <td className="px-4 py-2.5 font-mono font-bold text-success">
                      {Number(line.credit) > 0 ? formatMoney(Number(line.credit)) : '—'}
                    </td>
                  </tr>
                ))}
                {/* Totals row */}
                <tr className="bg-gray-100 font-bold text-sm border-t-2 border-app-border">
                  <td className="px-4 py-2.5 text-app-muted" colSpan={2}>الإجمالي</td>
                  <td className="px-4 py-2.5 font-mono text-primary">{formatMoney(totalDebit)}</td>
                  <td className="px-4 py-2.5 font-mono text-success">{formatMoney(totalCredit)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Balance indicator */}
          <div className={`mt-3 text-center text-xs font-bold py-1.5 rounded-lg ${
            Math.abs(totalDebit - totalCredit) < 0.01
              ? 'bg-success-bg text-success'
              : 'bg-danger-bg text-danger'
          }`}>
            {Math.abs(totalDebit - totalCredit) < 0.01 ? 'القيد متوازن ✓' : 'القيد غير متوازن ✗'}
          </div>
        </div>
      )}
    </Modal>
  );
}

// ─── Manual Entry Line ─────────────────────────────────────────────────────────

interface ManualLine {
  accountId: string;
  debit: string;
  credit: string;
  description: string;
}

function ManualEntryModal({
  open,
  onClose,
  accounts,
}: {
  open: boolean;
  onClose: () => void;
  accounts: AccountFlat[];
}) {
  const qc = useQueryClient();
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [lines, setLines] = useState<ManualLine[]>([
    { accountId: '', debit: '', credit: '', description: '' },
    { accountId: '', debit: '', credit: '', description: '' },
  ]);
  const [error, setError] = useState('');

  const { data: costCentersData } = useQuery<{ data: CostCenterFlat[] }>({
    queryKey: ['cost-centers', 'flat'],
    queryFn: async () =>
      (await apiClient.get<{ data: CostCenterFlat[] }>('/cost-centers', { params: { page: 1, pageSize: 200 } })).data,
    enabled: open,
  });
  const costCenters = costCentersData?.data ?? [];

  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;
  const hasEnoughLines = lines.filter(l => l.accountId && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0)).length >= 2;

  const addLine = () =>
    setLines((prev) => [...prev, { accountId: '', debit: '', credit: '', description: '' }]);

  const removeLine = (idx: number) =>
    setLines((prev) => prev.filter((_, i) => i !== idx));

  const updateLine = (idx: number, field: keyof ManualLine, value: string) => {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      // Enforce debit/credit mutual exclusion
      if (field === 'debit' && value) next[idx].credit = '';
      if (field === 'credit' && value) next[idx].debit = '';
      return next;
    });
  };

  const createMutation = useMutation({
    // Manual entries go through maker-checker: this submits a PENDING request,
    // not an actual posted entry — it only affects balances once approved by
    // a different user on the /journal-approvals page.
    mutationFn: (body: unknown) => apiClient.post('/journal-approvals', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal-approvals'] });
      toast('تم إرسال القيد لموافقة مستخدم آخر بنجاح');
      handleClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'حدث خطأ أثناء إنشاء القيد')),
  });

  const handleClose = () => {
    setDescription('');
    setDate('');
    setCostCenterId('');
    setLines([
      { accountId: '', debit: '', credit: '', description: '' },
      { accountId: '', debit: '', credit: '', description: '' },
    ]);
    setError('');
    onClose();
  };

  const handleSubmit = () => {
    setError('');
    const validLines = lines
      .filter(l => l.accountId && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0))
      .map(l => ({
        accountId: parseInt(l.accountId),
        costCenterId: costCenterId ? parseInt(costCenterId) : undefined,
        debit: parseFloat(l.debit) || 0,
        credit: parseFloat(l.credit) || 0,
        description: l.description || undefined,
      }));

    if (validLines.length < 2) {
      setError('يجب إدخال سطرين على الأقل بحسابات وقيم صحيحة');
      return;
    }

    createMutation.mutate({
      description,
      date: date || undefined,
      lines: validLines,
    });
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="قيد يومية يدوي جديد"
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>إلغاء</Button>
          <Button
            onClick={handleSubmit}
            loading={createMutation.isPending}
            disabled={!isBalanced || !hasEnoughLines || !description}
          >
            إرسال للاعتماد
          </Button>
        </>
      }
    >
      <div dir="rtl" className="space-y-4">
        <div className="bg-primary-50 text-primary text-xs font-medium px-4 py-2.5 rounded-lg">
          هذا القيد لا يُرحَّل فوراً — يُرسَل كطلب اعتماد لا يؤثر على الأرصدة إلا بعد موافقة مستخدم آخر من صفحة «اعتماد القيود».
        </div>
        {/* Header fields */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-3">
            <Input
              label="البيان (الوصف)"
              required
              placeholder="وصف القيد المحاسبي..."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
          <Input
            label="التاريخ (اختياري)"
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
          />
          <Select
            label="مركز التكلفة (اختياري)"
            value={costCenterId}
            onChange={e => setCostCenterId(e.target.value)}
          >
            <option value="">— بدون —</option>
            {costCenters.map(c => (
              <option key={c.id} value={String(c.id)}>{c.code} — {c.nameAr}</option>
            ))}
          </Select>
          {/* Balance indicator */}
          <div className="flex items-end pb-0.5">
            <div className={`flex-1 rounded-xl px-4 py-2.5 text-center font-bold text-sm ${
              totalDebit === 0 && totalCredit === 0
                ? 'bg-gray-100 text-app-muted'
                : isBalanced
                ? 'bg-success-bg text-success'
                : 'bg-danger-bg text-danger'
            }`}>
              <div className="flex justify-between text-xs font-normal mb-0.5">
                <span>مدين: {formatMoney(totalDebit)}</span>
                <span>دائن: {formatMoney(totalCredit)}</span>
              </div>
              {isBalanced ? 'متوازن ✓' : totalDebit === 0 && totalCredit === 0 ? 'أدخل السطور' : 'غير متوازن ✗'}
            </div>
          </div>
        </div>

        {/* Lines */}
        <div>
          <p className="text-xs font-bold text-app-muted uppercase tracking-wide mb-2">سطور القيد</p>
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4">
                  <Select
                    label={idx === 0 ? 'الحساب' : undefined}
                    value={line.accountId}
                    onChange={e => updateLine(idx, 'accountId', e.target.value)}
                  >
                    <option value="">— اختر الحساب —</option>
                    {accounts.map(a => (
                      <option key={a.id} value={String(a.id)}>
                        {a.code} — {a.nameAr}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="col-span-3">
                  <Input
                    label={idx === 0 ? 'مدين' : undefined}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={line.debit}
                    onChange={e => updateLine(idx, 'debit', e.target.value)}
                  />
                </div>
                <div className="col-span-3">
                  <Input
                    label={idx === 0 ? 'دائن' : undefined}
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={line.credit}
                    onChange={e => updateLine(idx, 'credit', e.target.value)}
                  />
                </div>
                <div className="col-span-1">
                  {idx === 0 ? (
                    <Input
                      label="بيان"
                      placeholder="—"
                      value={line.description}
                      onChange={e => updateLine(idx, 'description', e.target.value)}
                    />
                  ) : (
                    <input
                      className="w-full text-sm border border-app-border rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
                      placeholder="بيان"
                      value={line.description}
                      onChange={e => updateLine(idx, 'description', e.target.value)}
                    />
                  )}
                </div>
                <div className="col-span-1 flex justify-center">
                  {idx === 0 ? (
                    <div className="text-xs text-app-muted text-center pt-5">حذف</div>
                  ) : null}
                  {lines.length > 2 && (
                    <button
                      onClick={() => removeLine(idx)}
                      className={`p-1.5 rounded-lg hover:bg-red-50 text-app-muted hover:text-danger transition-colors ${idx === 0 ? 'mt-0' : ''}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Button
            variant="ghost"
            size="sm"
            icon={<Plus size={14} />}
            onClick={addLine}
            className="mt-2"
          >
            إضافة سطر
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-danger-bg text-danger text-sm font-medium px-4 py-2.5 rounded-lg">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Year-End Closing Modal ─────────────────────────────────────────────────────

interface YearClosePreviewLine {
  accountId: number;
  code: string;
  nameAr: string;
  type: 'REVENUE' | 'EXPENSE';
  balance: number;
}

interface YearClosePreview {
  lines: YearClosePreviewLine[];
  netIncome: number;
}

function YearCloseModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [error, setError] = useState('');

  const { data: preview, isLoading } = useQuery<YearClosePreview>({
    queryKey: ['journal-close-year-preview'],
    queryFn: async () => (await apiClient.get<YearClosePreview>('/journal/close-year/preview')).data,
    enabled: open,
  });

  const closeMutation = useMutation({
    mutationFn: () => apiClient.post('/journal/close-year', { date }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal'] });
      qc.invalidateQueries({ queryKey: ['journal-close-year-preview'] });
      qc.invalidateQueries({ queryKey: ['reports-trial-balance'] });
      qc.invalidateQueries({ queryKey: ['reports-balance-sheet'] });
      qc.invalidateQueries({ queryKey: ['reports-income-statement'] });
      toast('تم إقفال السنة المالية بنجاح');
      handleClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'حدث خطأ أثناء إقفال السنة المالية')),
  });

  const handleClose = () => {
    setError('');
    onClose();
  };

  const hasBalances = (preview?.lines.length ?? 0) > 0;
  const netIncome = preview?.netIncome ?? 0;

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="إقفال السنة المالية"
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>إلغاء</Button>
          <Button
            variant="danger"
            icon={<Lock size={15} />}
            onClick={() => closeMutation.mutate()}
            loading={closeMutation.isPending}
            disabled={isLoading || !hasBalances}
          >
            تأكيد الإقفال
          </Button>
        </>
      }
    >
      <div dir="rtl" className="space-y-4">
        <p className="text-sm text-app-muted">
          سيتم تصفير أرصدة جميع حسابات الإيرادات والمصروفات، وترحيل صافي الربح أو الخسارة إلى حساب
          «الأرباح المرحلة» (7900). هذا الإجراء يُسجَّل كقيد يومية ولا يمكن التراجع عنه إلا بقيد عكسي يدوي.
        </p>

        <Input
          label="تاريخ قيد الإقفال"
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
        />

        {isLoading ? (
          <div className="py-8 text-center text-app-muted text-sm">جارٍ تحميل المعاينة...</div>
        ) : !hasBalances ? (
          <div className="bg-gray-100 text-app-muted text-sm font-medium px-4 py-3 rounded-lg text-center">
            لا توجد أرصدة إيرادات أو مصروفات لإقفالها حالياً
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 border-b border-app-border text-app-muted">
                  <th className="text-right px-4 py-2.5 font-semibold">الحساب</th>
                  <th className="text-right px-4 py-2.5 font-semibold">النوع</th>
                  <th className="text-right px-4 py-2.5 font-semibold w-32">الرصيد الحالي</th>
                </tr>
              </thead>
              <tbody>
                {preview!.lines.map((line) => (
                  <tr key={line.accountId} className="border-b border-app-border/60">
                    <td className="px-4 py-2">
                      <span className="font-mono text-app-muted ml-2">{line.code}</span>
                      <span className="font-medium">{line.nameAr}</span>
                    </td>
                    <td className="px-4 py-2">
                      <Badge variant={line.type === 'REVENUE' ? 'success' : 'warning'}>
                        {line.type === 'REVENUE' ? 'إيراد' : 'مصروف'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 font-mono font-bold">{formatMoney(line.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasBalances && (
          <div className={`rounded-xl px-4 py-3 flex items-center justify-between font-bold text-sm ${
            netIncome >= 0 ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
          }`}>
            <span>{netIncome >= 0 ? 'صافي الربح المرحّل' : 'صافي الخسارة المرحّلة'}</span>
            <span className="font-mono">{formatMoney(Math.abs(netIncome))}</span>
          </div>
        )}

        {error && (
          <div className="bg-danger-bg text-danger text-sm font-medium px-4 py-2.5 rounded-lg">
            {error}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Main Journal Page ─────────────────────────────────────────────────────────

export function JournalPage() {
  const canCreate = usePermission('accounts.create');
  const { from, to } = useDateRange();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [viewEntry, setViewEntry] = useState<number | null>(null);
  const [newEntryOpen, setNewEntryOpen] = useState(false);
  const [yearCloseOpen, setYearCloseOpen] = useState(false);

  const { data, isLoading, isError } = useQuery<JournalListResponse>({
    queryKey: ['journal', page, search, from, to],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, pageSize: 20, search };
      if (from) params.from = from;
      if (to) params.to = to;
      return (await apiClient.get<JournalListResponse>('/journal', { params })).data;
    },
  });

  const { data: accountsData } = useQuery<{ data: AccountFlat[] }>({
    queryKey: ['accounts-flat'],
    queryFn: async () =>
      (await apiClient.get<{ data: AccountFlat[] }>('/accounts', { params: { page: 1, pageSize: 500 } })).data,
  });

  const accounts = accountsData?.data ?? [];
  const entries = data?.data ?? [];
  const pagination = data?.pagination;

  return (
    <div>
      <PageHeader
        title="دفتر اليومية"
        subtitle="سجل القيود المحاسبية اليومية المزدوجة"
        actions={
          canCreate ? (
            <div className="flex gap-2">
              <Button variant="outline" icon={<Lock size={16} />} onClick={() => setYearCloseOpen(true)}>
                إقفال السنة المالية
              </Button>
              <Button icon={<Plus size={16} />} onClick={() => setNewEntryOpen(true)}>
                قيد يومية يدوي جديد
              </Button>
            </div>
          ) : undefined
        }
      />

      {/* Search */}
      <div className="mb-4 flex gap-3 items-center">
        <div className="w-72">
          <Input
            placeholder="بحث في القيود..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
      </div>

      {/* Table */}
      <Card padding="none">
        {isLoading ? (
          <div className="py-16 text-center text-app-muted text-sm">جارٍ تحميل القيود...</div>
        ) : isError ? (
          <div className="py-16 text-center text-danger text-sm">خطأ في تحميل البيانات. يُرجى المحاولة مجدداً.</div>
        ) : entries.length === 0 ? (
          <div className="py-16 text-center">
            <BookOpen size={40} className="text-app-muted mx-auto mb-3" />
            <p className="text-app-muted text-sm">لا توجد قيود يومية حتى الآن</p>
          </div>
        ) : (
          <div className="overflow-x-auto" dir="rtl">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-app-border bg-gray-50 text-xs text-app-muted">
                  <th className="text-right px-4 py-3 font-semibold">رقم القيد</th>
                  <th className="text-right px-4 py-3 font-semibold">التاريخ</th>
                  <th className="text-right px-4 py-3 font-semibold">البيان</th>
                  <th className="text-right px-4 py-3 font-semibold">المصدر</th>
                  <th className="text-right px-4 py-3 font-semibold">مدين</th>
                  <th className="text-right px-4 py-3 font-semibold">دائن</th>
                  <th className="text-right px-4 py-3 font-semibold w-20">عرض</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const srcMeta = SOURCE_TYPE_META[entry.sourceType] ?? { label: entry.sourceType, variant: 'default' as const };
                  return (
                    <tr
                      key={entry.id}
                      className="border-b border-app-border/60 hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 font-mono font-bold text-primary">{entry.entryNo}</td>
                      <td className="px-4 py-3 text-app-muted whitespace-nowrap">{formatDate(entry.date)}</td>
                      <td className="px-4 py-3 text-app-text max-w-xs truncate">{entry.description}</td>
                      <td className="px-4 py-3">
                        <Badge variant={srcMeta.variant}>{srcMeta.label}</Badge>
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-primary whitespace-nowrap">
                        {formatMoney(Number(entry.totalDebit))}
                      </td>
                      <td className="px-4 py-3 font-mono font-bold text-success whitespace-nowrap">
                        {formatMoney(Number(entry.totalCredit))}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setViewEntry(entry.id)}
                          className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary transition-colors"
                          title="عرض التفاصيل"
                        >
                          <Eye size={15} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-app-border" dir="rtl">
            <p className="text-xs text-app-muted">
              عرض {entries.length} من {pagination.total} قيد
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(p => p - 1)}
              >
                السابق
              </Button>
              <span className="text-xs text-app-muted self-center px-2">
                صفحة {page} من {pagination.totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page === pagination.totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                التالي
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Entry detail modal */}
      <EntryDetailModal
        entryId={viewEntry}
        open={viewEntry !== null}
        onClose={() => setViewEntry(null)}
      />

      {/* Manual entry modal */}
      <ManualEntryModal
        open={newEntryOpen}
        onClose={() => setNewEntryOpen(false)}
        accounts={accounts}
      />

      {/* Year-end closing modal */}
      <YearCloseModal
        open={yearCloseOpen}
        onClose={() => setYearCloseOpen(false)}
      />
    </div>
  );
}
