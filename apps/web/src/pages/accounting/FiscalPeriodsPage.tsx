/**
 * الفترات المحاسبية — قفل/فتح شهور السنة المالية
 *
 * الشهر المقفل يرفض أي إنشاء أو حذف لمستند بتاريخ يقع فيه (فواتير، سندات،
 * مرتجعات، رواتب، قيود يدوية) — التطبيق في الخادم عند نقطة ترحيل القيود.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock, LockOpen, ChevronRight, ChevronLeft } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { usePermission } from '../../contexts/AuthContext';
import { formatDate, getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';

interface PeriodRow {
  year: number;
  month: number;
  status: 'OPEN' | 'LOCKED';
  lockedAt: string | null;
  lockedBy: { id: number; name: string } | null;
  entryCount: number;
}

const MONTH_NAMES = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

export function FiscalPeriodsPage() {
  const qc = useQueryClient();
  const canEdit = usePermission('accounts.edit');
  const [year, setYear] = useState(new Date().getFullYear());
  const [confirmTarget, setConfirmTarget] = useState<PeriodRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['fiscal-periods', year],
    queryFn: async () => (await apiClient.get<{ year: number; months: PeriodRow[] }>('/fiscal-periods', { params: { year } })).data,
  });

  const toggleMutation = useMutation({
    mutationFn: (p: PeriodRow) =>
      apiClient.post(`/fiscal-periods/${p.status === 'LOCKED' ? 'unlock' : 'lock'}`, { year: p.year, month: p.month }),
    onSuccess: (_res, p) => {
      qc.invalidateQueries({ queryKey: ['fiscal-periods'] });
      toast(p.status === 'LOCKED' ? `تم فتح فترة ${MONTH_NAMES[p.month - 1]} ${p.year}` : `تم قفل فترة ${MONTH_NAMES[p.month - 1]} ${p.year}`);
      setConfirmTarget(null);
    },
    onError: (err) => {
      toast(getApiErrorMessage(err, 'حدث خطأ'), 'error');
      setConfirmTarget(null);
    },
  });

  const now = new Date();
  const isCurrentMonth = (p: PeriodRow) => p.year === now.getFullYear() && p.month === now.getMonth() + 1;

  return (
    <div>
      <PageHeader
        title="الفترات المحاسبية"
        subtitle="قفل الشهور المنتهية يمنع إنشاء أو حذف أي مستند بتاريخ يقع فيها"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" icon={<ChevronRight size={15} />} onClick={() => setYear((y) => y - 1)}>
              {year - 1}
            </Button>
            <span className="font-bold text-lg text-app-text px-2">{year}</span>
            <Button variant="outline" icon={<ChevronLeft size={15} />} onClick={() => setYear((y) => y + 1)}>
              {year + 1}
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <span className="inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {(data?.months ?? []).map((p) => {
            const locked = p.status === 'LOCKED';
            return (
              <div
                key={p.month}
                className={`bg-white rounded-2xl border shadow-sm p-5 flex flex-col gap-3 transition-colors ${locked ? 'border-red-200 bg-red-50/40' : 'border-app-border'} ${isCurrentMonth(p) ? 'ring-2 ring-primary/30' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-app-text">{MONTH_NAMES[p.month - 1]}</p>
                    <p className="text-xs text-app-muted">{p.month}/{p.year}</p>
                  </div>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${locked ? 'bg-red-100 text-danger' : 'bg-primary-50 text-primary'}`}>
                    {locked ? <Lock size={18} /> : <LockOpen size={18} />}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <Badge variant={locked ? 'danger' : 'success'}>{locked ? 'مقفلة' : 'مفتوحة'}</Badge>
                  <span className="text-app-muted">{p.entryCount.toLocaleString('ar-EG')} قيد</span>
                </div>

                {locked && p.lockedAt && (
                  <p className="text-[11px] text-app-muted">
                    قُفلت في {formatDate(p.lockedAt)}{p.lockedBy ? ` بواسطة ${p.lockedBy.name}` : ''}
                  </p>
                )}

                {canEdit && (
                  <Button
                    variant={locked ? 'outline' : 'danger'}
                    className="w-full justify-center"
                    icon={locked ? <LockOpen size={14} /> : <Lock size={14} />}
                    onClick={() => setConfirmTarget(p)}
                  >
                    {locked ? 'فتح الفترة' : 'قفل الفترة'}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        title={confirmTarget?.status === 'LOCKED' ? 'تأكيد فتح الفترة' : 'تأكيد قفل الفترة'}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmTarget(null)}>إلغاء</Button>
            <Button
              variant={confirmTarget?.status === 'LOCKED' ? 'primary' : 'danger'}
              loading={toggleMutation.isPending}
              onClick={() => confirmTarget && toggleMutation.mutate(confirmTarget)}
            >
              {confirmTarget?.status === 'LOCKED' ? 'فتح' : 'قفل'}
            </Button>
          </>
        }
      >
        {confirmTarget && (
          <p className="text-sm text-app-text">
            {confirmTarget.status === 'LOCKED' ? (
              <>سيصبح بالإمكان مجدداً إنشاء وحذف مستندات بتاريخ يقع في <span className="font-bold">{MONTH_NAMES[confirmTarget.month - 1]} {confirmTarget.year}</span>.</>
            ) : (
              <>بعد القفل سيُرفض إنشاء أو حذف أي مستند (فاتورة، سند، مرتجع، قيد…) بتاريخ يقع في <span className="font-bold">{MONTH_NAMES[confirmTarget.month - 1]} {confirmTarget.year}</span>.</>
            )}
          </p>
        )}
      </Modal>
    </div>
  );
}
