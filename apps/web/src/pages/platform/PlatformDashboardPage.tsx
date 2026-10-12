import { useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, BadgeCheck, Copy, Download, KeyRound, Loader2, LogOut, Mail, PauseCircle, PlayCircle, Plus, Search,
  UserCheck, UserX, Users, X,
} from 'lucide-react';
import { BrandMark } from '../../components/BrandLogo';
import { AnnouncementsTab, SystemTab } from './PlatformSystemTabs';
import { AdminsTab, ROLE_LABEL } from './PlatformAdminsTab';
import { AnalyticsTab } from './PlatformAnalyticsTab';
import { PlatformShell, type SectionId } from './PlatformShell';
import type { AxiosError } from 'axios';
import {
  platformApi,
  PLATFORM_ADMIN_KEY,
  PLATFORM_TOKEN_KEY,
  platformRole,
  FEATURE_LABELS,
  LIMIT_LABELS,
  STATUS_LABELS,
  type FeatureKey,
  type LimitKey,
  type PlatformAuditRow,
  type PlatformPayment,
  type PlatformPaymentOrder,
  type PlatformPlan,
  type PlatformStats,
  type PlatformTenant,
  type PlatformTenantDetail,
  type PlatformUpgradeRequest,
  type SubscriptionStatus,
} from '../../lib/platformApi';

const fmtDate = (v: string | null) =>
  v ? new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
const fmtMoney = (n: number | string) =>
  new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 0 }).format(Number(n));

const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'دخول مدير المنصة',
  TENANT_SUSPEND: 'إيقاف شركة',
  TENANT_ACTIVATE: 'تفعيل شركة',
  TENANT_RENAME: 'تغيير اسم شركة',
  USER_PASSWORD_RESET: 'إعادة تعيين كلمة مرور',
  USER_ACTIVATE: 'تفعيل مستخدم',
  USER_DEACTIVATE: 'تعطيل مستخدم',
  USER_FORCE_LOGOUT: 'إنهاء جلسات مستخدم',
  USER_EMAIL_VERIFIED: 'تأكيد بريد مستخدم يدويًا',
  USER_VERIFICATION_RESENT: 'إعادة إرسال رسالة التأكيد',
  TENANT_NOTE: 'تعديل ملاحظة شركة',
  ADMIN_CREATE: 'إضافة مدير منصة',
  ADMIN_UPDATE: 'تعديل مدير منصة',
  ADMIN_ROLE_CHANGE: 'تغيير دور مدير منصة',
  ADMIN_ACTIVATE: 'تفعيل مدير منصة',
  ADMIN_DEACTIVATE: 'تعطيل مدير منصة',
  ADMIN_RESET_PASSWORD: 'إعادة تعيين كلمة مرور مدير منصة',
  ANNOUNCEMENT_CREATE: 'نشر إعلان',
  ANNOUNCEMENT_UPDATE: 'تعديل إعلان',
  ANNOUNCEMENT_DELETE: 'حذف إعلان',
  SIGNUP_SETTING: 'ضبط تسجيل الشركات',
  TEST_EMAIL: 'رسالة بريد اختبار',
  PLAN_CREATE: 'إنشاء باقة',
  PLAN_UPDATE: 'تعديل باقة',
  SUB_CHANGE_PLAN: 'تغيير باقة شركة',
  SUB_EXTEND_TRIAL: 'تمديد تجربة',
  SUB_ACTIVATE: 'تفعيل/تجديد اشتراك',
  SUB_CANCEL: 'إلغاء اشتراك',
  SUB_OVERRIDES: 'حدود/مزايا مخصصة',
  UPGRADE_REQUEST_HANDLED: 'معالجة طلب ترقية',
  PLATFORM_PASSWORD_CHANGE: 'تغيير كلمة مرور مالك المنصة',
  SUB_AUTO_EXPIRE: 'انتهاء تلقائي للاشتراك',
  PAYMENT_ONLINE: 'دفع إلكتروني ناجح',
  PAYMENT_ORDER_SETTLE: 'إعادة فحص طلب دفع',
  SUB_AUTO_PAST_DUE: 'بدء فترة السماح (تلقائي)',
  SUB_REMINDER: 'تذكير قبل الانتهاء',
  LIFECYCLE_RUN: 'تشغيل فحص الاشتراكات',
};

const METHOD_LABELS: Record<string, string> = {
  CASH: 'نقدًا',
  BANK_TRANSFER: 'تحويل بنكي',
  CARD: 'بطاقة',
  OTHER: 'أخرى',
};

const STATUS_STYLE: Record<SubscriptionStatus, string> = {
  TRIALING: 'bg-sky-50 text-sky-700',
  ACTIVE: 'bg-emerald-50 text-emerald-700',
  PAST_DUE: 'bg-amber-50 text-amber-700',
  EXPIRED: 'bg-red-50 text-red-700',
  CANCELED: 'bg-najd-sand text-najd-muted',
};

const input =
  'w-full border border-najd-line rounded-lg px-3 py-2 text-sm bg-najd-paper focus:outline-none focus:ring-2 focus:ring-najd-gold/40 focus:border-najd-gold';

const errorOf = (err: unknown) =>
  (err as AxiosError<{ error?: string }>).response?.data?.error ?? 'تعذّر تنفيذ العملية';

function StatusBadge({ status }: { status: SubscriptionStatus | undefined }) {
  if (!status) return <span className="text-xs text-najd-muted/70">—</span>;
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="relative overflow-hidden bg-najd-paper rounded-2xl border border-najd-line p-4 pt-5">
      <span className="absolute inset-x-0 top-0 h-1" style={{ background: 'linear-gradient(90deg,#14573F,#C8963E)' }} />
      <p className="text-xs text-najd-muted">{label}</p>
      <p className="font-display text-3xl font-bold text-najd-ink mt-1">{value}</p>
      {hint && <p className="text-xs text-najd-muted/70 mt-1">{hint}</p>}
    </div>
  );
}

function SignupsChart({ data }: { data: PlatformStats['signupsByDay'] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="bg-najd-paper rounded-xl border border-najd-line p-4">
      <p className="text-sm font-semibold text-najd-ink/80 mb-3">تسجيلات الشركات — آخر 30 يومًا</p>
      <div className="flex items-end gap-1 h-24">
        {data.map((d) => (
          <div key={d.date} className="flex-1 flex flex-col justify-end" title={`${d.date}: ${d.count}`}>
            <div
              className={d.count ? 'bg-najd-gold rounded-t' : 'bg-najd-line rounded-t'}
              style={{ height: `${d.count ? Math.max(8, (d.count / max) * 100) : 4}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── plan editor ───────────────────────────────────────────────────────────────

function PlanForm({ plan, onClose }: { plan: PlatformPlan | null; onClose: () => void }) {
  const qc = useQueryClient();
  const limitKeys = Object.keys(LIMIT_LABELS) as LimitKey[];
  const featureKeys = Object.keys(FEATURE_LABELS) as FeatureKey[];

  const [code, setCode] = useState(plan?.code ?? '');
  const [nameAr, setNameAr] = useState(plan?.nameAr ?? '');
  const [priceMonthly, setPriceMonthly] = useState(String(plan ? Number(plan.priceMonthly) : 0));
  const [priceYearly, setPriceYearly] = useState(String(plan ? Number(plan.priceYearly) : 0));
  const [trialDays, setTrialDays] = useState(String(plan?.trialDays ?? 0));
  const [sortOrder, setSortOrder] = useState(String(plan?.sortOrder ?? 10));
  const [isActive, setIsActive] = useState(plan?.isActive ?? true);
  const [limits, setLimits] = useState<Record<LimitKey, string>>(
    () => Object.fromEntries(limitKeys.map((k) => [k, plan?.limits[k] == null ? '' : String(plan.limits[k])])) as Record<LimitKey, string>,
  );
  const [features, setFeatures] = useState<Record<FeatureKey, boolean>>(
    () => Object.fromEntries(featureKeys.map((k) => [k, plan?.features[k] ?? false])) as Record<FeatureKey, boolean>,
  );
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        nameAr,
        priceMonthly: Number(priceMonthly),
        priceYearly: Number(priceYearly),
        trialDays: Number(trialDays),
        sortOrder: Number(sortOrder),
        isActive,
        limits: Object.fromEntries(limitKeys.map((k) => [k, limits[k].trim() === '' ? null : Number(limits[k])])),
        features,
      };
      return plan
        ? platformApi.put(`/plans/${plan.id}`, body)
        : platformApi.post('/plans', { ...body, code });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform'] });
      onClose();
    },
    onError: (e) => setError(errorOf(e)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" dir="rtl">
      <form
        onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}
        className="bg-najd-paper rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto p-6 flex flex-col gap-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-najd-ink">{plan ? `تعديل باقة «${plan.nameAr}»` : 'باقة جديدة'}</h2>
          <button type="button" onClick={onClose} className="text-najd-muted hover:text-najd-ink"><X size={20} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-medium text-najd-ink/80 flex flex-col gap-1">
            الكود
            <input value={code} onChange={(e) => setCode(e.target.value)} disabled={!!plan} dir="ltr" className={`${input} disabled:bg-najd-sand`} placeholder="pro-plus" />
          </label>
          <label className="text-sm font-medium text-najd-ink/80 flex flex-col gap-1">
            الاسم
            <input value={nameAr} onChange={(e) => setNameAr(e.target.value)} required className={input} />
          </label>
          <label className="text-sm font-medium text-najd-ink/80 flex flex-col gap-1">
            السعر الشهري (ر.س)
            <input type="number" min={0} value={priceMonthly} onChange={(e) => setPriceMonthly(e.target.value)} className={input} />
          </label>
          <label className="text-sm font-medium text-najd-ink/80 flex flex-col gap-1">
            السعر السنوي (ر.س)
            <input type="number" min={0} value={priceYearly} onChange={(e) => setPriceYearly(e.target.value)} className={input} />
          </label>
          <label className="text-sm font-medium text-najd-ink/80 flex flex-col gap-1">
            أيام التجربة
            <input type="number" min={0} max={90} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} className={input} />
          </label>
          <label className="text-sm font-medium text-najd-ink/80 flex flex-col gap-1">
            الترتيب
            <input type="number" min={0} value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className={input} />
          </label>
        </div>

        <fieldset className="border border-najd-line rounded-lg p-3">
          <legend className="text-sm font-semibold text-najd-ink/80 px-1">الحدود (اتركه فارغًا = بلا حد)</legend>
          <div className="grid grid-cols-2 gap-3">
            {limitKeys.map((k) => (
              <label key={k} className="text-sm text-najd-ink/80 flex flex-col gap-1">
                {LIMIT_LABELS[k]}
                <input type="number" min={0} value={limits[k]} onChange={(e) => setLimits({ ...limits, [k]: e.target.value })} placeholder="بلا حد" className={input} />
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="border border-najd-line rounded-lg p-3">
          <legend className="text-sm font-semibold text-najd-ink/80 px-1">المزايا</legend>
          <div className="flex flex-col gap-2">
            {featureKeys.map((k) => (
              <label key={k} className="flex items-center gap-2 text-sm text-najd-ink/80">
                <input type="checkbox" checked={features[k]} onChange={(e) => setFeatures({ ...features, [k]: e.target.checked })} />
                {FEATURE_LABELS[k]}
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-najd-ink/80">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          الباقة متاحة للاشتراك
        </label>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-najd-muted hover:bg-najd-sand rounded-lg">إلغاء</button>
          <button type="submit" disabled={save.isPending} className="px-4 py-2 text-sm font-semibold bg-najd-green hover:bg-najd-green-dark text-white rounded-lg disabled:opacity-60 flex items-center gap-2">
            {save.isPending && <Loader2 size={14} className="animate-spin" />} حفظ
          </button>
        </div>
      </form>
    </div>
  );
}

// ── company panel ─────────────────────────────────────────────────────────────

function SubscriptionCard({ tenant, plans }: { tenant: PlatformTenantDetail; plans: PlatformPlan[] }) {
  const qc = useQueryClient();
  const sub = tenant.subscription;
  const [mode, setMode] = useState<null | 'activate' | 'trial' | 'plan' | 'overrides'>(null);
  const [error, setError] = useState<string | null>(null);

  const activePlans = plans.filter((p) => p.isActive);
  const [planId, setPlanId] = useState<number>(sub?.planId ?? activePlans[0]?.id ?? 0);
  const [months, setMonths] = useState('1');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [days, setDays] = useState('7');

  const limitKeys = Object.keys(LIMIT_LABELS) as LimitKey[];
  const featureKeys = Object.keys(FEATURE_LABELS) as FeatureKey[];
  const [limitDraft, setLimitDraft] = useState<Record<LimitKey, string>>(
    () => Object.fromEntries(limitKeys.map((k) => {
      const o = sub?.limitOverrides;
      return [k, o && k in o ? (o[k] === null ? 'inf' : String(o[k])) : ''];
    })) as Record<LimitKey, string>,
  );
  const [featureDraft, setFeatureDraft] = useState<Record<FeatureKey, '' | 'on' | 'off'>>(
    () => Object.fromEntries(featureKeys.map((k) => {
      const o = sub?.featureOverrides;
      return [k, o && k in o ? (o[k] ? 'on' : 'off') : ''];
    })) as Record<FeatureKey, '' | 'on' | 'off'>,
  );

  const done = () => {
    setMode(null);
    setError(null);
    qc.invalidateQueries({ queryKey: ['platform'] });
  };
  const run = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: done,
    onError: (e) => setError(errorOf(e)),
  });
  const base = `/tenants/${tenant.id}/subscription`;

  const selectedPlan = plans.find((p) => p.id === planId);
  const expected = selectedPlan ? Number(selectedPlan.priceMonthly) * Number(months || 0) : 0;

  const saveOverrides = () => {
    const limitOverrides: Record<string, number | null> = {};
    for (const k of limitKeys) {
      const v = limitDraft[k].trim();
      if (v === '') continue;
      limitOverrides[k] = v === 'inf' ? null : Number(v);
    }
    const featureOverrides: Record<string, boolean> = {};
    for (const k of featureKeys) if (featureDraft[k]) featureOverrides[k] = featureDraft[k] === 'on';
    run.mutate(() =>
      platformApi.put(`${base}/overrides`, {
        limitOverrides: Object.keys(limitOverrides).length ? limitOverrides : null,
        featureOverrides: Object.keys(featureOverrides).length ? featureOverrides : null,
      }),
    );
  };

  if (!sub) {
    return <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-lg p-3 mb-6">لا يوجد اشتراك لهذه الشركة.</div>;
  }

  const btn = 'text-xs font-semibold px-3 py-1.5 rounded-lg border border-najd-line hover:bg-najd-sand/70 text-najd-ink/80';

  return (
    <div className="border border-najd-line rounded-xl p-4 mb-6">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-najd-ink/80">الاشتراك</h3>
        <StatusBadge status={sub.status} />
        <span className="text-sm font-medium text-najd-ink">{sub.planName}</span>
        <span className="mr-auto text-xs text-najd-muted">
          {sub.status === 'TRIALING'
            ? `تنتهي التجربة ${fmtDate(sub.trialEndsAt)}`
            : sub.currentPeriodEnd
              ? `الفترة حتى ${fmtDate(sub.currentPeriodEnd)}`
              : 'بلا تاريخ انتهاء'}
          {sub.daysLeft !== null && ` (${sub.daysLeft} يوم)`}
        </span>
      </div>
      {sub.notes && <p className="text-xs text-najd-muted mt-2">ملاحظات: {sub.notes}</p>}

      <div className="flex flex-wrap gap-2 mt-3">
        <button className={btn} onClick={() => setMode(mode === 'activate' ? null : 'activate')}>تفعيل / تجديد</button>
        <button className={btn} onClick={() => setMode(mode === 'trial' ? null : 'trial')}>تمديد التجربة</button>
        <button className={btn} onClick={() => setMode(mode === 'plan' ? null : 'plan')}>تغيير الباقة</button>
        <button className={btn} onClick={() => setMode(mode === 'overrides' ? null : 'overrides')}>حدود ومزايا مخصصة</button>
        {sub.status !== 'CANCELED' && (
          <button
            className={`${btn} text-red-700 border-red-200 hover:bg-red-50`}
            onClick={() => window.confirm('إلغاء الاشتراك؟ ستتحول الشركة لوضع القراءة فقط.') && run.mutate(() => platformApi.post(`${base}/cancel`))}
          >
            إلغاء الاشتراك
          </button>
        )}
      </div>

      {mode === 'activate' && (
        <div className="mt-3 bg-najd-sand/60 rounded-lg p-3 grid grid-cols-2 gap-3">
          <label className="text-xs text-najd-muted flex flex-col gap-1">الباقة
            <select value={planId} onChange={(e) => setPlanId(Number(e.target.value))} className={input}>
              {activePlans.map((p) => <option key={p.id} value={p.id}>{p.nameAr} — {fmtMoney(p.priceMonthly)} ر.س/شهر</option>)}
            </select>
          </label>
          <label className="text-xs text-najd-muted flex flex-col gap-1">عدد الأشهر
            <input type="number" min={1} max={36} value={months} onChange={(e) => setMonths(e.target.value)} className={input} />
          </label>
          <label className="text-xs text-najd-muted flex flex-col gap-1">المبلغ المحصَّل (ر.س)
            <input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={String(expected)} className={input} />
          </label>
          <label className="text-xs text-najd-muted flex flex-col gap-1">طريقة الدفع
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={input}>
              {Object.entries(METHOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="text-xs text-najd-muted flex flex-col gap-1 col-span-2">مرجع العملية (اختياري)
            <input value={reference} onChange={(e) => setReference(e.target.value)} className={input} />
          </label>
          <button
            disabled={run.isPending}
            onClick={() => run.mutate(() => platformApi.post(`${base}/activate`, {
              planId, months: Number(months), method,
              ...(amount.trim() !== '' ? { amount: Number(amount) } : {}),
              ...(reference.trim() ? { reference: reference.trim() } : {}),
            }))}
            className="col-span-2 bg-najd-green hover:bg-najd-green-dark text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-60"
          >
            تأكيد التفعيل وتسجيل الدفعة
          </button>
        </div>
      )}

      {mode === 'trial' && (
        <div className="mt-3 bg-najd-sand/60 rounded-lg p-3 flex items-end gap-3">
          <label className="text-xs text-najd-muted flex flex-col gap-1 flex-1">عدد الأيام المضافة
            <input type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} className={input} />
          </label>
          <button
            disabled={run.isPending}
            onClick={() => run.mutate(() => platformApi.post(`${base}/extend-trial`, { days: Number(days) }))}
            className="bg-najd-green hover:bg-najd-green-dark text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
          >
            تمديد
          </button>
        </div>
      )}

      {mode === 'plan' && (
        <div className="mt-3 bg-najd-sand/60 rounded-lg p-3 flex items-end gap-3">
          <label className="text-xs text-najd-muted flex flex-col gap-1 flex-1">الباقة الجديدة (دون تغيير الفترة)
            <select value={planId} onChange={(e) => setPlanId(Number(e.target.value))} className={input}>
              {activePlans.map((p) => <option key={p.id} value={p.id}>{p.nameAr}</option>)}
            </select>
          </label>
          <button
            disabled={run.isPending}
            onClick={() => run.mutate(() => platformApi.post(`${base}/change-plan`, { planId }))}
            className="bg-najd-green hover:bg-najd-green-dark text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-60"
          >
            تغيير
          </button>
        </div>
      )}

      {mode === 'overrides' && (
        <div className="mt-3 bg-najd-sand/60 rounded-lg p-3 flex flex-col gap-3">
          <p className="text-xs text-najd-muted">القيمة الفارغة = حسب الباقة. اكتب <b>inf</b> لإلغاء الحد لهذه الشركة.</p>
          <div className="grid grid-cols-2 gap-3">
            {limitKeys.map((k) => (
              <label key={k} className="text-xs text-najd-muted flex flex-col gap-1">{LIMIT_LABELS[k]}
                <input value={limitDraft[k]} onChange={(e) => setLimitDraft({ ...limitDraft, [k]: e.target.value })} placeholder="حسب الباقة" className={input} />
              </label>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2">
            {featureKeys.map((k) => (
              <label key={k} className="text-xs text-najd-muted flex items-center gap-2">
                <span className="flex-1">{FEATURE_LABELS[k]}</span>
                <select value={featureDraft[k]} onChange={(e) => setFeatureDraft({ ...featureDraft, [k]: e.target.value as '' | 'on' | 'off' })} className="border border-najd-line rounded-lg px-2 py-1 text-sm">
                  <option value="">حسب الباقة</option>
                  <option value="on">مفعّلة</option>
                  <option value="off">معطّلة</option>
                </select>
              </label>
            ))}
          </div>
          <button onClick={saveOverrides} disabled={run.isPending} className="bg-najd-green hover:bg-najd-green-dark text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-60">
            حفظ
          </button>
        </div>
      )}

      {error && <div className="mt-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}

      {tenant.payments.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-najd-muted mb-1">آخر الدفعات</p>
          <ul className="divide-y divide-najd-line/70 border border-najd-line rounded-lg">
            {tenant.payments.slice(0, 5).map((p: PlatformPayment) => (
              <li key={p.id} className="px-3 py-2 text-xs flex items-center gap-2">
                <span className="font-semibold text-najd-ink">{fmtMoney(p.amount)} {p.currency}</span>
                <span className="text-najd-muted">{p.months} شهر · {METHOD_LABELS[p.method] ?? p.method}</span>
                <span className="mr-auto text-najd-muted/70">{fmtDate(p.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

interface ConfirmState {
  title: string;
  body: string;
  confirmLabel: string;
  danger?: boolean;
  onOk: () => void;
}

function ConfirmDialog({ state, onClose }: { state: ConfirmState; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50" dir="rtl">
      <div className="bg-najd-paper rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
        <h2 className="text-lg font-bold text-najd-ink">{state.title}</h2>
        <p className="text-sm leading-7 text-najd-muted">{state.body}</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold rounded-lg border border-najd-line text-najd-ink/80 hover:bg-najd-sand/70">
            تراجع
          </button>
          <button
            onClick={() => { state.onOk(); onClose(); }}
            className={`px-4 py-2 text-sm font-semibold rounded-lg text-white ${state.danger ? 'bg-red-600 hover:bg-red-700' : 'bg-najd-green hover:bg-najd-green-dark'}`}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function TenantPanel({ tenantId, onClose }: { tenantId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['platform', 'tenant', tenantId],
    queryFn: async () => (await platformApi.get<PlatformTenantDetail>(`/tenants/${tenantId}`)).data,
  });
  const plans = useQuery({
    queryKey: ['platform', 'plans'],
    queryFn: async () => (await platformApi.get<PlatformPlan[]>('/plans')).data,
  });

  const toggle = useMutation({
    mutationFn: async (isActive: boolean) => (await platformApi.patch(`/tenants/${tenantId}`, { isActive })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform'] }),
  });

  const reset = useMutation({
    mutationFn: async (userId: number) =>
      (await platformApi.post<{ email: string; temporaryPassword: string }>(
        `/tenants/${tenantId}/users/${userId}/reset-password`,
      )).data,
    onSuccess: (r) => {
      setTemp({ email: r.email, password: r.temporaryPassword });
      qc.invalidateQueries({ queryKey: ['platform', 'audit'] });
    },
  });

  // one mutation for every per-user support action
  const userAction = useMutation({
    mutationFn: async (a: { userId: number; action: string; body?: object; okText: string }) => {
      const r = await platformApi.post(`/tenants/${tenantId}/users/${a.userId}/${a.action}`, a.body ?? {});
      return { ...(r.data as object), okText: a.okText };
    },
    onSuccess: (r) => {
      setNotice({ ok: true, text: (r as { okText: string }).okText });
      qc.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: (e) => setNotice({ ok: false, text: errorOf(e) }),
  });

  const saveNote = useMutation({
    mutationFn: async (text: string) => (await platformApi.patch(`/tenants/${tenantId}`, { platformNote: text.trim() || null })).data,
    onSuccess: () => {
      setNote(null);
      setNotice({ ok: true, text: 'تم حفظ الملاحظة' });
      qc.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: (e) => setNotice({ ok: false, text: errorOf(e) }),
  });

  const confirmToggle = () => {
    if (!data) return;
    setConfirm({
      title: data.isActive ? 'إيقاف الشركة؟' : 'إعادة تفعيل الشركة؟',
      body: data.isActive
        ? `سيُمنع كل مستخدمي «${data.name}» من الدخول فورًا، وتبقى بياناتها محفوظة.`
        : `سيتمكّن مستخدمو «${data.name}» من الدخول مجددًا.`,
      confirmLabel: data.isActive ? 'إيقاف الشركة' : 'تفعيل الشركة',
      danger: data.isActive,
      onOk: () => toggle.mutate(!data.isActive),
    });
  };

  const copyTemp = async () => {
    if (!temp) return;
    try {
      await navigator.clipboard.writeText(temp.password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable: the value stays selectable */ }
  };

  return (
    <div className="fixed inset-0 z-40 flex" dir="rtl">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="w-full max-w-lg bg-najd-paper h-full overflow-y-auto shadow-2xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-najd-ink">{data?.name ?? '…'}</h2>
            <p className="text-xs text-najd-muted mt-0.5" dir="ltr">{data?.slug}</p>
          </div>
          <button onClick={onClose} className="p-1 text-najd-muted hover:text-najd-ink"><X size={20} /></button>
        </div>

        {isLoading || !data ? (
          <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-najd-muted/70" /></div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-5">
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${data.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {data.isActive ? 'نشطة' : 'موقوفة'}
              </span>
              <span className="text-xs text-najd-muted">منذ {fmtDate(data.createdAt)}</span>
              <button
                onClick={confirmToggle}
                disabled={toggle.isPending || platformRole() !== 'OWNER'}
                className={`mr-auto flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60 ${data.isActive ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}
              >
                {data.isActive ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                {data.isActive ? 'إيقاف الشركة' : 'تفعيل الشركة'}
              </button>
            </div>

            <p className="text-xs text-najd-muted -mt-3 mb-5">
              {data.termsAcceptedAt
                ? 'وافقت على الشروط (نسخة ' + data.termsVersion + ') بتاريخ ' + fmtDate(data.termsAcceptedAt) + ' — ' + (data.termsAcceptedBy ?? '')
                : 'لم توافق على الشروط وسياسة الخصوصية بعد'}
            </p>

            <SubscriptionCard key={`${data.id}-${data.subscription?.planId}-${data.subscription?.status}`} tenant={data} plans={plans.data ?? []} />

            <div className="grid grid-cols-2 gap-3 mb-6">
              <StatCard label="المستخدمون" value={data.usage.users} />
              <StatCard label="الأصناف" value={data.usage.products} />
              <StatCard label="العملاء" value={data.usage.customers} />
              <StatCard label="فواتير البيع" value={data.usage.salesInvoices} hint={`${data.usage.invoicesLast30Days} في آخر 30 يومًا`} />
              <StatCard label="مبيعات 30 يومًا" value={fmtMoney(data.usage.salesLast30Days)} />
              <StatCard label="آخر نشاط" value={fmtDate(data.usage.lastActivityAt)} />
            </div>

            <h3 className="text-sm font-semibold text-najd-ink/80 mb-2 flex items-center gap-2"><Users size={16} /> المستخدمون</h3>
            <ul className="divide-y divide-najd-line/70 border border-najd-line rounded-lg">
              {data.users.map((u) => {
                const ask = (c: Omit<ConfirmState, 'onOk'> & { run: () => void }) =>
                  setConfirm({ title: c.title, body: c.body, confirmLabel: c.confirmLabel, danger: c.danger, onOk: c.run });
                const btn = 'p-1.5 text-najd-muted disabled:opacity-50';
                return (
                  <li key={u.id} className={`p-3 flex flex-col gap-2 ${u.isActive ? '' : 'bg-najd-sand/60'}`}>
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-medium truncate ${u.isActive ? 'text-najd-ink' : 'text-najd-muted/70 line-through'}`}>{u.name}</p>
                        <p className="text-xs text-najd-muted truncate" dir="ltr">{u.email}</p>
                      </div>
                      <span className="text-xs bg-najd-sand text-najd-muted px-2 py-0.5 rounded">{u.role.nameAr}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap text-xs">
                      {u.emailVerifiedAt ? (
                        <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded-full">البريد مؤكَّد</span>
                      ) : (
                        <span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">البريد غير مؤكَّد</span>
                      )}
                      {!u.isActive && <span className="bg-red-50 text-red-700 px-2 py-0.5 rounded-full">معطّل</span>}
                      <span className="text-najd-muted/70">آخر دخول: {fmtDate(u.lastLoginAt)}</span>
                      <span className="mr-auto flex items-center">
                        <button
                          title="إعادة تعيين كلمة المرور"
                          disabled={reset.isPending}
                          onClick={() => ask({
                            title: 'إعادة تعيين كلمة المرور',
                            body: `ستُنشأ كلمة مرور مؤقتة جديدة لـ ${u.email} وتنتهي جلساته الحالية.`,
                            confirmLabel: 'إنشاء كلمة مرور مؤقتة',
                            run: () => reset.mutate(u.id),
                          })}
                          className={`${btn} hover:text-najd-green`}
                        >
                          <KeyRound size={16} />
                        </button>
                        <button
                          title="إنهاء كل جلساته"
                          disabled={userAction.isPending}
                          onClick={() => ask({
                            title: 'إنهاء الجلسات',
                            body: `سيُسجَّل خروج ${u.email} من كل الأجهزة فورًا.`,
                            confirmLabel: 'إنهاء الجلسات',
                            run: () => userAction.mutate({ userId: u.id, action: 'force-logout', okText: 'تم إنهاء جلسات المستخدم' }),
                          })}
                          className={`${btn} hover:text-najd-green`}
                        >
                          <LogOut size={16} />
                        </button>
                        {!u.emailVerifiedAt && (
                          <>
                            <button
                              title="إعادة إرسال رسالة التأكيد"
                              disabled={userAction.isPending}
                              onClick={() => userAction.mutate({ userId: u.id, action: 'resend-verification', okText: 'أُرسلت رسالة التأكيد' })}
                              className={`${btn} hover:text-najd-green`}
                            >
                              <Mail size={16} />
                            </button>
                            <button
                              title="اعتماد البريد يدويًا"
                              disabled={userAction.isPending}
                              onClick={() => ask({
                                title: 'اعتماد البريد يدويًا',
                                body: `سيُعتبر ${u.email} مؤكَّدًا دون الضغط على الرابط. استخدمها فقط بعد التحقق من صاحبه.`,
                                confirmLabel: 'اعتماد',
                                run: () => userAction.mutate({ userId: u.id, action: 'verify-email', okText: 'تم اعتماد البريد' }),
                              })}
                              className={`${btn} hover:text-emerald-700`}
                            >
                              <BadgeCheck size={16} />
                            </button>
                          </>
                        )}
                        <button
                          title={u.isActive ? 'تعطيل المستخدم' : 'تفعيل المستخدم'}
                          disabled={userAction.isPending}
                          onClick={() => ask({
                            title: u.isActive ? 'تعطيل المستخدم' : 'تفعيل المستخدم',
                            body: u.isActive
                              ? `لن يتمكن ${u.email} من الدخول وتنتهي جلساته الحالية.`
                              : `سيتمكن ${u.email} من الدخول مجددًا.`,
                            confirmLabel: u.isActive ? 'تعطيل' : 'تفعيل',
                            danger: u.isActive,
                            run: () => userAction.mutate({
                              userId: u.id,
                              action: 'active',
                              body: { isActive: !u.isActive },
                              okText: u.isActive ? 'تم تعطيل المستخدم' : 'تم تفعيل المستخدم',
                            }),
                          })}
                          className={`${btn} ${u.isActive ? 'hover:text-red-600' : 'hover:text-emerald-700'}`}
                        >
                          {u.isActive ? <UserX size={16} /> : <UserCheck size={16} />}
                        </button>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>

            {temp && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-amber-900">كلمة مرور مؤقتة لـ <span dir="ltr">{temp.email}</span></p>
                <p className="mt-2 font-mono text-base select-all bg-najd-paper border border-amber-200 rounded px-3 py-2" dir="ltr">{temp.password}</p>
                <p className="text-xs text-amber-800 mt-2">تُعرض مرة واحدة فقط — سلّمها للمستخدم ليغيّرها بعد الدخول.</p>
                <div className="flex items-center gap-4 mt-2">
                  <button onClick={copyTemp} className="text-xs font-semibold text-amber-900 flex items-center gap-1">
                    <Copy size={13} /> {copied ? 'تم النسخ' : 'نسخ'}
                  </button>
                  <button onClick={() => setTemp(null)} className="text-xs text-amber-900 underline">إخفاء</button>
                </div>
              </div>
            )}

            {notice && (
              <p className={`mt-3 text-sm rounded-lg px-3 py-2 border ${notice.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
                {notice.text}
              </p>
            )}

            <h3 className="text-sm font-semibold text-najd-ink/80 mt-6 mb-2">ملاحظات داخلية</h3>
            <textarea
              value={note ?? data.platformNote ?? ''}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="ملاحظات لا تظهر للشركة (اتفاقات، متابعات، سبب الإيقاف…)"
              className={input}
            />
            <button
              disabled={note === null || saveNote.isPending}
              onClick={() => saveNote.mutate(note ?? '')}
              className="mt-2 text-sm font-semibold bg-najd-green-dark hover:bg-najd-green-deep text-white px-4 py-1.5 rounded-lg disabled:opacity-40 flex items-center gap-2"
            >
              {saveNote.isPending && <Loader2 size={13} className="animate-spin" />} حفظ الملاحظة
            </button>
          </>
        )}
      </aside>
      {confirm && <ConfirmDialog state={confirm} onClose={() => setConfirm(null)} />}
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

function ChangePasswordDialog({ onClose, forced }: { onClose: () => void; forced?: boolean }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const change = useMutation({
    mutationFn: async () =>
      (await platformApi.post<{ token: string }>('/me/password', { currentPassword: current, newPassword: next })).data,
    onSuccess: (r) => {
      localStorage.setItem(PLATFORM_TOKEN_KEY, r.token); // the other sessions were ended; keep this one
      try {
        const a = JSON.parse(localStorage.getItem(PLATFORM_ADMIN_KEY) ?? 'null') as Record<string, unknown> | null;
        if (a) localStorage.setItem(PLATFORM_ADMIN_KEY, JSON.stringify({ ...a, mustChangePassword: false }));
      } catch { /* ignore */ }
      setDone(true);
    },
    onError: (e) => setError(errorOf(e)),
  });

  const mismatch = confirm.length > 0 && next !== confirm;
  const valid = current && next.length >= 12 && next === confirm;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" dir="rtl">
      <div className="bg-najd-paper rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-najd-ink">{forced ? 'اختر كلمة مرور جديدة' : 'تغيير كلمة المرور'}</h2>
          {!forced && <button onClick={onClose} className="text-najd-muted hover:text-najd-ink"><X size={20} /></button>}
        </div>
        {done ? (
          <>
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
              تم تغيير كلمة المرور. أُنهيت جلساتك الأخرى على أي جهاز.
            </p>
            <button onClick={onClose} className="bg-najd-green hover:bg-najd-green-dark text-white text-sm font-semibold py-2 rounded-lg">تم</button>
          </>
        ) : (
          <>
            <label className="text-sm font-medium text-najd-ink/80 flex flex-col gap-1">
              كلمة المرور الحالية
              <input type="password" dir="ltr" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={input} />
            </label>
            <label className="text-sm font-medium text-najd-ink/80 flex flex-col gap-1">
              كلمة المرور الجديدة (12 حرفًا على الأقل، حروف وأرقام)
              <input type="password" dir="ltr" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={input} />
            </label>
            <label className="text-sm font-medium text-najd-ink/80 flex flex-col gap-1">
              تأكيد كلمة المرور الجديدة
              <input type="password" dir="ltr" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={input} />
              {mismatch && <span className="text-xs text-red-600">غير متطابقتين</span>}
            </label>
            {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
            <button
              disabled={!valid || change.isPending}
              onClick={() => { setError(null); change.mutate(); }}
              className="bg-najd-green hover:bg-najd-green-dark text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {change.isPending && <Loader2 size={14} className="animate-spin" />} حفظ
            </button>
          </>
        )}
      </div>
    </div>
  );
}

type Tab = 'overview' | 'tenants' | 'requests' | 'plans' | 'payments' | 'announcements' | 'system' | 'admins' | 'analytics' | 'audit';

export function PlatformDashboardPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState<number | null>(null);
  const { section } = useParams();
  const SECTIONS: Tab[] = ['overview', 'tenants', 'requests', 'plans', 'payments', 'analytics', 'announcements', 'system', 'admins', 'audit'];
  const tab: Tab = SECTIONS.includes(section as Tab) ? (section as Tab) : 'overview';
  const [editingPlan, setEditingPlan] = useState<PlatformPlan | 'new' | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [mustChange, setMustChange] = useState(() => {
    try {
      return (JSON.parse(localStorage.getItem(PLATFORM_ADMIN_KEY) ?? 'null') as { mustChangePassword?: boolean } | null)?.mustChangePassword === true;
    } catch {
      return false;
    }
  });
  const hasToken = !!localStorage.getItem(PLATFORM_TOKEN_KEY);
  const admin = (() => {
    try { return JSON.parse(localStorage.getItem(PLATFORM_ADMIN_KEY) ?? 'null') as { name: string } | null; } catch { return null; }
  })();

  const stats = useQuery({
    queryKey: ['platform', 'stats'],
    enabled: hasToken,
    queryFn: async () => (await platformApi.get<PlatformStats>('/stats')).data,
  });
  const tenants = useQuery({
    queryKey: ['platform', 'tenants', search],
    enabled: hasToken,
    queryFn: async () => (await platformApi.get<PlatformTenant[]>('/tenants', { params: { search } })).data,
  });
  const plans = useQuery({
    queryKey: ['platform', 'plans'],
    enabled: hasToken && tab === 'plans',
    queryFn: async () => (await platformApi.get<PlatformPlan[]>('/plans')).data,
  });
  const requests = useQuery({
    queryKey: ['platform', 'requests'],
    enabled: hasToken && tab === 'requests',
    queryFn: async () => (await platformApi.get<PlatformUpgradeRequest[]>('/upgrade-requests')).data,
  });
  const qc = useQueryClient();
  const [lifecycleMsg, setLifecycleMsg] = useState<string | null>(null);
  const lifecycle = useMutation({
    mutationFn: async () =>
      (await platformApi.post<{ trialsExpired: number; movedToPastDue: number; expired: number; reminders: number; errors: string[] }>('/lifecycle/run')).data,
    onSuccess: (r) => {
      setLifecycleMsg(
        r.errors.length
          ? `أخطاء: ${r.errors.join(' | ')}`
          : `تجارب انتهت ${r.trialsExpired} · دخلت السماح ${r.movedToPastDue} · انتهت ${r.expired} · تذكيرات ${r.reminders}`,
      );
      qc.invalidateQueries({ queryKey: ['platform'] });
    },
    onError: () => setLifecycleMsg('تعذّر تشغيل الفحص'),
  });
  const handle = useMutation({
    mutationFn: async (id: number) => platformApi.post(`/upgrade-requests/${id}/handle`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform'] }),
  });
  const payments = useQuery({
    queryKey: ['platform', 'payments'],
    enabled: hasToken && tab === 'payments',
    queryFn: async () => (await platformApi.get<PlatformPayment[]>('/payments')).data,
  });
  const orders = useQuery({
    queryKey: ['platform', 'payment-orders'],
    enabled: hasToken && tab === 'payments',
    queryFn: async () => (await platformApi.get<PlatformPaymentOrder[]>('/payment-orders')).data,
  });
  const recheck = useMutation({
    mutationFn: async (id: number) => platformApi.post('/payment-orders/' + id + '/settle'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform'] }),
  });
  const audit = useQuery({
    queryKey: ['platform', 'audit'],
    enabled: hasToken && tab === 'audit',
    queryFn: async () => (await platformApi.get<PlatformAuditRow[]>('/audit-log')).data,
  });

  if (!hasToken) return <Navigate to="/platform/login" replace />;

  const logout = () => {
    localStorage.removeItem(PLATFORM_TOKEN_KEY);
    localStorage.removeItem(PLATFORM_ADMIN_KEY);
    navigate('/platform/login', { replace: true });
  };

  const s = stats.data;
  const isOwner = platformRole() === 'OWNER';

  const shownTenants = (tenants.data ?? []).filter((t) => {
    switch (statusFilter) {
      case 'active': return t.isActive;
      case 'suspended': return !t.isActive;
      case 'TRIALING':
      case 'ACTIVE':
      case 'PAST_DUE':
      case 'EXPIRED':
      case 'CANCELED': return t.subscription?.status === statusFilter;
      default: return true;
    }
  });

  const exportCsv = () => {
    const cell = (v: string | number | null | undefined) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const rows = [
      ['الشركة', 'المعرّف', 'الباقة', 'حالة الاشتراك', 'الحساب', 'المستخدمون', 'الأصناف', 'العملاء', 'فواتير 30 يوم', 'مبيعات 30 يوم', 'آخر نشاط', 'تاريخ التسجيل'],
      ...shownTenants.map((t) => [
        t.name, t.slug, t.subscription?.planName ?? '', t.subscription ? STATUS_LABELS[t.subscription.status] : '',
        t.isActive ? 'نشطة' : 'موقوفة', t.usage.users, t.usage.products, t.usage.customers,
        t.usage.invoicesLast30Days, t.usage.salesLast30Days, t.usage.lastActivityAt?.slice(0, 10) ?? '', t.createdAt.slice(0, 10),
      ]),
    ];
    const csv = '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `companies-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const badges: Partial<Record<SectionId, number>> = { requests: s?.pendingUpgradeRequests ?? 0 };
  const Loading = ({ cols }: { cols: number }) => (
    <tr><td colSpan={cols} className="py-10 text-center text-najd-muted/70"><Loader2 className="inline animate-spin" /></td></tr>
  );
  const th = (h: string) => <th key={h} className="text-right font-medium px-4 py-2.5">{h}</th>;

  return (
    <>
      <PlatformShell
        section={tab as SectionId}
        isOwner={isOwner}
        badges={badges}
        adminName={admin?.name ?? ''}
        roleLabel={ROLE_LABEL[platformRole()]}
        onChangePassword={() => setChangingPassword(true)}
        onLogout={logout}
      >
        {tab === 'overview' && (
          <>
        <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard label="الإيراد الشهري المتكرر (ر.س)" value={s ? fmtMoney(s.revenue.mrr) : '—'} hint={`${s?.revenue.payingTenants ?? 0} مشترك مدفوع`} />
          <StatCard label="المحصَّل — آخر 30 يومًا (ر.س)" value={s ? fmtMoney(s.revenue.paidLast30Days) : '—'} />
          <StatCard label="شركات في التجربة" value={s?.revenue.trialingTenants ?? '—'} />
          <StatCard label="إجمالي الشركات" value={s?.tenants.total ?? '—'} hint={`${s?.tenants.suspended ?? 0} موقوفة · ${s?.tenants.newLast7Days ?? 0} جديدة (7 أيام)`} />
          <StatCard label="مديرون لم يؤكدوا بريدهم" value={s?.unverifiedAdmins ?? '—'} hint="افتح الشركة لإعادة الإرسال أو الاعتماد" />
        </section>

        {s && s.revenue.attention.length > 0 && (
          <section className="bg-amber-50 border border-amber-200 rounded-xl p-4">
            <p className="text-sm font-semibold text-amber-900 flex items-center gap-2 mb-2">
              <AlertTriangle size={16} /> تحتاج متابعة ({s.revenue.attention.length})
            </p>
            <ul className="flex flex-col gap-1">
              {s.revenue.attention.slice(0, 6).map((a) => (
                <li key={a.tenantId}>
                  <button onClick={() => setSelected(a.tenantId)} className="w-full text-right text-sm flex items-center gap-2 hover:bg-amber-100 rounded px-2 py-1">
                    <span className="font-medium text-najd-ink">{a.name}</span>
                    <StatusBadge status={a.status} />
                    <span className="text-najd-muted">{a.planName}</span>
                    <span className="mr-auto text-xs text-najd-muted">
                      {a.daysLeft !== null && a.daysLeft < 0 ? `منتهٍ منذ ${-a.daysLeft} يوم` : a.daysLeft !== null ? `باقي ${a.daysLeft} يوم` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex items-center gap-3 flex-wrap text-sm">
          <button
            onClick={() => { setLifecycleMsg(null); lifecycle.mutate(); }}
            disabled={lifecycle.isPending || !isOwner}
            className="font-semibold border border-najd-line bg-najd-paper hover:bg-najd-sand/70 text-najd-ink/80 px-3 py-1.5 rounded-lg disabled:opacity-60 flex items-center gap-2"
          >
            {lifecycle.isPending && <Loader2 size={14} className="animate-spin" />}
            تشغيل فحص الاشتراكات الآن
          </button>
          {lifecycleMsg && <span className="text-najd-muted">{lifecycleMsg}</span>}
          <span className="text-xs text-najd-muted/70 mr-auto">يعمل تلقائيًا كل ساعة</span>
        </div>

        {s && <SignupsChart data={s.signupsByDay} />}
          </>
        )}

        {tab !== 'overview' && (

        <section className="bg-najd-paper rounded-xl border border-najd-line">
          <div className="flex items-center gap-2 p-3 border-b border-najd-line flex-wrap">
            {tab === 'tenants' && (
              <div className="mr-auto flex items-center gap-2">
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="border border-najd-line rounded-lg px-2 py-1.5 text-sm bg-najd-paper"
                >
                  <option value="all">كل الشركات</option>
                  <option value="active">حساب نشط</option>
                  <option value="suspended">موقوفة</option>
                  <option value="TRIALING">في التجربة</option>
                  <option value="ACTIVE">مشتركة</option>
                  <option value="PAST_DUE">فترة سماح</option>
                  <option value="EXPIRED">منتهية</option>
                  <option value="CANCELED">ملغاة</option>
                </select>
                <button
                  onClick={exportCsv}
                  disabled={shownTenants.length === 0}
                  className="flex items-center gap-1.5 text-sm font-semibold border border-najd-line bg-najd-paper hover:bg-najd-sand/70 text-najd-ink/80 px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  <Download size={15} /> تصدير CSV
                </button>
              </div>
            )}
            {tab === 'tenants' && (
              <div className="relative">
                <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-najd-muted/70" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث بالاسم…"
                  className="border border-najd-line rounded-lg pr-9 pl-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-najd-gold/40"
                />
              </div>
            )}
            {tab === 'plans' && isOwner && (
              <button onClick={() => setEditingPlan('new')} className="mr-auto flex items-center gap-1.5 text-sm font-semibold bg-najd-green hover:bg-najd-green-dark text-white px-3 py-1.5 rounded-lg">
                <Plus size={16} /> باقة جديدة
              </button>
            )}
          </div>

          {tab === 'tenants' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-najd-sand/60 text-najd-muted text-xs">
                  <tr>{['الشركة', 'الباقة', 'الاشتراك', 'المستخدمون', 'الأصناف', 'مبيعات 30 يومًا', 'آخر نشاط', 'الحساب'].map(th)}</tr>
                </thead>
                <tbody className="divide-y divide-najd-line/70">
                  {tenants.isLoading && <Loading cols={8} />}
                  {shownTenants.map((t) => (
                    <tr key={t.id} onClick={() => setSelected(t.id)} className="hover:bg-najd-sand/70 cursor-pointer">
                      <td className="px-4 py-3 font-medium text-najd-ink">{t.name}</td>
                      <td className="px-4 py-3 text-najd-muted">{t.subscription?.planName ?? '—'}</td>
                      <td className="px-4 py-3"><StatusBadge status={t.subscription?.status} /></td>
                      <td className="px-4 py-3">{t.usage.users}</td>
                      <td className="px-4 py-3">{t.usage.products}</td>
                      <td className="px-4 py-3">{fmtMoney(t.usage.salesLast30Days)}</td>
                      <td className="px-4 py-3 text-najd-muted">{fmtDate(t.usage.lastActivityAt)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${t.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                          {t.isActive ? 'نشطة' : 'موقوفة'}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {tenants.data && shownTenants.length === 0 && (
                    <tr><td colSpan={8} className="py-10 text-center text-najd-muted/70">لا توجد شركات مطابقة</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'requests' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-najd-sand/60 text-najd-muted text-xs">
                  <tr>{['التاريخ', 'الشركة', 'الباقة المطلوبة', 'مقدّم الطلب', 'ملاحظة', 'الحالة', ''].map((h, i) => (h ? th(h) : <th key={i} />))}</tr>
                </thead>
                <tbody className="divide-y divide-najd-line/70">
                  {requests.isLoading && <Loading cols={7} />}
                  {requests.data?.map((r) => (
                    <tr key={r.id}>
                      <td className="px-4 py-3 text-najd-muted">{fmtDate(r.createdAt)}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => setSelected(r.tenantId)} className="font-medium text-najd-green hover:underline">{r.tenantName}</button>
                      </td>
                      <td className="px-4 py-3 font-medium text-najd-ink">{r.planName}</td>
                      <td className="px-4 py-3 text-najd-muted">{r.requestedByName ?? '—'}<span className="block text-xs text-najd-muted/70" dir="ltr">{r.requestedByEmail}</span></td>
                      <td className="px-4 py-3 text-najd-muted max-w-xs">{r.message ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.status === 'PENDING' ? 'bg-amber-50 text-amber-700' : 'bg-najd-sand text-najd-muted'}`}>
                          {r.status === 'PENDING' ? 'قيد المراجعة' : 'تمت المعالجة'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {r.status === 'PENDING' && (
                          <button disabled={handle.isPending} onClick={() => handle.mutate(r.id)} className="text-xs font-semibold text-najd-green hover:underline disabled:opacity-50">
                            تمت المعالجة
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {requests.data?.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-najd-muted/70">لا توجد طلبات ترقية</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'plans' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-najd-sand/60 text-najd-muted text-xs">
                  <tr>{['الباقة', 'شهري', 'سنوي', 'تجربة', 'المستخدمون', 'الأصناف', 'فواتير/شهر', 'ZATCA', 'تصنيع', 'مشتركون', ''].map((h, i) => (h ? th(h) : <th key={i} />))}</tr>
                </thead>
                <tbody className="divide-y divide-najd-line/70">
                  {plans.isLoading && <Loading cols={11} />}
                  {plans.data?.map((p) => (
                    <tr key={p.id} className={p.isActive ? '' : 'opacity-50'}>
                      <td className="px-4 py-3 font-medium text-najd-ink">{p.nameAr} <span className="text-xs text-najd-muted/70" dir="ltr">{p.code}</span></td>
                      <td className="px-4 py-3">{fmtMoney(p.priceMonthly)}</td>
                      <td className="px-4 py-3">{fmtMoney(p.priceYearly)}</td>
                      <td className="px-4 py-3">{p.trialDays ? `${p.trialDays} يوم` : '—'}</td>
                      <td className="px-4 py-3">{p.limits.users ?? '∞'}</td>
                      <td className="px-4 py-3">{p.limits.products ?? '∞'}</td>
                      <td className="px-4 py-3">{p.limits.salesInvoicesPerMonth ?? '∞'}</td>
                      <td className="px-4 py-3">{p.features.zatca ? '✓' : '—'}</td>
                      <td className="px-4 py-3">{p.features.manufacturing ? '✓' : '—'}</td>
                      <td className="px-4 py-3">{p.subscribers}</td>
                      <td className="px-4 py-3"><button onClick={() => setEditingPlan(p)} className="text-xs font-semibold text-najd-green hover:underline">تعديل</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'payments' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-najd-sand/60 text-najd-muted text-xs">
                  <tr>{['التاريخ', 'الشركة', 'المبلغ', 'المدة', 'الطريقة', 'المرجع', 'سجّلها'].map(th)}</tr>
                </thead>
                <tbody className="divide-y divide-najd-line/70">
                  {payments.isLoading && <Loading cols={7} />}
                  {payments.data?.map((p) => (
                    <tr key={p.id}>
                      <td className="px-4 py-3 text-najd-muted">{fmtDate(p.createdAt)}</td>
                      <td className="px-4 py-3 font-medium text-najd-ink">{p.tenantName}</td>
                      <td className="px-4 py-3">{fmtMoney(p.amount)} {p.currency}</td>
                      <td className="px-4 py-3">{p.months} شهر</td>
                      <td className="px-4 py-3">{METHOD_LABELS[p.method] ?? p.method}</td>
                      <td className="px-4 py-3 text-najd-muted" dir="ltr">{p.reference ?? '—'}</td>
                      <td className="px-4 py-3 text-najd-muted">{p.recordedByName ?? '—'}</td>
                    </tr>
                  ))}
                  {payments.data?.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-najd-muted/70">لا توجد دفعات بعد</td></tr>}
                </tbody>
              </table>
            </div>
          )}

          {tab === 'payments' && (
            <div className="border-t border-najd-line">
              <p className="px-4 pt-4 pb-2 text-sm font-semibold text-najd-ink/80">طلبات الدفع الإلكتروني</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-najd-sand/60 text-najd-muted text-xs">
                    <tr>{['التاريخ', 'الشركة', 'الباقة', 'المبلغ', 'الحالة', 'البوابة', 'ملاحظة', ''].map((h, i) => (h ? th(h) : <th key={i} />))}</tr>
                  </thead>
                  <tbody className="divide-y divide-najd-line/70">
                    {orders.isLoading && <Loading cols={8} />}
                    {orders.data?.map((o) => (
                      <tr key={o.id}>
                        <td className="px-4 py-3 text-najd-muted">{fmtDate(o.createdAt)}</td>
                        <td className="px-4 py-3 font-medium text-najd-ink">{o.tenantName}</td>
                        <td className="px-4 py-3">{o.planName} · {o.months === 12 ? 'سنة' : 'شهر'}</td>
                        <td className="px-4 py-3">{fmtMoney(o.amount)} {o.currency}</td>
                        <td className="px-4 py-3">
                          <span className={'text-xs font-semibold px-2 py-0.5 rounded-full ' + (
                            o.status === 'PAID' ? 'bg-emerald-50 text-emerald-700'
                              : o.status === 'PENDING' ? 'bg-amber-50 text-amber-700'
                                : 'bg-red-50 text-red-700')}>
                            {o.status === 'PAID' ? 'مدفوع' : o.status === 'PENDING' ? 'قيد الانتظار' : o.status === 'EXPIRED' ? 'منتهي' : 'فشل'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-najd-muted" dir="ltr">{o.provider}</td>
                        <td className="px-4 py-3 text-najd-muted max-w-xs truncate" dir="ltr">{o.failureReason ?? ''}</td>
                        <td className="px-4 py-3">
                          {(o.status === 'PENDING' || o.failureReason?.startsWith('amount_mismatch')) && (
                            <button
                              disabled={recheck.isPending}
                              onClick={() => recheck.mutate(o.id)}
                              className="text-xs font-semibold text-najd-green hover:underline disabled:opacity-50"
                            >
                              إعادة الفحص
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {orders.data?.length === 0 && <tr><td colSpan={8} className="py-8 text-center text-najd-muted/70">لا توجد طلبات دفع إلكتروني</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'analytics' && <AnalyticsTab onOpenTenant={setSelected} />}
          {tab === 'announcements' && <AnnouncementsTab />}
          {tab === 'system' && <SystemTab />}
          {tab === 'admins' && isOwner && <AdminsTab myId={(admin as { id?: number } | null)?.id ?? null} />}

          {tab === 'audit' && (
            <ul className="divide-y divide-najd-line/70">
              {audit.isLoading && <li className="py-10 text-center text-najd-muted/70"><Loader2 className="inline animate-spin" /></li>}
              {audit.data?.map((r) => (
                <li key={r.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                  <span className="font-medium text-najd-ink">{ACTION_LABELS[r.action] ?? r.action}</span>
                  {r.detail && <span className="text-najd-muted truncate" dir="auto">{r.detail}</span>}
                  <span className="mr-auto text-xs text-najd-muted/70">
                    {r.admin?.name ?? '—'} · {new Date(r.createdAt).toLocaleString('ar-SA')}
                  </span>
                </li>
              ))}
              {audit.data?.length === 0 && <li className="py-10 text-center text-najd-muted/70">لا توجد عمليات بعد</li>}
            </ul>
          )}
        </section>
        )}
      </PlatformShell>

      {(changingPassword || mustChange) && (
        <ChangePasswordDialog
          forced={mustChange}
          onClose={() => { setChangingPassword(false); setMustChange(false); }}
        />
      )}
      {selected !== null && <TenantPanel tenantId={selected} onClose={() => setSelected(null)} />}
      {editingPlan !== null && (
        <PlanForm plan={editingPlan === 'new' ? null : editingPlan} onClose={() => setEditingPlan(null)} />
      )}
    </>
  );
}
