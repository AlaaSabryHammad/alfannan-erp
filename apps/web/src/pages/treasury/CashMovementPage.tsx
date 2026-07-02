import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import apiClient from '../../lib/api';
import { useDateRange } from '../../contexts/DateRangeContext';
import { formatMoney, formatDate } from '../../lib/utils';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';

interface TreasuryAccount {
  id: number;
  code: string;
  nameAr: string;
  currentBalance: number;
}

interface MovementLine {
  journalLineId: number;
  entryId: number;
  entryNo: string;
  refNo: string;
  date: string;
  description: string;
  sourceType: string;
  debit: number;
  credit: number;
  balance: number;
}

interface CashMovementData {
  account: { id: number; code: string; nameAr: string; type: string; openingBalance: number };
  opening: number;
  closing: number;
  lines: MovementLine[];
}

const SOURCE_LABEL: Record<string, string> = {
  SALES_INVOICE: 'فاتورة مبيعات',
  PURCHASE_INVOICE: 'فاتورة مشتريات',
  EXPENSE: 'مصروف',
  MANUAL: 'قيد يدوي',
  OPENING: 'قيد افتتاحي',
  VOUCHER: 'سند',
};

export function CashMovementPage() {
  const { from, to } = useDateRange();
  const [accountId, setAccountId] = useState<number | ''>('');

  // Load treasury accounts
  const { data: accountsData } = useQuery<{ data: TreasuryAccount[] }>({
    queryKey: ['treasury-accounts'],
    queryFn: async () => (await apiClient.get<{ data: TreasuryAccount[] }>('/treasury/accounts')).data,
  });
  const accounts = accountsData?.data ?? [];

  // Auto-select first account
  if (accountId === '' && accounts.length > 0) {
    setAccountId(accounts[0].id);
  }

  // Load movement
  const { data, isLoading } = useQuery<CashMovementData>({
    queryKey: ['cash-movement', accountId, from, to],
    queryFn: async () => {
      const params: Record<string, string | number> = { accountId };
      if (from) params.from = from;
      if (to) params.to = to;
      return (await apiClient.get<CashMovementData>('/treasury/cash-movement', { params })).data;
    },
    enabled: accountId !== '',
  });

  function handlePrint() {
    if (!data) return;
    const acc = data.account;
    const rowsHtml = data.lines
      .map(
        (l) =>
          `<tr>
            <td>${formatDate(l.date)}</td>
            <td>${l.entryNo}</td>
            <td>${SOURCE_LABEL[l.sourceType] ?? l.sourceType}</td>
            <td>${l.description ?? ''}</td>
            <td class="num">${l.debit > 0 ? formatMoney(l.debit) : '—'}</td>
            <td class="num">${l.credit > 0 ? formatMoney(l.credit) : '—'}</td>
            <td class="num">${formatMoney(l.balance)}</td>
          </tr>`
      )
      .join('');

    const w = window.open('', '_blank');
    if (!w) {
      alert('تعذّر فتح نافذة الطباعة — الرجاء السماح بالنوافذ المنبثقة.');
      return;
    }
    const rangeText = from || to ? `من ${from ?? 'البداية'} إلى ${to ?? 'اليوم'}` : 'كافة الفترات';
    w.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
      <title>حركة الصندوق — ${acc.nameAr}</title>
      <style>
        @page { size: A4 landscape; margin: 12mm; }
        body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; padding: 20px; color: #111; }
        h1 { color: #0d9488; font-size: 20px; margin: 0 0 4px; }
        h2 { font-size: 14px; color: #374151; margin: 0 0 12px; }
        .meta { font-size: 12px; color: #6b7280; margin-bottom: 16px; }
        .summary { display:flex; gap: 20px; margin-bottom: 16px; }
        .summary div { background:#f0fdfa; border:1px solid #ccfbf1; border-radius:8px; padding:8px 14px; }
        .summary .lbl { font-size:11px; color:#64748b; }
        .summary .val { font-size:16px; font-weight:700; color:#0d9488; }
        table { width:100%; border-collapse:collapse; font-size:12px; }
        thead th { background:#0d9488; color:#fff; padding:8px; text-align:right; font-weight:600; }
        tbody td { padding:7px 8px; border-bottom:1px solid #e5e7eb; }
        tbody tr:nth-child(even){ background:#f8fafc; }
        .num { font-family:'Courier New',monospace; text-align:left; }
      </style></head><body>
      <h1>الفنان للتوريدات العمومية</h1>
      <h2>حركة الصندوق — ${acc.code} ${acc.nameAr}</h2>
      <div class="meta">الفترة: ${rangeText}</div>
      <div class="summary">
        <div><div class="lbl">الرصيد الافتتاحي</div><div class="val">${formatMoney(data.opening)}</div></div>
        <div><div class="lbl">الرصيد الختامي</div><div class="val">${formatMoney(data.closing)}</div></div>
        <div><div class="lbl">عدد الحركات</div><div class="val">${data.lines.length}</div></div>
      </div>
      <table><thead><tr>
        <th>التاريخ</th><th>رقم القيد</th><th>المصدر</th><th>البيان</th>
        <th>وارد (مدين)</th><th>منصرف (دائن)</th><th>الرصيد</th>
      </tr></thead><tbody>${rowsHtml}</tbody></table>
      <script>window.onload=function(){window.print();};</script>
      </body></html>`);
    w.document.close();
  }

  return (
    <div>
      <PageHeader
        title="حركة الصندوق"
        subtitle="كشف حركة النقدية والبنك — الأرصدة والوارد والمنصرف"
        actions={
          <Button icon={<Printer size={16} />} onClick={handlePrint} disabled={!data}>
            طباعة
          </Button>
        }
      />

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div className="w-72">
          <Select label="حساب الخزينة" value={accountId} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.code} — {a.nameAr}
              </option>
            ))}
          </Select>
        </div>
        {(from || to) && (
          <div className="text-sm text-app-muted bg-white border border-app-border rounded-lg px-3 py-2">
            الفترة: من <b>{from ?? 'البداية'}</b> إلى <b>{to ?? 'اليوم'}</b>
          </div>
        )}
      </div>

      {/* Summary cards */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-2xl border border-app-border shadow-sm p-4">
            <p className="text-xs text-app-muted mb-1">الرصيد الافتتاحي</p>
            <p className="text-lg font-bold text-app-text">{formatMoney(data.opening)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-app-border shadow-sm p-4">
            <p className="text-xs text-app-muted mb-1">الرصيد الختامي</p>
            <p className="text-lg font-bold text-primary">{formatMoney(data.closing)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-app-border shadow-sm p-4">
            <p className="text-xs text-app-muted mb-1">عدد الحركات</p>
            <p className="text-lg font-bold text-app-text">{data.lines.length}</p>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-app-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-app-border">
              <tr>
                <th className="px-4 py-3 text-right text-xs font-semibold text-app-muted">التاريخ</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-app-muted">رقم القيد</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-app-muted">المصدر</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-app-muted">البيان</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-app-muted">وارد (مدين)</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-app-muted">منصرف (دائن)</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-app-muted">الرصيد</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-app-muted">
                    <span className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  </td>
                </tr>
              ) : !data || data.lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-app-muted">
                    لا توجد حركات في هذه الفترة
                  </td>
                </tr>
              ) : (
                data.lines.map((l) => (
                  <tr key={l.journalLineId} className="border-b border-app-border last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-2.5 text-app-muted">{formatDate(l.date)}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">{l.entryNo}</td>
                    <td className="px-4 py-2.5 text-app-muted">{SOURCE_LABEL[l.sourceType] ?? l.sourceType}</td>
                    <td className="px-4 py-2.5">{l.description ?? '—'}</td>
                    <td className="px-4 py-2.5 text-left font-mono text-success">{l.debit > 0 ? formatMoney(l.debit) : '—'}</td>
                    <td className="px-4 py-2.5 text-left font-mono text-danger">{l.credit > 0 ? formatMoney(l.credit) : '—'}</td>
                    <td className="px-4 py-2.5 text-left font-mono font-semibold">{formatMoney(l.balance)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
