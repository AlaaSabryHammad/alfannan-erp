import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Eye, Trash2, Printer, Wallet } from 'lucide-react';
import apiClient from '../../lib/api';
import { usePermission } from '../../contexts/AuthContext';
import { useDateRange } from '../../contexts/DateRangeContext';
import { useBranch } from '../../contexts/BranchContext';
import { formatMoney, formatDate, getApiErrorMessage } from '../../lib/utils';
import { printInvoice } from '../../lib/print';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import type { PaginatedResponse, PaginationMeta } from '../../types';
import { CreateVoucherModal } from './CreateVoucherModal';

// ── Types ─────────────────────────────────────────────────────────────────────
type VoucherTypeT = 'RECEIPT' | 'PAYMENT' | 'DISCOUNT' | 'DEPOSIT';

interface TreasuryAccount {
  id: number;
  code: string;
  nameAr: string;
}

interface VoucherRow {
  id: number;
  voucherNo: string;
  type: VoucherTypeT;
  date: string;
  treasuryAccountId: number;
  treasuryAccount?: TreasuryAccount;
  partyType: 'CUSTOMER' | 'SUPPLIER' | 'ACCOUNT' | null;
  partyId: number | null;
  partyName: string | null;
  description: string | null;
  totalAmount: number;
}

interface VoucherLineAccount {
  id: number;
  code: string;
  nameAr: string;
}

interface VoucherDetail extends VoucherRow {
  lines: Array<{ id: number; amount: number; description: string | null; account: VoucherLineAccount }>;
  journalEntry: {
    id: number;
    entryNo: string;
    date: string;
    description: string;
    lines: Array<{ id: number; debit: number; credit: number; description: string | null; account: VoucherLineAccount }>;
  } | null;
}

// ── Labels ────────────────────────────────────────────────────────────────────
const TYPE_LABEL: Record<VoucherTypeT, string> = {
  RECEIPT: 'سند قبض',
  PAYMENT: 'سند صرف',
  DISCOUNT: 'سند خصم',
  DEPOSIT: 'إيداع بنكي',
};

const TYPE_BADGE: Record<VoucherTypeT, 'success' | 'warning' | 'info' | 'default'> = {
  RECEIPT: 'success',
  PAYMENT: 'warning',
  DISCOUNT: 'info',
  DEPOSIT: 'default',
};

const TABS: Array<{ key: 'ALL' | VoucherTypeT; label: string }> = [
  { key: 'ALL', label: 'الكل' },
  { key: 'RECEIPT', label: 'قبض' },
  { key: 'PAYMENT', label: 'صرف' },
  { key: 'DISCOUNT', label: 'خصم' },
  { key: 'DEPOSIT', label: 'إيداع' },
];

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="bg-white rounded-2xl border border-app-border shadow-sm p-4">
      <p className="text-xs text-app-muted mb-1">{label}</p>
      <p className={`text-lg font-bold ${tone}`}>{value}</p>
    </div>
  );
}

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2500);
}

export function VouchersPage() {
  const qc = useQueryClient();
  const canCreate = usePermission('treasury.create');
  const canDelete = usePermission('treasury.delete');
  const { from, to } = useDateRange();
  const { branchId } = useBranch();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<'ALL' | VoucherTypeT>('ALL');
  const [createOpen, setCreateOpen] = useState(false);
  const [viewId, setViewId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<VoucherRow | null>(null);

  // ── List query ────────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery<PaginatedResponse<VoucherRow>>({
    queryKey: ['vouchers', page, pageSize, search, tab, from, to, branchId],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, pageSize, search };
      if (tab !== 'ALL') params.type = tab;
      if (from) params.from = from;
      if (to) params.to = to;
      if (branchId != null) params.branchId = branchId;
      const res = await apiClient.get<PaginatedResponse<VoucherRow>>('/vouchers', { params });
      return res.data;
    },
  });

  // ── KPI aggregation query (all types in range) ─────────────────────────────
  const { data: allData } = useQuery<PaginatedResponse<VoucherRow>>({
    queryKey: ['vouchers-all', from, to, branchId],
    queryFn: async () => {
      const params: Record<string, string | number> = { page: 1, pageSize: 1000 };
      if (from) params.from = from;
      if (to) params.to = to;
      if (branchId != null) params.branchId = branchId;
      const res = await apiClient.get<PaginatedResponse<VoucherRow>>('/vouchers', { params });
      return res.data;
    },
    staleTime: 1000 * 60 * 2,
  });

  const kpis = (() => {
    const rows = allData?.data ?? [];
    const sum = (t: VoucherTypeT) =>
      rows.filter((r) => r.type === t).reduce((s, r) => s + Number(r.totalAmount ?? 0), 0);
    return {
      receipts: sum('RECEIPT'),
      payments: sum('PAYMENT'),
      deposits: sum('DEPOSIT'),
    };
  })();

  // ── Delete mutation ────────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/vouchers/${id}`),
    onSuccess: () => {
      toast('تم حذف السند وعكس قيوده ✓');
      qc.invalidateQueries({ queryKey: ['vouchers'] });
      qc.invalidateQueries({ queryKey: ['customer-statement'] });
      qc.invalidateQueries({ queryKey: ['supplier-statement'] });
      setDeleteTarget(null);
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر حذف السند'), 'error'),
  });

  // ── Columns ─────────────────────────────────────────────────────────────────
  const columns: Array<Column<VoucherRow>> = [
    {
      key: 'voucherNo',
      header: 'رقم السند',
      render: (r) => <span className="font-mono font-medium text-app-text">{r.voucherNo}</span>,
    },
    {
      key: 'type',
      header: 'النوع',
      render: (r) => <Badge variant={TYPE_BADGE[r.type]}>{TYPE_LABEL[r.type]}</Badge>,
    },
    {
      key: 'date',
      header: 'التاريخ',
      render: (r) => <span className="text-app-muted">{formatDate(r.date)}</span>,
    },
    {
      key: 'party',
      header: 'الطرف',
      render: (r) => <span className="text-app-text">{r.partyName ?? '—'}</span>,
    },
    {
      key: 'treasuryAccount',
      header: 'الخزينة',
      render: (r) => (
        <span className="text-app-muted">
          {r.treasuryAccount ? `${r.treasuryAccount.code} — ${r.treasuryAccount.nameAr}` : '—'}
        </span>
      ),
    },
    {
      key: 'totalAmount',
      header: 'المبلغ',
      render: (r) => (
        <span className={`font-bold ${r.type === 'RECEIPT' || r.type === 'DEPOSIT' ? 'text-success' : 'text-danger'}`}>
          {formatMoney(r.totalAmount)}
        </span>
      ),
    },
    {
      key: 'description',
      header: 'البيان',
      render: (r) => <span className="text-app-muted text-xs">{r.description ?? '—'}</span>,
    },
    {
      key: 'actions',
      header: 'إجراءات',
      render: (r) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewId(r.id)}
            title="عرض"
            className="p-1.5 text-app-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
          >
            <Eye size={16} />
          </button>
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
        title="السندات"
        subtitle="سندات القبض والصرف والخصم والإيداع البنكي — مرتبطة بدفتر اليومية"
        actions={
          canCreate ? (
            <Button icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>
              سند جديد
            </Button>
          ) : null
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-5 bg-white rounded-xl border border-app-border p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              setPage(1);
            }}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              tab === t.key ? 'bg-primary text-white' : 'text-app-muted hover:bg-gray-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="إجمالي المقبوضات" value={formatMoney(kpis.receipts)} tone="text-success" />
        <KpiCard label="إجمالي المدفوعات" value={formatMoney(kpis.payments)} tone="text-danger" />
        <KpiCard label="الإيداعات البنكية" value={formatMoney(kpis.deposits)} tone="text-primary" />
      </div>

      {/* Table */}
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
          emptyText="لا توجد سندات بعد"
          exportTitle="تقرير السندات"
        />
      </div>

      {/* Create modal */}
      {createOpen && (
        <CreateVoucherModal
          open={createOpen}
          onClose={() => setCreateOpen(false)}
          onCreated={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ['vouchers'] });
            qc.invalidateQueries({ queryKey: ['customer-statement'] });
            qc.invalidateQueries({ queryKey: ['supplier-statement'] });
          }}
        />
      )}

      {/* Detail modal */}
      <VoucherDetailModal
        voucherId={viewId}
        open={viewId !== null}
        onClose={() => setViewId(null)}
      />

      {/* Delete confirm */}
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
              حذف وعكس القيد
            </Button>
          </>
        }
      >
        <p className="text-sm text-app-text">
          سيتم حذف السند <span className="font-mono font-bold">{deleteTarget?.voucherNo}</span> وعكس قيده
          المحاسبي وأرصدة الأطراف. لا يمكن التراجع.
        </p>
      </Modal>
    </div>
  );
}

// ── Detail modal ──────────────────────────────────────────────────────────────
function VoucherDetailModal({
  voucherId,
  open,
  onClose,
}: {
  voucherId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const { data: v, isLoading } = useQuery<VoucherDetail>({
    queryKey: ['voucher-detail', voucherId],
    queryFn: async () => (await apiClient.get<VoucherDetail>(`/vouchers/${voucherId}`)).data,
    enabled: open && voucherId !== null,
  });

  const handlePrint = () => {
    if (!v) return;
    printInvoice({
      docTitle: TYPE_LABEL[v.type],
      refNo: v.voucherNo,
      date: v.date,
      partyLabel: 'الطرف',
      partyName: v.partyName ?? '—',
      partyExtra: v.description ?? null,
      items:
        v.lines.length > 0
          ? v.lines.map((l) => ({
              name: l.account.nameAr,
              sku: l.account.code,
              unit: '',
              qty: 1,
              unitPrice: Number(l.amount),
              lineTotal: Number(l.amount),
            }))
          : [{ name: v.description ?? TYPE_LABEL[v.type], sku: '', unit: '', qty: 1, unitPrice: Number(v.totalAmount), lineTotal: Number(v.totalAmount) }],
      subtotal: Number(v.totalAmount),
      discount: 0,
      tax: 0,
      total: Number(v.totalAmount),
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={v ? `${TYPE_LABEL[v.type]} ${v.voucherNo}` : 'تفاصيل السند'}
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إغلاق
          </Button>
          <Button icon={<Printer size={15} />} onClick={handlePrint} disabled={!v}>
            طباعة
          </Button>
        </>
      }
    >
      {isLoading || !v ? (
        <div className="flex justify-center py-10">
          <span className="inline-block w-7 h-7 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-5">
          {/* Meta */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-xs text-app-muted mb-0.5">رقم السند</p>
              <p className="font-mono font-medium">{v.voucherNo}</p>
            </div>
            <div>
              <p className="text-xs text-app-muted mb-0.5">النوع</p>
              <Badge variant={TYPE_BADGE[v.type]}>{TYPE_LABEL[v.type]}</Badge>
            </div>
            <div>
              <p className="text-xs text-app-muted mb-0.5">التاريخ</p>
              <p>{formatDate(v.date)}</p>
            </div>
            <div>
              <p className="text-xs text-app-muted mb-0.5">المبلغ الإجمالي</p>
              <p className="font-bold text-primary">{formatMoney(v.totalAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-app-muted mb-0.5">الطرف</p>
              <p>{v.partyName ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-app-muted mb-0.5">حساب الخزينة</p>
              <p className="flex items-center gap-1">
                <Wallet size={13} className="text-app-muted" />
                {v.treasuryAccount ? `${v.treasuryAccount.code} — ${v.treasuryAccount.nameAr}` : '—'}
              </p>
            </div>
            <div className="col-span-2">
              <p className="text-xs text-app-muted mb-0.5">البيان</p>
              <p>{v.description ?? '—'}</p>
            </div>
          </div>

          {/* Counterparty lines */}
          {v.lines.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-app-text mb-2">بنود السند</h4>
              <div className="overflow-x-auto rounded-xl border border-app-border">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-app-muted">الحساب</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-app-muted">البيان</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-app-muted">المبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.lines.map((l) => (
                      <tr key={l.id} className="border-t border-app-border">
                        <td className="px-4 py-2">
                          <span className="font-medium">{l.account.nameAr}</span>
                          <span className="text-xs text-app-muted block">{l.account.code}</span>
                        </td>
                        <td className="px-4 py-2 text-app-muted">{l.description ?? '—'}</td>
                        <td className="px-4 py-2 text-left font-medium">{formatMoney(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Linked journal entry */}
          {v.journalEntry && (
            <div>
              <h4 className="text-sm font-bold text-app-text mb-2">
                القيد المحاسبي المرتبط <span className="font-mono text-app-muted">({v.journalEntry.entryNo})</span>
              </h4>
              <div className="overflow-x-auto rounded-xl border border-app-border">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-app-muted">الحساب</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-app-muted">مدين</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-app-muted">دائن</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.journalEntry.lines.map((l) => (
                      <tr key={l.id} className="border-t border-app-border">
                        <td className="px-4 py-2">
                          <span className="font-medium">{l.account.nameAr}</span>
                          <span className="text-xs text-app-muted block">{l.account.code}</span>
                        </td>
                        <td className="px-4 py-2 text-left font-mono">{l.debit > 0 ? formatMoney(l.debit) : '—'}</td>
                        <td className="px-4 py-2 text-left font-mono">{l.credit > 0 ? formatMoney(l.credit) : '—'}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-app-border bg-gray-50 font-bold">
                      <td className="px-4 py-2">الإجمالي</td>
                      <td className="px-4 py-2 text-left font-mono">
                        {formatMoney(v.journalEntry.lines.reduce((s, l) => s + Number(l.debit), 0))}
                      </td>
                      <td className="px-4 py-2 text-left font-mono">
                        {formatMoney(v.journalEntry.lines.reduce((s, l) => s + Number(l.credit), 0))}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
