import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Pencil, RefreshCw, Building2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { usePermission } from '../../contexts/AuthContext';
import { formatMoney, formatDate, getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Branch {
  id: number;
  nameAr: string;
  code: string | null;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  lastSyncedAt: string | null;
  _count?: { warehouses: number; users: number };
}

interface SyncStatusRow {
  id: number;
  nameAr: string;
  code: string | null;
  warehouseCount: number;
  totalStockQty: number;
  todaySalesCount: number;
  todaySalesTotal: number;
  integrityIssues: number;
  lastSyncedAt: string | null;
}

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

const fetchBranches = async (): Promise<Branch[]> => (await apiClient.get<Branch[]>('/branches')).data;
const fetchSyncStatus = async (): Promise<SyncStatusRow[]> => (await apiClient.get<SyncStatusRow[]>('/branches/sync-status')).data;

// ─── Create / Edit Modal ──────────────────────────────────────────────────────

function BranchFormModal({ open, onClose, editTarget }: { open: boolean; onClose: () => void; editTarget: Branch | null }) {
  const qc = useQueryClient();
  const [nameAr, setNameAr] = useState(editTarget?.nameAr ?? '');
  const [code, setCode] = useState(editTarget?.code ?? '');
  const [address, setAddress] = useState(editTarget?.address ?? '');
  const [phone, setPhone] = useState(editTarget?.phone ?? '');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const body = { nameAr, code: code || null, address: address || null, phone: phone || null };
      return editTarget ? apiClient.put(`/branches/${editTarget.id}`, body) : apiClient.post('/branches', body);
    },
    onSuccess: () => {
      toast(editTarget ? 'تم تحديث الفرع ✓' : 'تم إنشاء الفرع ✓');
      qc.invalidateQueries({ queryKey: ['branches'] });
      qc.invalidateQueries({ queryKey: ['branches-sync-status'] });
      onClose();
    },
    onError: (err) => setError(getApiErrorMessage(err, 'حدث خطأ أثناء الحفظ')),
  });

  const handleSubmit = () => {
    if (!nameAr.trim()) {
      setError('اسم الفرع مطلوب');
      return;
    }
    setError('');
    mutation.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editTarget ? `تعديل فرع ${editTarget.nameAr}` : 'فرع جديد'}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button loading={mutation.isPending} onClick={handleSubmit}>حفظ</Button>
        </>
      }
    >
      <div dir="rtl" className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="اسم الفرع" value={nameAr} onChange={(e) => setNameAr(e.target.value)} />
          <Input label="رمز الفرع (اختياري)" value={code} onChange={(e) => setCode(e.target.value)} placeholder="مثال: RUH-01" />
        </div>
        <Input label="العنوان (اختياري)" value={address} onChange={(e) => setAddress(e.target.value)} />
        <Input label="الهاتف (اختياري)" value={phone} onChange={(e) => setPhone(e.target.value)} />
        {error && <div className="bg-danger-bg text-danger text-sm font-medium px-4 py-2.5 rounded-lg">{error}</div>}
      </div>
    </Modal>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export function BranchesPage() {
  const qc = useQueryClient();
  const canEdit = usePermission('warehouses.edit');
  const canCreate = usePermission('warehouses.create');
  const canDelete = usePermission('warehouses.delete');
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Branch | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Branch | null>(null);

  const { data: branches = [], isLoading } = useQuery({ queryKey: ['branches'], queryFn: fetchBranches });
  const { data: syncStatus = [], isLoading: syncLoading } = useQuery({
    queryKey: ['branches-sync-status'],
    queryFn: fetchSyncStatus,
    refetchInterval: 60000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/branches/${id}`),
    onSuccess: () => {
      toast('تم تعطيل الفرع ✓');
      qc.invalidateQueries({ queryKey: ['branches'] });
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر الحذف'), 'error'),
  });

  const syncMutation = useMutation({
    mutationFn: (id: number) => apiClient.post<{ issuesFound: number; issues: string[] }>(`/branches/${id}/sync`),
    onSuccess: (res) => {
      const { issuesFound, issues } = res.data;
      if (issuesFound === 0) {
        toast('تمت المزامنة — البيانات متطابقة ولا توجد مشاكل ✓');
      } else {
        toast(`تمت المزامنة — تم رصد ${issuesFound} مشكلة: ${issues[0]}`, 'error');
      }
      qc.invalidateQueries({ queryKey: ['branches'] });
      qc.invalidateQueries({ queryKey: ['branches-sync-status'] });
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّرت المزامنة'), 'error'),
  });

  return (
    <div>
      <PageHeader
        title="الفروع ومزامنة البيانات"
        subtitle="جميع الفروع تتشارك قاعدة بيانات مركزية واحدة، فالبيانات محدَّثة لحظيًا بين الفروع تلقائيًا"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={() => { setEditTarget(null); setFormOpen(true); }}>فرع جديد</Button>
          ) : undefined
        }
      />

      {/* Sync status cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {syncLoading ? (
          <div className="col-span-full flex items-center justify-center py-10">
            <span className="inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : syncStatus.length === 0 ? (
          <div className="col-span-full flex items-center gap-3 py-6 px-4 bg-gray-50 rounded-xl text-app-muted">
            <Building2 size={22} />
            <p className="text-sm">لا توجد فروع نشطة بعد</p>
          </div>
        ) : (
          syncStatus.map((s) => (
            <div key={s.id} className="bg-white rounded-2xl border border-app-border shadow-sm p-5">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="font-bold text-app-text">{s.nameAr}</p>
                  {s.code && <p className="text-xs text-app-muted font-mono">{s.code}</p>}
                </div>
                {s.integrityIssues === 0 ? (
                  <Badge variant="success"><CheckCircle2 size={11} className="inline ml-1" />متطابقة</Badge>
                ) : (
                  <Badge variant="danger"><AlertTriangle size={11} className="inline ml-1" />{s.integrityIssues} مشكلة</Badge>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className="text-app-muted">المستودعات</p>
                  <p className="font-bold text-app-text">{s.warehouseCount}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-2">
                  <p className="text-app-muted">مبيعات اليوم</p>
                  <p className="font-bold text-app-text">{s.todaySalesCount} ({formatMoney(s.todaySalesTotal)})</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-[11px] text-app-muted">
                  آخر تحقق: {s.lastSyncedAt ? formatDate(s.lastSyncedAt) : 'لم يتم من قبل'}
                </p>
                {canEdit && (
                  <button
                    onClick={() => syncMutation.mutate(s.id)}
                    disabled={syncMutation.isPending}
                    className="flex items-center gap-1 text-xs font-medium text-primary hover:underline disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={syncMutation.isPending ? 'animate-spin' : ''} />
                    مزامنة الآن
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Branches table */}
      <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5 overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <span className="inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-app-border text-app-muted text-xs">
                <th className="text-right px-3 py-2 font-semibold">الفرع</th>
                <th className="text-right px-3 py-2 font-semibold">الرمز</th>
                <th className="text-right px-3 py-2 font-semibold">العنوان</th>
                <th className="text-right px-3 py-2 font-semibold">الهاتف</th>
                <th className="text-right px-3 py-2 font-semibold">المستودعات</th>
                <th className="text-right px-3 py-2 font-semibold">المستخدمون</th>
                <th className="text-right px-3 py-2 font-semibold">الحالة</th>
                <th className="text-right px-3 py-2 font-semibold">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {branches.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-app-muted">لا توجد فروع بعد</td></tr>
              ) : (
                branches.map((b) => (
                  <tr key={b.id} className="border-b border-app-border/60">
                    <td className="px-3 py-2 font-medium">{b.nameAr}</td>
                    <td className="px-3 py-2 font-mono text-app-muted">{b.code ?? '—'}</td>
                    <td className="px-3 py-2 text-app-muted">{b.address ?? '—'}</td>
                    <td className="px-3 py-2 font-mono text-app-muted">{b.phone ?? '—'}</td>
                    <td className="px-3 py-2">{b._count?.warehouses ?? 0}</td>
                    <td className="px-3 py-2">{b._count?.users ?? 0}</td>
                    <td className="px-3 py-2">
                      <Badge variant={b.isActive ? 'success' : 'default'}>{b.isActive ? 'نشط' : 'معطّل'}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        {canEdit && (
                          <button
                            onClick={() => { setEditTarget(b); setFormOpen(true); }}
                            className="p-1.5 text-app-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                          >
                            <Pencil size={14} />
                          </button>
                        )}
                        {canDelete && b.isActive && (
                          <button
                            onClick={() => setDeleteTarget(b)}
                            className="p-1.5 text-app-muted hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      <BranchFormModal key={editTarget?.id ?? 'new'} open={formOpen} onClose={() => setFormOpen(false)} editTarget={editTarget} />

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="تأكيد التعطيل"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>إلغاء</Button>
            <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}>
              تعطيل
            </Button>
          </>
        }
      >
        <p className="text-sm text-app-text">
          سيتم تعطيل فرع <span className="font-bold">{deleteTarget?.nameAr}</span>. تبقى بياناته التاريخية دون حذف.
        </p>
      </Modal>
    </div>
  );
}
