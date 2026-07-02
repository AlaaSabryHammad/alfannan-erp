import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Select } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { usePermission } from '../../contexts/AuthContext';
import { formatMoney, getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';

// --- Types ---
interface BudgetRow {
  accountId: number;
  code: string;
  nameAr: string;
  type: 'REVENUE' | 'EXPENSE';
  months: number[];
  total: number;
}

interface BudgetGridResponse {
  year: number;
  rows: BudgetRow[];
}

const MONTH_LABELS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// --- Edit Modal — 12 monthly inputs for one account/year ---
function EditBudgetModal({
  row,
  year,
  onClose,
}: {
  row: BudgetRow | null;
  year: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [months, setMonths] = useState<string[]>(Array(12).fill(''));
  const [initializedFor, setInitializedFor] = useState<number | null>(null);

  // Seed the local inputs from the row's saved values exactly once per row opened.
  if (row && initializedFor !== row.accountId) {
    setMonths(row.months.map((m) => (m ? String(m) : '')));
    setInitializedFor(row.accountId);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/budgets/grid', {
        accountId: row!.accountId,
        year,
        months: months.map((m) => parseFloat(m) || 0),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets-grid'] });
      toast('تم حفظ الموازنة بنجاح');
      setInitializedFor(null);
      onClose();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحفظ'), 'error'),
  });

  const handleClose = () => {
    setInitializedFor(null);
    onClose();
  };

  return (
    <Modal
      open={!!row}
      onClose={handleClose}
      title={row ? `موازنة ${row.nameAr} — ${year}` : 'موازنة'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={handleClose}>إلغاء</Button>
          <Button loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>حفظ</Button>
        </>
      }
    >
      {row && (
        <div dir="rtl" className="grid grid-cols-3 gap-3">
          {MONTH_LABELS.map((label, idx) => (
            <div key={idx} className="flex flex-col gap-1">
              <label className="text-xs font-medium text-app-text">{label}</label>
              <input
                type="number"
                min="0"
                step="0.01"
                className="w-full text-sm border border-app-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
                value={months[idx] ?? ''}
                onChange={(e) => {
                  const next = [...months];
                  next[idx] = e.target.value;
                  setMonths(next);
                }}
              />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

// --- Component ---
export function BudgetsPage() {
  const canEdit = usePermission('accounts.edit');
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [editRow, setEditRow] = useState<BudgetRow | null>(null);

  const { data, isLoading } = useQuery<BudgetGridResponse>({
    queryKey: ['budgets-grid', year],
    queryFn: async () => (await apiClient.get<BudgetGridResponse>('/budgets/grid', { params: { year } })).data,
  });

  const rows = data?.rows ?? [];
  const yearOptions = Array.from({ length: 6 }, (_, i) => currentYear - 2 + i);

  return (
    <div>
      <PageHeader
        title="الموازنات التقديرية"
        subtitle="تحديد الموازنة الشهرية لحسابات الإيرادات والمصروفات لمقارنتها بالفعلي"
        actions={
          <div className="w-40">
            <Select value={String(year)} onChange={(e) => setYear(parseInt(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </Select>
          </div>
        }
      />

      <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5">
        {isLoading ? (
          <div className="py-16 text-center text-app-muted text-sm">جارٍ التحميل...</div>
        ) : (
          <div dir="rtl" className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-app-border bg-gray-50 text-xs text-app-muted">
                  <th className="text-right px-4 py-3 font-semibold">الحساب</th>
                  <th className="text-right px-4 py-3 font-semibold">النوع</th>
                  <th className="text-right px-4 py-3 font-semibold w-40">الموازنة السنوية</th>
                  <th className="text-right px-4 py-3 font-semibold w-20">تعديل</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.accountId} className="border-b border-app-border/60 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="font-mono text-app-muted ml-2">{row.code}</span>
                      <span className="font-medium">{row.nameAr}</span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={row.type === 'REVENUE' ? 'success' : 'warning'}>
                        {row.type === 'REVENUE' ? 'إيراد' : 'مصروف'}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono font-bold">{formatMoney(row.total)}</td>
                    <td className="px-4 py-3">
                      {canEdit && (
                        <button
                          onClick={() => setEditRow(row)}
                          className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary transition-colors"
                        >
                          <Pencil size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <EditBudgetModal row={editRow} year={year} onClose={() => setEditRow(null)} />
    </div>
  );
}
