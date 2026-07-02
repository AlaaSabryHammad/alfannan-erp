import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, Eye, Trash2 } from 'lucide-react';
import apiClient from '../../lib/api';
import { usePermission } from '../../contexts/AuthContext';
import { formatMoney, formatDate, getApiErrorMessage } from '../../lib/utils';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import type { PaginatedResponse, PaginationMeta } from '../../types';

interface PayrollRun {
  id: number;
  runNo: string;
  month: number;
  year: number;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  status: 'DRAFT' | 'POSTED';
  createdAt: string;
  _count?: { items: number };
}

interface PayrollItem {
  id: number;
  basic: number;
  allowances: number;
  deductions: number;
  net: number;
  employee: { id: number; nameAr: string; position: string | null; bankAccount: string | null };
}

interface PayrollRunDetail extends PayrollRun {
  items: PayrollItem[];
}

const MONTHS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2500);
}

function KpiCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="bg-white rounded-2xl border border-app-border shadow-sm p-4">
      <p className="text-xs text-app-muted mb-1">{label}</p>
      <p className={`text-lg font-bold ${tone}`}>{value}</p>
    </div>
  );
}

export function PayrollPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('hr.create');
  const canDelete = usePermission('hr.delete');

  const [page, setPage] = useState(1);
  const [runOpen, setRunOpen] = useState(false);
  const [viewId, setViewId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PayrollRun | null>(null);

  const { data, isLoading } = useQuery<PaginatedResponse<PayrollRun>>({
    queryKey: ['payroll-runs', page],
    queryFn: async () => (await apiClient.get<PaginatedResponse<PayrollRun>>('/payroll/runs', { params: { page, pageSize: 20 } })).data,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/payroll/runs/${id}`),
    onSuccess: () => {
      toast('تم حذف دورة الرواتب وعكس قيدها ✓');
      qc.invalidateQueries({ queryKey: ['payroll-runs'] });
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر الحذف'), 'error'),
  });

  // Aggregate KPIs from all runs
  const runs = data?.data ?? [];
  const totalGross = runs.reduce((s, r) => s + Number(r.totalGross), 0);
  const totalNet = runs.reduce((s, r) => s + Number(r.totalNet), 0);
  const totalDeductions = runs.reduce((s, r) => s + Number(r.totalDeductions), 0);

  return (
    <div>
      <PageHeader
        title="الرواتب"
        subtitle="تشغيل دورات الرواتب الشهرية وترحيلها محاسبياً تلقائياً"
        actions={
          canCreate ? (
            <Button icon={<Play size={16} />} onClick={() => setRunOpen(true)}>
              تشغيل رواتب شهر
            </Button>
          ) : null
        }
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
        <KpiCard label="عدد الدورات" value={String(runs.length)} tone="text-app-text" />
        <KpiCard label="إجمالي الرواتب" value={formatMoney(totalGross)} tone="text-primary" />
        <KpiCard label="إجمالي الخصومات" value={formatMoney(totalDeductions)} tone="text-danger" />
        <KpiCard label="إجمالي الصافي المدفوع" value={formatMoney(totalNet)} tone="text-success" />
      </div>

      {/* Runs table */}
      <div className="bg-white rounded-2xl border border-app-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-app-border">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-semibold text-app-muted">رقم الدورة</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-app-muted">الفترة</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-app-muted">عدد الموظفين</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-app-muted">الإجمالي</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-app-muted">الخصومات</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-app-muted">الصافي</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-app-muted">الحالة</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-app-muted">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-app-muted"><span className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" /></td></tr>
              ) : runs.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-app-muted">لا توجد دورات رواتب بعد</td></tr>
              ) : (
                runs.map((r) => (
                  <tr key={r.id} className="border-b border-app-border last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono font-medium">{r.runNo}</td>
                    <td className="px-4 py-3">{MONTHS[r.month - 1]} {r.year}</td>
                    <td className="px-4 py-3 text-app-muted">{r._count?.items ?? '—'}</td>
                    <td className="px-4 py-3 text-left font-mono">{formatMoney(r.totalGross)}</td>
                    <td className="px-4 py-3 text-left font-mono text-danger">− {formatMoney(r.totalDeductions)}</td>
                    <td className="px-4 py-3 text-left font-mono font-bold text-success">{formatMoney(r.totalNet)}</td>
                    <td className="px-4 py-3"><Badge variant={r.status === 'POSTED' ? 'success' : 'warning'}>{r.status === 'POSTED' ? 'مُرحّلة' : 'مسودة'}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setViewId(r.id)} title="عرض التفاصيل" className="p-1.5 text-app-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors">
                          <Eye size={15} />
                        </button>
                        {canDelete && (
                          <button onClick={() => setDeleteTarget(r)} title="حذف" className="p-1.5 text-app-muted hover:text-danger hover:bg-danger/10 rounded-lg transition-colors">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {runOpen && (
        <RunPayrollModal
          onClose={() => setRunOpen(false)}
          onCreated={() => {
            setRunOpen(false);
            qc.invalidateQueries({ queryKey: ['payroll-runs'] });
          }}
        />
      )}

      {viewId !== null && (
        <RunDetailModal runId={viewId} onClose={() => setViewId(null)} />
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="تأكيد الحذف"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>
              حذف وعكس القيد
            </Button>
          </>
        }
      >
        <p className="text-sm text-app-text">
          سيتم حذف دورة <span className="font-mono font-bold">{deleteTarget?.runNo}</span> وعكس قيدها المحاسبي.
        </p>
      </Modal>
    </div>
  );
}

// ── Run payroll modal ─────────────────────────────────────────────────────────
function RunPayrollModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [payVia, setPayVia] = useState<'CASH' | 'PAYABLE'>('CASH');

  // Preview of what will be paid
  const { data: empData } = useQuery<PaginatedResponse<{ basicSalary: number; allowances: number; deductions: number; status: string }>>({
    queryKey: ['employees-preview'],
    queryFn: async () => (await apiClient.get('/employees', { params: { page: 1, pageSize: 500, status: 'ACTIVE' } })).data,
  });
  const previewNet = (empData?.data ?? []).reduce((s, e) => s + Number(e.basicSalary) + Number(e.allowances) - Number(e.deductions), 0);

  const mutation = useMutation({
    mutationFn: () => apiClient.post('/payroll/run', { month, year, payVia }),
    onSuccess: () => {
      toast('تم تشغيل الرواتب وترحيل القيد بنجاح ✓');
      onCreated();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر تشغيل الرواتب'), 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="تشغيل رواتب شهر"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!empData || empData.data.length === 0}>
            تشغيل وترحيل
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Select label="الشهر" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </Select>
          <Input label="السنة" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </div>
        <Select label="طريقة الدفع" value={payVia} onChange={(e) => setPayVia(e.target.value as 'CASH' | 'PAYABLE')}>
          <option value="CASH">نقداً من الخزينة</option>
          <option value="PAYABLE">مستحقات للعاملين (تُدفع لاحقاً)</option>
        </Select>
        <div className="bg-primary-50 rounded-lg p-3 space-y-1">
          <div className="flex justify-between text-sm">
            <span className="text-app-muted">عدد الموظفين:</span>
            <span className="font-medium">{empData?.data.length ?? 0}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-app-muted">إجمالي الصافي المتوقع:</span>
            <span className="font-bold text-primary">{formatMoney(previewNet)}</span>
          </div>
        </div>
        <p className="text-xs text-app-muted">
          سيتم إنشاء قيد محاسبي: مدين «الرواتب والأجور» / دائن «النقدية» أو «المستحقات للعاملين».
        </p>
      </div>
    </Modal>
  );
}

// ── Run detail modal ──────────────────────────────────────────────────────────
function RunDetailModal({ runId, onClose }: { runId: number; onClose: () => void }) {
  const { data: run, isLoading } = useQuery<PayrollRunDetail>({
    queryKey: ['payroll-run-detail', runId],
    queryFn: async () => (await apiClient.get<PayrollRunDetail>(`/payroll/runs/${runId}`)).data,
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={run ? `دورة رواتب ${run.runNo}` : 'تفاصيل الدورة'}
      size="xl"
      footer={<Button variant="outline" onClick={onClose}>إغلاق</Button>}
    >
      {isLoading || !run ? (
        <div className="flex justify-center py-10"><span className="inline-block w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-app-muted mb-0.5">الإجمالي</p><p className="font-bold">{formatMoney(run.totalGross)}</p></div>
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-app-muted mb-0.5">الخصومات</p><p className="font-bold text-danger">{formatMoney(run.totalDeductions)}</p></div>
            <div className="bg-gray-50 rounded-lg p-3"><p className="text-xs text-app-muted mb-0.5">الصافي</p><p className="font-bold text-success">{formatMoney(run.totalNet)}</p></div>
          </div>
          <div className="overflow-x-auto rounded-xl border border-app-border">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">الموظف</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">الوظيفة</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-app-muted">الأساسي</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-app-muted">البدلات</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-app-muted">الخصومات</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-app-muted">الصافي</th>
                </tr>
              </thead>
              <tbody>
                {run.items.map((it) => (
                  <tr key={it.id} className="border-t border-app-border">
                    <td className="px-3 py-2 font-medium">{it.employee.nameAr}</td>
                    <td className="px-3 py-2 text-app-muted">{it.employee.position ?? '—'}</td>
                    <td className="px-3 py-2 text-left font-mono">{formatMoney(it.basic)}</td>
                    <td className="px-3 py-2 text-left font-mono text-success">+ {formatMoney(it.allowances)}</td>
                    <td className="px-3 py-2 text-left font-mono text-danger">− {formatMoney(it.deductions)}</td>
                    <td className="px-3 py-2 text-left font-mono font-bold">{formatMoney(it.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}
