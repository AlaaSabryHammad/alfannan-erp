import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import apiClient from '../../lib/api';
import { getApiErrorMessage } from '../../lib/utils';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';

type VoucherTypeT = 'RECEIPT' | 'PAYMENT' | 'DISCOUNT' | 'DEPOSIT';
type PartyTypeT = 'CUSTOMER' | 'SUPPLIER' | 'ACCOUNT';

interface TreasuryAccount {
  id: number;
  code: string;
  nameAr: string;
}

interface PartyOption {
  id: number;
  nameAr: string;
}

interface CreateVoucherModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

interface CompoundLine {
  accountId: number | '';
  amount: string;
  description: string;
}

const TYPE_OPTIONS: Array<{ value: VoucherTypeT; label: string }> = [
  { value: 'RECEIPT', label: 'سند قبض' },
  { value: 'PAYMENT', label: 'سند صرف' },
  { value: 'DISCOUNT', label: 'سند خصم' },
  { value: 'DEPOSIT', label: 'إيداع بنكي' },
];

function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2500);
}

export function CreateVoucherModal({ open, onClose, onCreated }: CreateVoucherModalProps) {
  const [type, setType] = useState<VoucherTypeT>('RECEIPT');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [treasuryAccountId, setTreasuryAccountId] = useState<number | ''>('');
  const [partyType, setPartyType] = useState<PartyTypeT>('CUSTOMER');
  const [partyId, setPartyId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [compound, setCompound] = useState(false);
  const [lines, setLines] = useState<CompoundLine[]>([
    { accountId: '', amount: '', description: '' },
  ]);
  const [submitting, setSubmitting] = useState(false);

  // ── Data: treasury accounts ─────────────────────────────────────────────────
  const [treasuryAccounts, setTreasuryAccounts] = useState<TreasuryAccount[]>([]);
  if (open && treasuryAccounts.length === 0) {
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

  // ── Data: accounts (for compound lines + ACCOUNT party) ─────────────────────
  const [accounts, setAccounts] = useState<TreasuryAccount[]>([]);
  if (open && accounts.length === 0) {
    apiClient
      .get<{ data: TreasuryAccount[] }>('/accounts', { params: { page: 1, pageSize: 500 } })
      .then((r) => setAccounts(r.data.data))
      .catch(() => {});
  }

  // ── Data: customers/suppliers (party pickers) ───────────────────────────────
  const [customers, setCustomers] = useState<PartyOption[]>([]);
  const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
  if (open && customers.length === 0) {
    apiClient
      .get<{ data: PartyOption[] }>('/customers', { params: { page: 1, pageSize: 500 } })
      .then((r) => setCustomers(r.data.data))
      .catch(() => {});
  }
  if (open && suppliers.length === 0) {
    apiClient
      .get<{ data: PartyOption[] }>('/suppliers', { params: { page: 1, pageSize: 500 } })
      .then((r) => setSuppliers(r.data.data))
      .catch(() => {});
  }

  const mutation = useMutation({
    mutationFn: (payload: unknown) => apiClient.post('/vouchers', payload),
    onSuccess: () => {
      toast('تم إنشاء السند وقيد القيد بنجاح ✓');
      reset();
      onCreated();
    },
    onError: (err) => toast(getApiErrorMessage(err, 'تعذّر إنشاء السند'), 'error'),
  });

  function reset() {
    setType('RECEIPT');
    setDate(new Date().toISOString().slice(0, 10));
    setPartyType('CUSTOMER');
    setPartyId('');
    setAmount('');
    setDescription('');
    setCompound(false);
    setLines([{ accountId: '', amount: '', description: '' }]);
  }

  // Auto-set party type based on voucher type
  function handleTypeChange(t: VoucherTypeT) {
    setType(t);
    if (t === 'RECEIPT') setPartyType('CUSTOMER');
    else if (t === 'PAYMENT') setPartyType('SUPPLIER');
    else if (t === 'DEPOSIT') setPartyType('ACCOUNT');
    setPartyId('');
  }

  const compoundTotal = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const compoundValid =
    lines.length > 0 &&
    lines.every((l) => l.accountId !== '' && Number(l.amount) > 0) &&
    compoundTotal > 0;

  function handleSubmit() {
    if (!treasuryAccountId) {
      toast('يرجى اختيار حساب الخزينة', 'error');
      return;
    }

    const payload: Record<string, unknown> = {
      type,
      date,
      treasuryAccountId,
      description: description || undefined,
    };

    if (type !== 'DEPOSIT') {
      payload.partyType = partyType;
      payload.partyId = partyId || undefined;
    }

    if (compound) {
      if (!compoundValid) {
        toast('يرجى إكمال بنود السند المركب (حساب ومبلغ لكل بند)', 'error');
        return;
      }
      payload.lines = lines.map((l) => ({
        accountId: Number(l.accountId),
        amount: Number(l.amount),
        description: l.description || undefined,
      }));
    } else {
      if (!amount || Number(amount) <= 0) {
        toast('يرجى إدخال مبلغ صحيح', 'error');
        return;
      }
      payload.amount = Number(amount);
    }

    setSubmitting(true);
    mutation.mutate(payload, {
      onSettled: () => setSubmitting(false),
    });
  }

  // Party select options depend on party type
  const partyOptions: PartyOption[] =
    partyType === 'CUSTOMER' ? customers : partyType === 'SUPPLIER' ? suppliers : accounts;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="سند جديد"
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            حفظ وقيد القيد
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Type + Date */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="نوع السند"
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as VoucherTypeT)}
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Input
            label="التاريخ"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {/* Treasury account */}
        <Select
          label="حساب الخزينة (نقدية / بنك)"
          value={treasuryAccountId}
          onChange={(e) => setTreasuryAccountId(Number(e.target.value))}
        >
          {treasuryAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} — {a.nameAr}
            </option>
          ))}
        </Select>

        {/* Party (hidden for DEPOSIT) */}
        {type !== 'DEPOSIT' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="نوع الطرف"
              value={partyType}
              onChange={(e) => {
                setPartyType(e.target.value as PartyTypeT);
                setPartyId('');
              }}
              disabled={type === 'RECEIPT' || type === 'PAYMENT'}
            >
              {(type === 'DISCOUNT'
                ? ([
                    { value: 'CUSTOMER', label: 'عميل' },
                    { value: 'SUPPLIER', label: 'مورد' },
                    { value: 'ACCOUNT', label: 'حساب' },
                  ] as Array<{ value: PartyTypeT; label: string }>)
                : type === 'RECEIPT'
                ? [{ value: 'CUSTOMER', label: 'عميل' }]
                : [{ value: 'SUPPLIER', label: 'مورد' }]
              ).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select
              label="الطرف"
              value={partyId}
              onChange={(e) => setPartyId(Number(e.target.value))}
            >
              <option value="">— اختر —</option>
              {partyOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nameAr}
                </option>
              ))}
            </Select>
          </div>
        )}

        {/* Description */}
        <Input
          label="البيان (اختياري)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="وصف السند..."
        />

        {/* Compound toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={compound}
            onChange={(e) => setCompound(e.target.checked)}
            className="w-4 h-4 accent-primary"
          />
          <span className="text-sm font-medium text-app-text">سند مركب (عدة بنود)</span>
        </label>

        {/* Amount (simple) OR lines (compound) */}
        {compound ? (
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-bold text-app-text">بنود السند</h4>
              <Button
                size="sm"
                variant="ghost"
                icon={<Plus size={14} />}
                onClick={() => setLines([...lines, { accountId: '', amount: '', description: '' }])}
              >
                إضافة بند
              </Button>
            </div>
            <div className="space-y-2">
              {lines.map((l, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-5">
                    <Select
                      label={idx === 0 ? 'الحساب المقابل' : undefined}
                      value={l.accountId}
                      onChange={(e) =>
                        setLines(lines.map((x, i) => (i === idx ? { ...x, accountId: Number(e.target.value) } : x)))
                      }
                    >
                      <option value="">— اختر —</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} — {a.nameAr}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="col-span-3">
                    <Input
                      label={idx === 0 ? 'المبلغ' : undefined}
                      type="number"
                      value={l.amount}
                      onChange={(e) =>
                        setLines(lines.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))
                      }
                    />
                  </div>
                  <div className="col-span-3">
                    <Input
                      label={idx === 0 ? 'البيان' : undefined}
                      value={l.description}
                      onChange={(e) =>
                        setLines(lines.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))
                      }
                    />
                  </div>
                  <div className="col-span-1">
                    {lines.length > 1 && (
                      <button
                        onClick={() => setLines(lines.filter((_, i) => i !== idx))}
                        className="p-2 text-app-muted hover:text-danger hover:bg-danger/10 rounded-lg transition-colors"
                        title="حذف البند"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end mt-3 pt-2 border-t border-app-border">
              <span className="text-sm text-app-muted">
                الإجمالي: <span className="font-bold text-primary text-base">{compoundTotal.toFixed(2)} ر.س</span>
              </span>
            </div>
          </div>
        ) : (
          <Input
            label="المبلغ"
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        )}
      </div>
    </Modal>
  );
}
