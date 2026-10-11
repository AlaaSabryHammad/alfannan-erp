import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CreditCard, Loader2, Minus, Send, X } from 'lucide-react';
import apiClient from '../../lib/api';
import { getApiErrorMessage } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import {
  FEATURE_LABELS,
  LIMIT_LABELS,
  STATUS_LABELS,
  daysLabel,
  useSubscription,
  type FeatureKey,
  type LimitKey,
  type SubscriptionStatus,
} from '../../hooks/useSubscription';

interface PlanOption {
  id: number;
  code: string;
  nameAr: string;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  limits: Record<LimitKey, number | null>;
  features: Record<FeatureKey, boolean>;
}
interface PaymentRow {
  id: number;
  amount: number;
  currency: string;
  method: string;
  reference: string | null;
  months: number;
  periodEnd: string;
  createdAt: string;
}
interface UpgradeRow {
  id: number;
  requestedPlanId: number;
  status: 'PENDING' | 'HANDLED';
  createdAt: string;
}

const METHODS: Record<string, string> = { CASH: 'نقدًا', BANK_TRANSFER: 'تحويل بنكي', CARD: 'بطاقة', OTHER: 'أخرى' };
const STATUS_STYLE: Record<SubscriptionStatus, string> = {
  TRIALING: 'bg-sky-50 text-sky-700',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  PAST_DUE: 'bg-amber-50 text-amber-700',
  EXPIRED: 'bg-red-50 text-red-700',
  CANCELED: 'bg-slate-100 text-slate-600',
};

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';
const fmtMoney = (n: number) => new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 0 }).format(n);

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit === null ? 0 : limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  const color = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-primary';
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1.5">
        <span className="text-app-text font-medium">{label}</span>
        <span className="text-app-muted">
          {used} / {limit === null ? 'بلا حد' : limit}
        </span>
      </div>
      <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full ${limit === null ? 'bg-emerald-400' : color}`} style={{ width: limit === null ? '12%' : `${pct}%` }} />
      </div>
    </div>
  );
}

export function SubscriptionPage() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canRequest = hasPermission('settings.edit');
  const { data: sub, isLoading } = useSubscription();

  const plans = useQuery({
    queryKey: ['subscription', 'plans'],
    queryFn: async () => (await apiClient.get<PlanOption[]>('/subscription/plans')).data,
  });
  const payments = useQuery({
    queryKey: ['subscription', 'payments'],
    queryFn: async () => (await apiClient.get<PaymentRow[]>('/subscription/payments')).data,
  });
  const requests = useQuery({
    queryKey: ['subscription', 'requests'],
    queryFn: async () => (await apiClient.get<UpgradeRow[]>('/subscription/upgrade-requests')).data,
  });

  // online payment: period toggle, checkout, and the page the gateway sends the customer back to
  const [params, setParams] = useSearchParams();
  const [period, setPeriod] = useState<1 | 12>(1);
  const returnOrderId = params.get('payment') === 'return' ? Number(params.get('order')) : null;

  const pay = useMutation({
    mutationFn: async (planId: number) =>
      (await apiClient.post<{ orderId: number; checkoutUrl: string }>('/subscription/checkout', { planId, months: period })).data,
    onSuccess: (r) => { window.location.href = r.checkoutUrl; },
    onError: (err) => setNotice({ type: 'error', text: getApiErrorMessage(err, 'تعذّر بدء الدفع') }),
  });

  const orderStatus = useQuery({
    queryKey: ['subscription', 'order', returnOrderId],
    enabled: !!returnOrderId,
    queryFn: async () =>
      (await apiClient.get<{ status: 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' }>('/subscription/checkout/' + returnOrderId)).data,
    refetchInterval: (query) => (query.state.data?.status === 'PENDING' || !query.state.data ? 3000 : false),
  });

  useEffect(() => {
    const status = orderStatus.data?.status;
    if (!status || status === 'PENDING') return;
    if (status === 'PAID') {
      qc.invalidateQueries({ queryKey: ['subscription'] });
      setNotice({ type: 'ok', text: 'تم الدفع بنجاح وتفعيل اشتراكك. شكرًا لك!' });
    } else {
      setNotice({ type: 'error', text: 'لم تكتمل عملية الدفع. لم يُخصم أي مبلغ، ويمكنك المحاولة من جديد.' });
    }
    setParams({}, { replace: true });
  }, [orderStatus.data?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (params.get('payment') === 'cancelled') {
      setNotice({ type: 'error', text: 'تم إلغاء عملية الدفع.' });
      setParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [target, setTarget] = useState<PlanOption | null>(null);
  const [message, setMessage] = useState('');
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const send = useMutation({
    mutationFn: async () =>
      apiClient.post('/subscription/upgrade-request', { planId: target!.id, message: message.trim() || undefined }),
    onSuccess: () => {
      setNotice({ type: 'ok', text: 'تم إرسال طلبك. سنتواصل معك لإتمام الترقية.' });
      setTarget(null);
      setMessage('');
      qc.invalidateQueries({ queryKey: ['subscription', 'requests'] });
    },
    onError: (err) => {
      setNotice({ type: 'error', text: getApiErrorMessage(err, 'تعذّر إرسال الطلب') });
      setTarget(null);
    },
  });

  if (isLoading || !sub) {
    return <div className="py-20 flex justify-center"><Loader2 className="animate-spin text-app-muted" /></div>;
  }

  const pending = new Set((requests.data ?? []).filter((r) => r.status === 'PENDING').map((r) => r.requestedPlanId));
  const limitKeys = Object.keys(LIMIT_LABELS) as LimitKey[];
  const featureKeys = Object.keys(FEATURE_LABELS) as FeatureKey[];
  const endLabel =
    sub.status === 'TRIALING' ? 'تنتهي التجربة' : sub.status === 'ACTIVE' || sub.status === 'PAST_DUE' ? 'ينتهي الاشتراك' : 'انتهى في';
  const endDate = sub.status === 'TRIALING' ? sub.trialEndsAt : sub.currentPeriodEnd;

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div>
        <h1 className="text-xl font-bold text-app-text">الاشتراك والباقة</h1>
        <p className="text-sm text-app-muted mt-1">باقتك الحالية، واستهلاكك مقابل الحدود، وسجل الدفعات.</p>
      </div>

      {returnOrderId && orderStatus.data?.status === 'PENDING' && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 text-sky-800 px-4 py-3 text-sm flex items-center gap-2">
          <Loader2 size={16} className="animate-spin" /> نتحقق من عملية الدفع... لحظات ويتم تفعيل اشتراكك.
        </div>
      )}

      {notice && (
        <div className={`rounded-lg border px-4 py-3 text-sm ${notice.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {notice.text}
        </div>
      )}

      {/* current plan */}
      <section className="bg-white rounded-xl border border-app-border p-5">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-lg font-bold text-app-text">{sub.planName ?? 'بدون باقة'}</h2>
          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${STATUS_STYLE[sub.status]}`}>{STATUS_LABELS[sub.status]}</span>
          {endDate && (
            <span className="mr-auto text-sm text-app-muted">
              {endLabel} {fmtDate(endDate)}
              {sub.daysLeft !== null && sub.daysLeft >= 0 && <b className="text-app-text"> · باقي {daysLabel(sub.daysLeft)}</b>}
            </span>
          )}
        </div>
        {sub.readOnly && (
          <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            النظام في وضع القراءة فقط: تستطيع الاطلاع على بياناتك وتصديرها، لكن لا يمكن إضافة أو تعديل.
          </p>
        )}
      </section>

      {/* usage */}
      <section className="bg-white rounded-xl border border-app-border p-5">
        <h2 className="text-base font-bold text-app-text mb-4">الاستهلاك مقابل حدود الباقة</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
          {limitKeys.map((k) => (
            <Meter key={k} label={LIMIT_LABELS[k]} used={sub.usage[k]} limit={sub.limits[k]} />
          ))}
        </div>
        <div className="mt-5 pt-4 border-t border-app-border grid grid-cols-1 sm:grid-cols-3 gap-2">
          {featureKeys.map((k) => (
            <div key={k} className="flex items-center gap-2 text-sm">
              {sub.features[k] ? <Check size={16} className="text-emerald-600" /> : <Minus size={16} className="text-slate-400" />}
              <span className={sub.features[k] ? 'text-app-text' : 'text-app-muted'}>{FEATURE_LABELS[k]}</span>
            </div>
          ))}
        </div>
      </section>

      {/* plans */}
      <section>
        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <h2 className="text-base font-bold text-app-text">الباقات المتاحة</h2>
          {sub.paymentsEnabled && (
            <div className="mr-auto inline-flex rounded-lg border border-app-border bg-white p-0.5 text-sm">
              {([1, 12] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setPeriod(m)}
                  className={'px-3 py-1 rounded-md font-medium ' + (period === m ? 'bg-primary text-white' : 'text-app-muted hover:text-app-text')}
                >
                  {m === 1 ? 'شهري' : 'سنوي'}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.data?.map((p) => {
            const current = p.code === sub.planCode;
            return (
              <div key={p.id} className={`bg-white rounded-xl border p-5 flex flex-col ${current ? 'border-primary ring-1 ring-primary/30' : 'border-app-border'}`}>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-app-text">{p.nameAr}</h3>
                  {current && <span className="text-[11px] font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">باقتك</span>}
                </div>
                <p className="mt-2 text-2xl font-bold text-app-text">
                  {p.priceMonthly > 0
                    ? fmtMoney(sub.paymentsEnabled && period === 12 ? (p.priceYearly > 0 ? p.priceYearly : p.priceMonthly * 12) : p.priceMonthly)
                    : 'حسب الاتفاق'}
                  {p.priceMonthly > 0 && (
                    <span className="text-sm font-normal text-app-muted">
                      {' '}{p.currency} / {sub.paymentsEnabled && period === 12 ? 'سنة' : 'شهر'}
                    </span>
                  )}
                </p>
                {p.priceYearly > 0 && !(sub.paymentsEnabled && period === 12) && (
                  <p className="text-xs text-app-muted">أو {fmtMoney(p.priceYearly)} {p.currency} سنويًا</p>
                )}
                <p className="text-[11px] text-app-muted">الأسعار شاملة ضريبة القيمة المضافة</p>
                <ul className="mt-4 mb-5 flex flex-col gap-1.5 text-sm text-app-text flex-1">
                  {limitKeys.map((k) => (
                    <li key={k} className="flex justify-between">
                      <span className="text-app-muted">{LIMIT_LABELS[k]}</span>
                      <b>{p.limits[k] ?? 'بلا حد'}</b>
                    </li>
                  ))}
                  {featureKeys.map((k) => (
                    <li key={k} className="flex items-center gap-2">
                      {p.features[k] ? <Check size={14} className="text-emerald-600" /> : <X size={14} className="text-slate-300" />}
                      <span className={p.features[k] ? '' : 'text-app-muted'}>{FEATURE_LABELS[k]}</span>
                    </li>
                  ))}
                </ul>
                {current ? (
                  <button disabled className="w-full py-2 rounded-lg text-sm font-semibold bg-slate-100 text-slate-500">باقتك الحالية</button>
                ) : pending.has(p.id) ? (
                  <button disabled className="w-full py-2 rounded-lg text-sm font-semibold bg-amber-50 text-amber-700">طلبك قيد المراجعة</button>
                ) : sub.paymentsEnabled && p.priceMonthly > 0 ? (
                  <div className="flex flex-col gap-2">
                    <button
                      disabled={!canRequest || pay.isPending}
                      onClick={() => { setNotice(null); pay.mutate(p.id); }}
                      title={canRequest ? undefined : 'ليست لديك صلاحية الدفع'}
                      className="w-full py-2 rounded-lg text-sm font-semibold bg-primary hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {pay.isPending && pay.variables === p.id ? <Loader2 size={15} className="animate-spin" /> : <CreditCard size={15} />}
                      ادفع الآن
                    </button>
                    <button
                      disabled={!canRequest}
                      onClick={() => { setNotice(null); setTarget(p); }}
                      className="text-xs text-app-muted hover:text-app-text underline disabled:opacity-50"
                    >
                      أو اطلب التواصل معي
                    </button>
                  </div>
                ) : (
                  <button
                    disabled={!canRequest}
                    onClick={() => { setNotice(null); setTarget(p); }}
                    title={canRequest ? undefined : 'ليست لديك صلاحية طلب الترقية'}
                    className="w-full py-2 rounded-lg text-sm font-semibold bg-primary hover:bg-primary-600 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <Send size={15} /> اطلب هذه الباقة
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* payments */}
      <section className="bg-white rounded-xl border border-app-border">
        <h2 className="text-base font-bold text-app-text p-5 pb-3">سجل الدفعات</h2>
        {payments.data && payments.data.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-app-muted text-xs">
                <tr>
                  {['التاريخ', 'المبلغ', 'المدة', 'الطريقة', 'المرجع', 'تغطي حتى'].map((h) => (
                    <th key={h} className="text-right font-medium px-5 py-2.5">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border">
                {payments.data.map((p) => (
                  <tr key={p.id}>
                    <td className="px-5 py-3 text-app-muted">{fmtDate(p.createdAt)}</td>
                    <td className="px-5 py-3 font-semibold">{fmtMoney(p.amount)} {p.currency}</td>
                    <td className="px-5 py-3">{p.months} شهر</td>
                    <td className="px-5 py-3">{METHODS[p.method] ?? p.method}</td>
                    <td className="px-5 py-3 text-app-muted" dir="ltr">{p.reference ?? '—'}</td>
                    <td className="px-5 py-3 text-app-muted">{fmtDate(p.periodEnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 pb-6 text-sm text-app-muted">لا توجد دفعات مسجّلة بعد.</p>
        )}
      </section>

      {/* upgrade request dialog */}
      {target && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-app-text">طلب باقة «{target.nameAr}»</h3>
              <button onClick={() => setTarget(null)} className="text-app-muted hover:text-app-text"><X size={20} /></button>
            </div>
            <p className="text-sm text-app-muted">
              سنستلم طلبك ونتواصل معك لإتمام الدفع وتفعيل الباقة. يمكنك إضافة ملاحظة:
            </p>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="مثال: نحتاج فرعًا إضافيًا ومستخدمين أكثر"
              className="w-full border border-app-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setTarget(null)} className="px-4 py-2 text-sm text-app-muted hover:bg-slate-100 rounded-lg">إلغاء</button>
              <button
                onClick={() => send.mutate()}
                disabled={send.isPending}
                className="px-4 py-2 text-sm font-semibold bg-primary hover:bg-primary-600 text-white rounded-lg disabled:opacity-60 flex items-center gap-2"
              >
                {send.isPending && <Loader2 size={14} className="animate-spin" />} إرسال الطلب
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
