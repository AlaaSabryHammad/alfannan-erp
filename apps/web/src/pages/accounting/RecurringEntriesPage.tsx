import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Play, Repeat } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { usePermission } from '../../contexts/AuthContext';
import { formatMoney, formatDate, getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

// --- Types ---
interface RecurringLine {
  id?: number;
  accountId: string;
  debit: string;
  credit: string;
  description: string;
}

interface RecurringLineFull {
  id: number;
  accountId: number;
  debit: number;
  credit: number;
  description: string | null;
  account: { code: string; nameAr: string };
}

interface RecurringEntry {
  id: number;
  description: string;
  dayOfMonth: number;
  startDate: string;
  endDate: string | null;
  lastRunDate: string | null;
  nextDueDate: string;
  isActive: boolean;
  lines: RecurringLineFull[];
}

interface AccountFlat {
  id: number;
  code: string;
  nameAr: string;
  type: string;
}

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

const emptyLines = (): RecurringLine[] => [
  { accountId: '', debit: '', credit: '', description: '' },
  { accountId: '', debit: '', credit: '', description: '' },
];

// --- Create / Edit Modal ---
function TemplateModal({
  open,
  onClose,
  accounts,
  editTarget,
}: {
  open: boolean;
  onClose: () => void;
  accounts: AccountFlat[];
  editTarget: RecurringEntry | null;
}) {
  const qc = useQueryClient();
  const [description, setDescription] = useState('');
  const [dayOfMonth, setDayOfMonth] = useState('1');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [lines, setLines] = useState<RecurringLine[]>(emptyLines());
  const [error, setError] = useState('');
  const [initializedFor, setInitializedFor] = useState<number | null | 'new'>(null);

  const targetKey = editTarget ? editTarget.id : (open ? 'new' : null);
  if (open && initializedFor !== targetKey) {
    if (editTarget) {
      setDescription(editTarget.description);
      setDayOfMonth(String(editTarget.dayOfMonth));
      setStartDate(editTarget.startDate.slice(0, 10));
      setEndDate(editTarget.endDate ? editTarget.endDate.slice(0, 10) : '');
      setLines(editTarget.lines.map((l) => ({
        id: l.id,
        accountId: String(l.accountId),
        debit: Number(l.debit) ? String(l.debit) : '',
        credit: Number(l.credit) ? String(l.credit) : '',
        description: l.description ?? '',
      })));
    } else {
      setDescription('');
      setDayOfMonth('1');
      setStartDate('');
      setEndDate('');
      setLines(emptyLines());
    }
    setError('');
    setInitializedFor(targetKey);
  }

  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.001 && totalDebit > 0;

  const updateLine = (idx: number, field: keyof RecurringLine, value: string) => {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === 'debit' && value) next[idx].credit = '';
      if (field === 'credit' && value) next[idx].debit = '';
      return next;
    });
  };

  const addLine = () => setLines((prev) => [...prev, { accountId: '', debit: '', credit: '', description: '' }]);
  const removeLine = (idx: number) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const saveMutation = useMutation({
    mutationFn: (body: unknown) =>
      editTarget
        ? apiClient.put(`/recurring-entries/${editTarget.id}`, body)
        : apiClient.post('/recurring-entries', body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-entries'] });
      toast(editTarget ? 'تم تعديل القيد المتكرر بنجاح' : 'تم إنشاء القيد المتكرر بنجاح');
      handleClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'حدث خطأ أثناء الحفظ')),
  });

  const handleClose = () => {
    setInitializedFor(null);
    onClose();
  };

  const handleSubmit = () => {
    setError('');
    const validLines = lines
      .filter((l) => l.accountId && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0))
      .map((l) => ({
        accountId: parseInt(l.accountId),
        debit: parseFloat(l.debit) || 0,
        credit: parseFloat(l.credit) || 0,
        description: l.description || undefined,
      }));

    if (validLines.length < 2) {
      setError('يجب إدخال سطرين على الأقل بحسابات وقيم صحيحة');
      return;
    }

    saveMutation.mutate({
      description,
      dayOfMonth: parseInt(dayOfMonth) || 1,
      startDate: startDate || undefined,
      endDate: endDate || null,
      lines: validLines,
    });
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={editTarget ? 'تعديل قيد متكرر' : 'قيد متكرر جديد'}
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>إلغاء</Button>
          <Button onClick={handleSubmit} loading={saveMutation.isPending} disabled={!isBalanced || !description}>
            حفظ
          </Button>
        </>
      }
    >
      <div dir="rtl" className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-3">
            <Input label="البيان" required placeholder="مثال: إيجار مستودع شهري" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <Input label="يوم الترحيل من الشهر (1-28)" type="number" min="1" max="28" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
          <Input label="تاريخ البدء" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          <Input label="تاريخ الانتهاء (اختياري)" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>

        <div>
          <p className="text-xs font-bold text-app-muted uppercase tracking-wide mb-2">سطور القيد</p>
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                <div className="col-span-4">
                  <Select label={idx === 0 ? 'الحساب' : undefined} value={line.accountId} onChange={(e) => updateLine(idx, 'accountId', e.target.value)}>
                    <option value="">— اختر الحساب —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={String(a.id)}>{a.code} — {a.nameAr}</option>
                    ))}
                  </Select>
                </div>
                <div className="col-span-3">
                  <Input label={idx === 0 ? 'مدين' : undefined} type="number" min="0" step="0.01" placeholder="0.00" value={line.debit} onChange={(e) => updateLine(idx, 'debit', e.target.value)} />
                </div>
                <div className="col-span-3">
                  <Input label={idx === 0 ? 'دائن' : undefined} type="number" min="0" step="0.01" placeholder="0.00" value={line.credit} onChange={(e) => updateLine(idx, 'credit', e.target.value)} />
                </div>
                <div className="col-span-1">
                  <input
                    className="w-full text-sm border border-app-border rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
                    placeholder="بيان"
                    value={line.description}
                    onChange={(e) => updateLine(idx, 'description', e.target.value)}
                  />
                </div>
                <div className="col-span-1 flex justify-center">
                  {lines.length > 2 && (
                    <button onClick={() => removeLine(idx)} className="p-1.5 rounded-lg hover:bg-red-50 text-app-muted hover:text-danger transition-colors">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Button variant="ghost" size="sm" icon={<Plus size={14} />} onClick={addLine} className="mt-2">إضافة سطر</Button>
        </div>

        <div className={`rounded-xl px-4 py-2.5 text-center font-bold text-sm ${
          totalDebit === 0 && totalCredit === 0 ? 'bg-gray-100 text-app-muted' : isBalanced ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
        }`}>
          <div className="flex justify-between text-xs font-normal mb-0.5">
            <span>مدين: {formatMoney(totalDebit)}</span>
            <span>دائن: {formatMoney(totalCredit)}</span>
          </div>
          {isBalanced ? 'متوازن ✓' : totalDebit === 0 && totalCredit === 0 ? 'أدخل السطور' : 'غير متوازن ✗'}
        </div>

        {error && <div className="bg-danger-bg text-danger text-sm font-medium px-4 py-2.5 rounded-lg">{error}</div>}
      </div>
    </Modal>
  );
}

// --- Component ---
export function RecurringEntriesPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('recurring.create');
  const canEdit = usePermission('recurring.edit');
  const canDelete = usePermission('recurring.delete');

  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RecurringEntry | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RecurringEntry | null>(null);

  const { data, isLoading } = useQuery<PaginatedResponse<RecurringEntry>>({
    queryKey: ['recurring-entries'],
    queryFn: async () => (await apiClient.get<PaginatedResponse<RecurringEntry>>('/recurring-entries', { params: { page: 1, pageSize: 100 } })).data,
  });

  const { data: accountsData } = useQuery<{ data: AccountFlat[] }>({
    queryKey: ['accounts-flat'],
    queryFn: async () => (await apiClient.get<{ data: AccountFlat[] }>('/accounts', { params: { page: 1, pageSize: 500 } })).data,
  });

  const runMutation = useMutation({
    mutationFn: (id: number) => apiClient.post(`/recurring-entries/${id}/run`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-entries'] });
      qc.invalidateQueries({ queryKey: ['journal'] });
      toast('تم ترحيل القيد بنجاح');
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء ترحيل القيد'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/recurring-entries/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recurring-entries'] });
      toast('تم حذف القيد المتكرر');
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحذف'), 'error'),
  });

  const accounts = accountsData?.data ?? [];
  const rows = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="القيود المتكررة"
        subtitle="قوالب لقيود شهرية ثابتة (إيجار، اشتراكات...) يمكن ترحيلها بنقرة واحدة كل شهر"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={() => { setEditTarget(null); setModalOpen(true); }}>
              قيد متكرر جديد
            </Button>
          ) : undefined
        }
      />

      <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5">
        {isLoading ? (
          <div className="py-16 text-center text-app-muted text-sm">جارٍ التحميل...</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center">
            <Repeat size={40} className="text-app-muted mx-auto mb-3" />
            <p className="text-app-muted text-sm">لا توجد قيود متكررة حتى الآن</p>
          </div>
        ) : (
          <div dir="rtl" className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-app-border bg-gray-50 text-xs text-app-muted">
                  <th className="text-right px-4 py-3 font-semibold">البيان</th>
                  <th className="text-right px-4 py-3 font-semibold">القيمة</th>
                  <th className="text-right px-4 py-3 font-semibold">آخر ترحيل</th>
                  <th className="text-right px-4 py-3 font-semibold">الترحيل القادم</th>
                  <th className="text-right px-4 py-3 font-semibold">الحالة</th>
                  <th className="text-right px-4 py-3 font-semibold w-32">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const total = row.lines.reduce((s, l) => s + Number(l.debit), 0);
                  const isDue = row.isActive && new Date(row.nextDueDate) <= new Date();
                  return (
                    <tr key={row.id} className="border-b border-app-border/60 hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{row.description}</td>
                      <td className="px-4 py-3 font-mono font-bold">{formatMoney(total)}</td>
                      <td className="px-4 py-3 text-app-muted whitespace-nowrap">{row.lastRunDate ? formatDate(row.lastRunDate) : '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={isDue ? 'font-bold text-warning' : 'text-app-muted'}>{formatDate(row.nextDueDate)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={row.isActive ? 'success' : 'default'}>{row.isActive ? 'نشط' : 'متوقف'}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          {canCreate && (
                            <button
                              onClick={() => runMutation.mutate(row.id)}
                              disabled={runMutation.isPending}
                              title="ترحيل الآن"
                              className="p-1.5 rounded-lg hover:bg-success-bg text-app-muted hover:text-success transition-colors disabled:opacity-50"
                            >
                              <Play size={14} />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              onClick={() => { setEditTarget(row); setModalOpen(true); }}
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
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <TemplateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        accounts={accounts}
        editTarget={editTarget}
      />

      <Modal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        title="تأكيد الحذف"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>
              حذف
            </Button>
          </>
        }
      >
        <p className="text-sm text-app-text">
          هل تريد حذف القيد المتكرر <span className="font-bold">{deleteTarget?.description}</span>؟
        </p>
      </Modal>
    </div>
  );
}
