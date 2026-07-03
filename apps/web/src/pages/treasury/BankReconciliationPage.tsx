/**
 * التسوية البنكية — مطابقة حركات حساب البنك مع كشف البنك الفعلي
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, ListChecks, CheckCircle } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { usePermission } from '../../contexts/AuthContext';
import { formatMoney, formatDate, getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

interface AccountOpt { id: number; code: string; nameAr: string }
interface Recon {
  id: number; reconNo: string; status: 'DRAFT' | 'COMPLETED';
  statementDate: string; statementBalance: number; clearedBalance: number; difference: number;
  account: AccountOpt; _count?: { lines: number };
}

interface ReconLineDetail {
  journalLineId: number;
  journalLine: { id: number; debit: number; credit: number; description: string | null; entry: { entryNo: string; date: string; description: string } };
}
interface CandidateLine { id: number; entryNo: string; date: string; description: string; debit: number; credit: number }

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

// ── Matching modal (DRAFT sessions) ──────────────────────────────────────────

function MatchModal({ recon, open, onClose, onChanged }: {
  recon: Recon | null; open: boolean; onClose: () => void; onChanged: () => void;
}) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<{ cleared: number; diff: number } | null>(null);
  const [error, setError] = useState('');

  const { data: candidates = [] } = useQuery({
    queryKey: ['recon-unreconciled', recon?.id],
    queryFn: async () => (await apiClient.get<CandidateLine[]>(`/bank-reconciliations/${recon!.id}/unreconciled`)).data,
    enabled: open && recon != null,
  });
  // include lines already matched in this session
  const { data: detail } = useQuery({
    queryKey: ['recon-detail', recon?.id],
    queryFn: async () => (await apiClient.get<Recon & { lines: ReconLineDetail[] }>(`/bank-reconciliations/${recon!.id}`)).data,
    enabled: open && recon != null,
  });

  const matchedLines: CandidateLine[] = (detail?.lines ?? []).map((l) => ({
    id: l.journalLine.id,
    entryNo: l.journalLine.entry.entryNo,
    date: l.journalLine.entry.date,
    description: l.journalLine.description ?? l.journalLine.entry.description,
    debit: Number(l.journalLine.debit),
    credit: Number(l.journalLine.credit),
  }));
  const allLines = [...matchedLines, ...candidates.filter((c) => !matchedLines.some((m) => m.id === c.id))];

  // initialize selection from current matches when modal (re)opens
  const [initializedFor, setInitializedFor] = useState<number | null>(null);
  if (open && recon && detail && initializedFor !== recon.id) {
    setSelected(new Set(matchedLines.map((m) => m.id)));
    setInitializedFor(recon.id);
    setPreview(null);
  }

  const saveMutation = useMutation({
    mutationFn: () => apiClient.put(`/bank-reconciliations/${recon!.id}/lines`, { journalLineIds: [...selected] }),
    onSuccess: (res) => {
      const d = res.data as { clearedPreview: number; differencePreview: number };
      setPreview({ cleared: d.clearedPreview, diff: d.differencePreview });
      toast('تم حفظ المطابقة');
      onChanged();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'تعذّر الحفظ')),
  });

  const completeMutation = useMutation({
    mutationFn: () => apiClient.post(`/bank-reconciliations/${recon!.id}/complete`),
    onSuccess: () => { toast('اكتملت التسوية'); handleClose(); onChanged(); },
    onError: (err) => setError(getApiErrorMessage(err, 'تعذّر الإكمال')),
  });

  const handleClose = () => { setSelected(new Set()); setPreview(null); setError(''); setInitializedFor(null); onClose(); };
  const toggle = (id: number) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const selectedNet = allLines.filter((l) => selected.has(l.id)).reduce((s, l) => s + l.debit - l.credit, 0);

  return (
    <Modal open={open} onClose={handleClose} title={`مطابقة التسوية ${recon?.reconNo ?? ''}`} size="xl"
      footer={<>
        <Button variant="outline" onClick={handleClose}>إغلاق</Button>
        <Button variant="outline" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>حفظ المطابقة</Button>
        <Button icon={<CheckCircle size={15} />} loading={completeMutation.isPending} onClick={() => completeMutation.mutate()}>إكمال التسوية</Button>
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm bg-gray-50 rounded-xl p-4">
          <div><span className="text-app-muted">رصيد كشف البنك: </span><span className="font-mono font-bold">{formatMoney(Number(recon?.statementBalance ?? 0))}</span></div>
          <div><span className="text-app-muted">صافي المحدد: </span><span className="font-mono font-bold">{formatMoney(selectedNet)}</span></div>
          {preview && (
            <div>
              <span className="text-app-muted">الفرق بعد الحفظ: </span>
              <span className={`font-mono font-bold ${Math.abs(preview.diff) < 0.01 ? 'text-success' : 'text-danger'}`}>{formatMoney(preview.diff)}</span>
            </div>
          )}
        </div>

        <div className="overflow-x-auto rounded-xl border border-app-border max-h-80 overflow-y-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 border-b border-app-border sticky top-0">
              <th className="px-3 py-2 w-8" />
              <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">القيد</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">التاريخ</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">البيان</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">مدين</th>
              <th className="px-3 py-2 text-right text-xs font-semibold text-app-muted">دائن</th>
            </tr></thead>
            <tbody>
              {allLines.map((l) => (
                <tr key={l.id} className="border-b border-app-border last:border-0 hover:bg-gray-50 cursor-pointer" onClick={() => toggle(l.id)}>
                  <td className="px-3 py-2"><input type="checkbox" checked={selected.has(l.id)} readOnly /></td>
                  <td className="px-3 py-2 font-mono text-xs">{l.entryNo}</td>
                  <td className="px-3 py-2 text-xs">{formatDate(l.date)}</td>
                  <td className="px-3 py-2 text-xs">{l.description}</td>
                  <td className="px-3 py-2 font-mono text-xs">{l.debit ? formatMoney(l.debit) : '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{l.credit ? formatMoney(l.credit) : '—'}</td>
                </tr>
              ))}
              {allLines.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-app-muted text-sm">لا توجد حركات غير مسوّاة حتى تاريخ الكشف</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {error && <div className="bg-danger-bg text-danger text-sm font-medium px-4 py-2.5 rounded-lg">{error}</div>}
      </div>
    </Modal>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function BankReconciliationPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('treasury.create');
  const canDelete = usePermission('treasury.delete');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [createOpen, setCreateOpen] = useState(false);
  const [matchTarget, setMatchTarget] = useState<Recon | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Recon | null>(null);
  // create form
  const [accountId, setAccountId] = useState('');
  const [stmtDate, setStmtDate] = useState('');
  const [stmtBalance, setStmtBalance] = useState('');
  const [createError, setCreateError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['bank-reconciliations', page, pageSize],
    queryFn: async () => (await apiClient.get<PaginatedResponse<Recon>>('/bank-reconciliations', { params: { page, pageSize } })).data,
  });

  const { data: accounts = [] } = useQuery({
    queryKey: ['treasury-accounts'],
    queryFn: async () => (await apiClient.get<{ data: AccountOpt[] }>('/treasury/accounts')).data.data,
    enabled: createOpen,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['bank-reconciliations'] });
    qc.invalidateQueries({ queryKey: ['recon-unreconciled'] });
    qc.invalidateQueries({ queryKey: ['recon-detail'] });
  };

  const createMutation = useMutation({
    mutationFn: () => apiClient.post('/bank-reconciliations', {
      accountId: parseInt(accountId),
      statementDate: stmtDate,
      statementBalance: parseFloat(stmtBalance),
    }),
    onSuccess: (res) => {
      toast('تم إنشاء جلسة التسوية');
      setCreateOpen(false); setAccountId(''); setStmtDate(''); setStmtBalance(''); setCreateError('');
      invalidate();
      setMatchTarget(res.data as Recon);
    },
    onError: (err) => setCreateError(getApiErrorMessage(err, 'تعذّر الإنشاء')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/bank-reconciliations/${id}`),
    onSuccess: () => { toast('تم الحذف'); setDeleteTarget(null); invalidate(); },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر الحذف'), 'error'),
  });

  const columns: Column<Recon>[] = [
    { key: 'reconNo', header: 'رقم الجلسة', render: (r) => <span className="font-mono font-semibold text-primary text-xs">{r.reconNo}</span> },
    { key: 'account', header: 'الحساب', render: (r) => <span className="font-medium">{r.account.code} — {r.account.nameAr}</span> },
    { key: 'statementDate', header: 'تاريخ الكشف', render: (r) => <span className="text-sm">{formatDate(r.statementDate)}</span> },
    { key: 'statementBalance', header: 'رصيد الكشف', render: (r) => <span className="font-mono text-xs">{formatMoney(Number(r.statementBalance))}</span> },
    {
      key: 'status', header: 'الحالة',
      render: (r) => r.status === 'COMPLETED'
        ? (
          <div className="flex items-center gap-1.5">
            <Badge variant="success">مكتملة</Badge>
            <span className={`font-mono text-[10px] ${Math.abs(Number(r.difference)) < 0.01 ? 'text-success' : 'text-danger'}`}>فرق {formatMoney(Number(r.difference))}</span>
          </div>
        )
        : <Badge variant="warning">مسودة</Badge>,
    },
    {
      key: 'actions', header: 'عمليات',
      render: (r) => (
        <div className="flex items-center gap-1">
          {canCreate && r.status === 'DRAFT' && (
            <button title="مطابقة الحركات" className="p-1.5 rounded-lg hover:bg-primary-50 text-app-muted hover:text-primary"
              onClick={() => setMatchTarget(r)}><ListChecks size={14} /></button>
          )}
          {canDelete && r.status === 'DRAFT' && (
            <button title="حذف" className="p-1.5 rounded-lg hover:bg-red-50 text-app-muted hover:text-danger"
              onClick={() => setDeleteTarget(r)}><Trash2 size={14} /></button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="التسوية البنكية" subtitle="مطابقة حركات البنك في الدفاتر مع كشف البنك الفعلي"
        actions={canCreate ? <Button icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>جلسة تسوية جديدة</Button> : undefined} />

      <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5">
        <DataTable columns={columns} data={data?.data ?? []} pagination={data?.pagination as PaginationMeta | undefined}
          loading={isLoading} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          rowKey={(r) => r.id} emptyText="لا توجد جلسات تسوية بعد" />
      </div>

      {/* create modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="جلسة تسوية جديدة" size="md"
        footer={<>
          <Button variant="outline" onClick={() => setCreateOpen(false)}>إلغاء</Button>
          <Button loading={createMutation.isPending} disabled={!accountId || !stmtDate || stmtBalance === ''}
            onClick={() => createMutation.mutate()}>بدء الجلسة</Button>
        </>}>
        <div className="space-y-4">
          <Select label="حساب البنك/الخزينة" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">— اختر —</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.code} — {a.nameAr}</option>)}
          </Select>
          <Input label="تاريخ كشف البنك" type="date" value={stmtDate} onChange={(e) => setStmtDate(e.target.value)} />
          <Input label="الرصيد حسب كشف البنك" type="number" step="0.01" value={stmtBalance} onChange={(e) => setStmtBalance(e.target.value)} />
          {createError && <div className="bg-danger-bg text-danger text-sm font-medium px-4 py-2.5 rounded-lg">{createError}</div>}
        </div>
      </Modal>

      <MatchModal recon={matchTarget} open={!!matchTarget} onClose={() => setMatchTarget(null)} onChanged={invalidate} />

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="تأكيد الحذف" size="sm"
        footer={<>
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
          <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>حذف</Button>
        </>}>
        <p className="text-sm">هل تريد حذف الجلسة <span className="font-bold text-primary">{deleteTarget?.reconNo}</span>؟ ستتحرر الحركات المطابَقة فيها.</p>
      </Modal>
    </div>
  );
}
