import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import apiClient from '../../lib/api';
import { usePermission } from '../../contexts/AuthContext';
import { formatMoney, formatDate, getApiErrorMessage } from '../../lib/utils';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import type { PaginatedResponse, PaginationMeta } from '../../types';

// ── Types ─────────────────────────────────────────────────────────────────────
type NoteTypeT = 'RECEIVABLE' | 'PAYABLE';
type NoteStatusT = 'PENDING' | 'SETTLED' | 'CANCELLED' | 'BOUNCED';
type PartyTypeT = 'CUSTOMER' | 'SUPPLIER' | 'ACCOUNT';
type InstrumentTypeT = 'PROMISSORY_NOTE' | 'CHEQUE';

interface NoteRow {
  id: number;
  noteNo: string;
  type: NoteTypeT;
  instrumentType: InstrumentTypeT;
  bankName: string | null;
  partyType: PartyTypeT;
  partyId: number | null;
  partyName: string | null;
  amount: number;
  issueDate: string;
  dueDate: string;
  status: NoteStatusT;
  description: string | null;
}

interface PartyOption {
  id: number;
  nameAr: string;
}

interface TreasuryAccount {
  id: number;
  code: string;
  nameAr: string;
}

const TYPE_LABEL: Record<NoteTypeT, string> = {
  RECEIVABLE: 'مستحقة القبض',
  PAYABLE: 'واجبة الدفع',
};
const TYPE_BADGE: Record<NoteTypeT, 'success' | 'warning'> = {
  RECEIVABLE: 'success',
  PAYABLE: 'warning',
};
const STATUS_LABEL: Record<NoteStatusT, string> = {
  PENDING: 'قيد الانتظار',
  SETTLED: 'تمت التسوية',
  CANCELLED: 'ملغاة',
  BOUNCED: 'مرتجعة',
};
const STATUS_BADGE: Record<NoteStatusT, 'warning' | 'success' | 'default' | 'danger'> = {
  PENDING: 'warning',
  SETTLED: 'success',
  CANCELLED: 'default',
  BOUNCED: 'danger',
};
const INSTRUMENT_LABEL: Record<InstrumentTypeT, string> = {
  PROMISSORY_NOTE: 'كمبيالة',
  CHEQUE: 'شيك بنكي',
};

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2500);
}

function isOverdue(dueDate: string, status: NoteStatusT): boolean {
  if (status !== 'PENDING') return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

export function PromissoryNotesPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('treasury.create');
  const canDelete = usePermission('treasury.delete');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | NoteStatusT>('ALL');
  const [instrumentFilter, setInstrumentFilter] = useState<'ALL' | InstrumentTypeT>('ALL');
  const [createOpen, setCreateOpen] = useState(false);
  const [settleTarget, setSettleTarget] = useState<NoteRow | null>(null);
  const [bounceTarget, setBounceTarget] = useState<NoteRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NoteRow | null>(null);

  const { data, isLoading } = useQuery<PaginatedResponse<NoteRow>>({
    queryKey: ['promissory-notes', page, pageSize, search, statusFilter, instrumentFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, pageSize, search };
      if (statusFilter !== 'ALL') params.status = statusFilter;
      if (instrumentFilter !== 'ALL') params.instrumentType = instrumentFilter;
      const res = await apiClient.get<PaginatedResponse<NoteRow>>('/promissory-notes', { params });
      return res.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/promissory-notes/${id}`),
    onSuccess: () => {
      toast('تم حذف الكمبيالة ✓');
      qc.invalidateQueries({ queryKey: ['promissory-notes'] });
      qc.invalidateQueries({ queryKey: ['vouchers'] });
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر حذف الكمبيالة'), 'error'),
  });

  const columns: Array<Column<NoteRow>> = [
    {
      key: 'noteNo',
      header: 'رقم المستند',
      render: (r) => <span className="font-mono font-medium">{r.noteNo}</span>,
    },
    {
      key: 'instrumentType',
      header: 'الأداة',
      render: (r) => (
        <div>
          <Badge variant="info">{INSTRUMENT_LABEL[r.instrumentType]}</Badge>
          {r.instrumentType === 'CHEQUE' && r.bankName && (
            <div className="text-xs text-app-muted mt-0.5">{r.bankName}</div>
          )}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'النوع',
      render: (r) => <Badge variant={TYPE_BADGE[r.type]}>{TYPE_LABEL[r.type]}</Badge>,
    },
    {
      key: 'party',
      header: 'الطرف',
      render: (r) => <span>{r.partyName ?? '—'}</span>,
    },
    {
      key: 'amount',
      header: 'المبلغ',
      render: (r) => <span className="font-bold">{formatMoney(r.amount)}</span>,
    },
    {
      key: 'issueDate',
      header: 'تاريخ الإصدار',
      render: (r) => <span className="text-app-muted">{formatDate(r.issueDate)}</span>,
    },
    {
      key: 'dueDate',
      header: 'تاريخ الاستحقاق',
      render: (r) => (
        <span className={isOverdue(r.dueDate, r.status) ? 'text-danger font-semibold flex items-center gap-1' : 'text-app-muted'}>
          {isOverdue(r.dueDate, r.status) && <AlertCircle size={13} />}
          {formatDate(r.dueDate)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'الحالة',
      render: (r) => <Badge variant={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge>,
    },
    {
      key: 'actions',
      header: 'إجراءات',
      render: (r) => (
        <div className="flex items-center gap-1">
          {canCreate && r.status === 'PENDING' && (
            <button
              onClick={() => setSettleTarget(r)}
              title={r.type === 'RECEIVABLE' ? 'تحصيل' : 'سداد'}
              className="p-1.5 text-app-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
            >
              <CheckCircle2 size={16} />
            </button>
          )}
          {canCreate && r.status === 'PENDING' && (
            <button
              onClick={() => setBounceTarget(r)}
              title={r.instrumentType === 'CHEQUE' ? 'ارتجاع الشيك' : 'ارتجاع'}
              className="p-1.5 text-app-muted hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
            >
              <XCircle size={16} />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => setDeleteTarget(r)}
              title="حذف"
              className="p-1.5 text-app-muted hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="الكمبيالات والشيكات البنكية"
        subtitle="الأدوات المستحقة القبض والواجبة الدفع — التسوية تنشئ سنداً في الخزينة"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
              مستند جديد
            </Button>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Instrument type filter */}
        <div className="flex items-center gap-1 bg-white rounded-xl border border-app-border p-1 w-fit">
          {(['ALL', 'PROMISSORY_NOTE', 'CHEQUE'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setInstrumentFilter(t);
                setPage(1);
              }}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                instrumentFilter === t ? 'bg-primary text-white' : 'text-app-muted hover:bg-gray-50'
              }`}
            >
              {t === 'ALL' ? 'الكل' : INSTRUMENT_LABEL[t]}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="flex items-center gap-1 bg-white rounded-xl border border-app-border p-1 w-fit">
          {(['ALL', 'PENDING', 'SETTLED', 'CANCELLED', 'BOUNCED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatusFilter(s);
                setPage(1);
              }}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                statusFilter === s ? 'bg-primary text-white' : 'text-app-muted hover:bg-gray-50'
              }`}
            >
              {s === 'ALL' ? 'الكل' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5">
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          pagination={data?.pagination as PaginationMeta | undefined}
          loading={isLoading}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s);
            setPage(1);
          }}
          onSearch={(q) => {
            setSearch(q);
            setPage(1);
          }}
          searchValue={search}
          rowKey={(r) => r.id}
          emptyText="لا توجد كمبيالات أو شيكات بعد"
          exportTitle="تقرير الكمبيالات والشيكات"
        />
      </div>

      {createOpen && (
        <CreateNoteModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ['promissory-notes'] });
          }}
        />
      )}

      {settleTarget && (
        <SettleNoteModal
          note={settleTarget}
          onClose={() => setSettleTarget(null)}
          onSettled={() => {
            setSettleTarget(null);
            qc.invalidateQueries({ queryKey: ['promissory-notes'] });
            qc.invalidateQueries({ queryKey: ['vouchers'] });
          }}
        />
      )}

      {bounceTarget && (
        <BounceNoteModal
          note={bounceTarget}
          onClose={() => setBounceTarget(null)}
          onBounced={() => {
            setBounceTarget(null);
            qc.invalidateQueries({ queryKey: ['promissory-notes'] });
          }}
        />
      )}

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="تأكيد الحذف"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              إلغاء
            </Button>
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
          سيتم حذف المستند <span className="font-mono font-bold">{deleteTarget?.noteNo}</span>.
          {deleteTarget?.status === 'SETTLED' && ' سيتم أيضاً عكس سند التسوية المرتبط بها.'}
        </p>
      </Modal>
    </div>
  );
}

// ── Create note modal ─────────────────────────────────────────────────────────
function CreateNoteModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [instrumentType, setInstrumentType] = useState<InstrumentTypeT>('PROMISSORY_NOTE');
  const [bankName, setBankName] = useState('');
  const [type, setType] = useState<NoteTypeT>('RECEIVABLE');
  const [partyType, setPartyType] = useState<PartyTypeT>('CUSTOMER');
  const [partyId, setPartyId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');

  const [customers, setCustomers] = useState<PartyOption[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
  const [accounts, setAccounts] = useState<PartyOption[]>([]);
  if (open && customers.length === 0) {
    apiClient.get<{ data: PartyOption[] }>('/customers', { params: { page: 1, pageSize: 500 } }).then((r) => setCustomers(r.data.data)).catch(() => {});
  }
  if (open && suppliers.length === 0) {
    apiClient.get<{ data: PartyOption[] }>('/suppliers', { params: { page: 1, pageSize: 500 } }).then((r) => setSuppliers(r.data.data)).catch(() => {});
  }
  if (open && accounts.length === 0) {
    apiClient.get<{ data: PartyOption[] }>('/accounts', { params: { page: 1, pageSize: 500 } }).then((r) => setAccounts(r.data.data)).catch(() => {});
  }

  const mutation = useMutation({
    mutationFn: (payload: unknown) => apiClient.post('/promissory-notes', payload),
    onSuccess: () => {
      toast('تم إنشاء الكمبيالة ✓');
      onCreated();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر إنشاء الكمبيالة'), 'error'),
  });

  const partyOptions = partyType === 'CUSTOMER' ? customers : partyType === 'SUPPLIER' ? suppliers : accounts;

  function handleSubmit() {
    if (!amount || Number(amount) <= 0) {
      toast('يرجى إدخال مبلغ صحيح', 'error');
      return;
    }
    if (!dueDate) {
      toast('يرجى إدخال تاريخ الاستحقاق', 'error');
      return;
    }
    if (instrumentType === 'CHEQUE' && !bankName.trim()) {
      toast('يرجى إدخال اسم البنك', 'error');
      return;
    }
    mutation.mutate({
      instrumentType,
      bankName: instrumentType === 'CHEQUE' ? bankName : undefined,
      type,
      partyType,
      partyId: partyId || undefined,
      amount: Number(amount),
      issueDate,
      dueDate,
      description: description || undefined,
    });
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={instrumentType === 'CHEQUE' ? 'شيك بنكي جديد' : 'كمبيالة جديدة'}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={handleSubmit} loading={mutation.isPending}>
            حفظ
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label="الأداة" value={instrumentType} onChange={(e) => setInstrumentType(e.target.value as InstrumentTypeT)}>
            <option value="PROMISSORY_NOTE">كمبيالة</option>
            <option value="CHEQUE">شيك بنكي</option>
          </Select>
          <Select label="النوع" value={type} onChange={(e) => setType(e.target.value as NoteTypeT)}>
            <option value="RECEIVABLE">مستحقة القبض (لنا)</option>
            <option value="PAYABLE">واجبة الدفع (علينا)</option>
          </Select>
        </div>

        {instrumentType === 'CHEQUE' && (
          <Input label="اسم البنك" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="مثال: البنك الأهلي السعودي" />
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select label="نوع الطرف" value={partyType} onChange={(e) => { setPartyType(e.target.value as PartyTypeT); setPartyId(''); }}>
            <option value="CUSTOMER">عميل</option>
            <option value="SUPPLIER">مورد</option>
            <option value="ACCOUNT">حساب</option>
          </Select>
          <Select label="الطرف" value={partyId} onChange={(e) => setPartyId(Number(e.target.value))}>
            <option value="">— اختر —</option>
            {partyOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nameAr}
              </option>
            ))}
          </Select>
        </div>

        <Input label="المبلغ" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="تاريخ الإصدار" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          <Input label="تاريخ الاستحقاق" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>

        <Input label="البيان (اختياري)" value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
    </Modal>
  );
}

// ── Settle note modal ─────────────────────────────────────────────────────────
function SettleNoteModal({
  note,
  onClose,
  onSettled,
}: {
  note: NoteRow;
  onClose: () => void;
  onSettled: () => void;
}) {
  const [treasuryAccountId, setTreasuryAccountId] = useState<number | ''>('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const [treasuryAccounts, setTreasuryAccounts] = useState<TreasuryAccount[]>([]);
  if (treasuryAccounts.length === 0) {
    apiClient
      .get<{ data: TreasuryAccount[] }>('/treasury/accounts')
      .then((r) => {
        if (r.data.data.length > 0) {
          setTreasuryAccounts(r.data.data);
          setTreasuryAccountId(r.data.data[0].id);
        }
      })
      .catch(() => {});
  }

  const mutation = useMutation({
    mutationFn: () =>
      apiClient.post(`/promissory-notes/${note.id}/settle`, { treasuryAccountId: Number(treasuryAccountId), date }),
    onSuccess: () => {
      toast('تمت تسوية الكمبيالة وإنشاء السند ✓');
      onSettled();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّرت التسوية'), 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`${note.type === 'RECEIVABLE' ? 'تحصيل' : 'سداد'} كمبيالة ${note.noteNo}`}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={() => mutation.mutate()} loading={mutation.isPending} disabled={!treasuryAccountId}>
            {note.type === 'RECEIVABLE' ? 'تحصيل' : 'سداد'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-app-muted">المبلغ:</span>
            <span className="font-bold">{formatMoney(note.amount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-app-muted">الطرف:</span>
            <span>{note.partyName ?? '—'}</span>
          </div>
        </div>
        <Select label="حساب الخزينة" value={treasuryAccountId} onChange={(e) => setTreasuryAccountId(Number(e.target.value))}>
          {treasuryAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.nameAr}
            </option>
          ))}
        </Select>
        <Input label="تاريخ التسوية" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
    </Modal>
  );
}

// ── Bounce note/cheque modal ───────────────────────────────────────────────────
function BounceNoteModal({
  note,
  onClose,
  onBounced,
}: {
  note: NoteRow;
  onClose: () => void;
  onBounced: () => void;
}) {
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => apiClient.post(`/promissory-notes/${note.id}/bounce`, { reason: reason || undefined }),
    onSuccess: () => {
      toast(note.instrumentType === 'CHEQUE' ? 'تم تسجيل ارتجاع الشيك ✓' : 'تم تسجيل الارتجاع ✓');
      onBounced();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر تسجيل الارتجاع'), 'error'),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`ارتجاع ${note.instrumentType === 'CHEQUE' ? 'شيك' : 'كمبيالة'} ${note.noteNo}`}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button variant="danger" onClick={() => mutation.mutate()} loading={mutation.isPending}>
            تأكيد الارتجاع
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="bg-gray-50 rounded-lg p-3 text-sm space-y-1">
          <div className="flex justify-between">
            <span className="text-app-muted">المبلغ:</span>
            <span className="font-bold">{formatMoney(note.amount)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-app-muted">الطرف:</span>
            <span>{note.partyName ?? '—'}</span>
          </div>
          {note.bankName && (
            <div className="flex justify-between">
              <span className="text-app-muted">البنك:</span>
              <span>{note.bankName}</span>
            </div>
          )}
        </div>
        <p className="text-xs text-app-muted">
          سيتم تحويل حالة المستند إلى "مرتجعة". بما أن هذا المستند لم يتم تحصيله أو سداده فعلياً، فلن يتم إنشاء أي سند أو قيد محاسبي.
        </p>
        <Input label="سبب الارتجاع (اختياري)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: عدم كفاية الرصيد" />
      </div>
    </Modal>
  );
}
