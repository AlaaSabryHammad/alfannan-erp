import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, Trash2, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Modal } from '../../components/ui/Modal';
import { Badge } from '../../components/ui/Badge';
import { useAuth, usePermission } from '../../contexts/AuthContext';
import { formatMoney, formatDate, getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginatedResponse } from '../../types';

// --- Types ---
type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

interface ApprovalLine {
  id: number;
  accountId: number;
  debit: number;
  credit: number;
  description: string | null;
  account: { code: string; nameAr: string };
}

interface Approval {
  id: number;
  description: string;
  date: string;
  status: ApprovalStatus;
  createdById: number;
  reviewedById: number | null;
  reviewedAt: string | null;
  rejectReason: string | null;
  createdAt: string;
  lines: ApprovalLine[];
}

const STATUS_META: Record<ApprovalStatus, { label: string; variant: 'success' | 'warning' | 'danger' }> = {
  PENDING: { label: 'قيد المراجعة', variant: 'warning' },
  APPROVED: { label: 'مُعتمد', variant: 'success' },
  REJECTED: { label: 'مرفوض', variant: 'danger' },
};

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3500);
}

// --- Reject Reason Modal ---
function RejectModal({ target, onClose }: { target: Approval | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');

  const rejectMutation = useMutation({
    mutationFn: () => apiClient.post(`/journal-approvals/${target!.id}/reject`, { reason: reason || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal-approvals'] });
      toast('تم رفض الطلب');
      setReason('');
      onClose();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الرفض'), 'error'),
  });

  return (
    <Modal
      open={!!target}
      onClose={() => { setReason(''); onClose(); }}
      title="رفض طلب القيد"
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={() => { setReason(''); onClose(); }}>إلغاء</Button>
          <Button variant="danger" loading={rejectMutation.isPending} onClick={() => rejectMutation.mutate()}>
            تأكيد الرفض
          </Button>
        </>
      }
    >
      <div dir="rtl" className="space-y-3">
        <p className="text-sm text-app-text">
          سيتم رفض القيد <span className="font-bold">{target?.description}</span> نهائياً دون ترحيله.
        </p>
        <textarea
          className="w-full text-sm border border-app-border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary/30"
          placeholder="سبب الرفض (اختياري)..."
          rows={3}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Modal>
  );
}

// --- Component ---
export function JournalApprovalsPage() {
  const { user } = useAuth();
  const canReview = usePermission('accounts.edit');
  const qc = useQueryClient();
  const [status, setStatus] = useState<ApprovalStatus>('PENDING');
  const [rejectTarget, setRejectTarget] = useState<Approval | null>(null);

  const { data, isLoading } = useQuery<PaginatedResponse<Approval>>({
    queryKey: ['journal-approvals', status],
    queryFn: async () => (await apiClient.get<PaginatedResponse<Approval>>('/journal-approvals', { params: { status, page: 1, pageSize: 100 } })).data,
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => apiClient.post(`/journal-approvals/${id}/approve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal-approvals'] });
      qc.invalidateQueries({ queryKey: ['journal'] });
      toast('تم اعتماد القيد وترحيله بنجاح');
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الاعتماد'), 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/journal-approvals/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['journal-approvals'] });
      toast('تم حذف الطلب');
    },
    onError: (err) => toast(getApiErrorMessage(err, 'حدث خطأ أثناء الحذف'), 'error'),
  });

  const rows = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="اعتماد القيود اليومية"
        subtitle="القيود اليدوية تحتاج موافقة مستخدم آخر غير من أنشأها قبل ترحيلها فعلياً"
      />

      <div className="mb-4 flex gap-2" dir="rtl">
        {(['PENDING', 'APPROVED', 'REJECTED'] as ApprovalStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              status === s ? 'bg-primary text-white' : 'bg-white border border-app-border text-app-muted hover:text-app-text'
            }`}
          >
            {STATUS_META[s].label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5">
        {isLoading ? (
          <div className="py-16 text-center text-app-muted text-sm">جارٍ التحميل...</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center">
            <ShieldCheck size={40} className="text-app-muted mx-auto mb-3" />
            <p className="text-app-muted text-sm">لا توجد طلبات في هذه الحالة</p>
          </div>
        ) : (
          <div dir="rtl" className="space-y-3">
            {rows.map((row) => {
              const totalDebit = row.lines.reduce((s, l) => s + Number(l.debit), 0);
              const isOwnRequest = row.createdById === user?.id;
              return (
                <div key={row.id} className="border border-app-border rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-app-border">
                    <div>
                      <p className="font-bold text-sm">{row.description}</p>
                      <p className="text-xs text-app-muted mt-0.5">
                        {formatDate(row.date)} · {formatMoney(totalDebit)}
                        {row.rejectReason && <span className="text-danger"> · سبب الرفض: {row.rejectReason}</span>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_META[row.status].variant}>{STATUS_META[row.status].label}</Badge>
                      {row.status === 'PENDING' && canReview && !isOwnRequest && (
                        <>
                          <button
                            onClick={() => approveMutation.mutate(row.id)}
                            disabled={approveMutation.isPending}
                            className="p-1.5 rounded-lg hover:bg-success-bg text-app-muted hover:text-success transition-colors disabled:opacity-50"
                            title="اعتماد"
                          >
                            <Check size={16} />
                          </button>
                          <button
                            onClick={() => setRejectTarget(row)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-app-muted hover:text-danger transition-colors"
                            title="رفض"
                          >
                            <X size={16} />
                          </button>
                        </>
                      )}
                      {row.status === 'PENDING' && isOwnRequest && (
                        <>
                          <span className="text-xs text-app-muted">بانتظار مستخدم آخر</span>
                          <button
                            onClick={() => deleteMutation.mutate(row.id)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-app-muted hover:text-danger transition-colors"
                            title="إلغاء الطلب"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  <table className="w-full text-xs">
                    <tbody>
                      {row.lines.map((line) => (
                        <tr key={line.id} className="border-b border-app-border/60 last:border-0">
                          <td className="px-4 py-2">
                            <span className="font-mono text-app-muted ml-2">{line.account.code}</span>
                            <span>{line.account.nameAr}</span>
                          </td>
                          <td className="px-4 py-2 font-mono font-bold text-primary w-32">
                            {Number(line.debit) > 0 ? formatMoney(Number(line.debit)) : '—'}
                          </td>
                          <td className="px-4 py-2 font-mono font-bold text-success w-32">
                            {Number(line.credit) > 0 ? formatMoney(Number(line.credit)) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <RejectModal target={rejectTarget} onClose={() => setRejectTarget(null)} />
    </div>
  );
}
