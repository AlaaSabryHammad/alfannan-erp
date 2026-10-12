/**
 * Platform console tab: growth and revenue analytics.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { platformApi, STATUS_LABELS, type SubscriptionStatus } from '../../lib/platformApi';

interface Analytics {
  period: { days: number; dormantDays: number };
  funnel: { registered: number; emailVerified: number; activated: number; paid: number };
  signups: Array<{ week: string; count: number }>;
  statusCounts: Record<string, number>;
  revenue: {
    mrr: number;
    payingNow: number;
    byPlan: Array<{ planName: string; priceMonthly: number; subscribers: number; trialing: number; mrr: number }>;
    monthly: Array<{ month: string; amount: number }>;
  };
  churn: {
    trialsExpired: number;
    paidLost: number;
    ratePct: number;
    recent: Array<{ tenantId: number | null; name: string; action: string; at: string }>;
  };
  dormant: Array<{
    tenantId: number;
    name: string;
    createdAt: string;
    lastActivityAt: string | null;
    daysIdle: number;
    status: SubscriptionStatus | null;
    planName: string | null;
  }>;
  topTenants: Array<{ tenantId: number; name: string; invoices30: number; sales30: number }>;
}

const money = (n: number) => n.toLocaleString('ar-SA', { maximumFractionDigits: 0 });
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

function Box({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`border border-slate-200 rounded-xl p-4 ${className}`}>
      <h3 className="font-semibold text-slate-800 mb-3">{title}</h3>
      {children}
    </section>
  );
}

function Bars({ data, format }: { data: Array<{ label: string; value: number }>; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="flex items-end gap-1.5 h-28" dir="ltr">
      {data.map((d) => (
        <div key={d.label} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0" title={`${d.label}: ${format ? format(d.value) : d.value}`}>
          <span className="text-[10px] text-slate-500">{d.value > 0 ? (format ? format(d.value) : d.value) : ''}</span>
          <div className="w-full bg-teal-600/80 rounded-t" style={{ height: `${Math.max(2, (d.value / max) * 80)}%` }} />
          <span className="text-[10px] text-slate-400 truncate w-full text-center">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

export function AnalyticsTab({ onOpenTenant }: { onOpenTenant: (id: number) => void }) {
  const [days, setDays] = useState(90);
  const { data, isLoading } = useQuery({
    queryKey: ['platform', 'analytics', days],
    queryFn: async () => (await platformApi.get<Analytics>('/analytics', { params: { days } })).data,
  });

  if (isLoading || !data) return <div className="py-10 text-center text-slate-400"><Loader2 className="inline animate-spin" /></div>;
  const f = data.funnel;
  const steps = [
    { label: 'سجّلت', value: f.registered },
    { label: 'أكّدت البريد', value: f.emailVerified },
    { label: 'بدأت الاستخدام (أصناف/عملاء/فواتير)', value: f.activated },
    { label: 'دفعت', value: f.paid },
  ];

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-slate-500">الفترة:</span>
        {[30, 90, 180].map((d) => (
          <button
            key={d}
            onClick={() => setDays(d)}
            className={`px-3 py-1 rounded-lg font-semibold ${days === d ? 'bg-teal-700 text-white' : 'border border-slate-300 text-slate-600 hover:bg-slate-50'}`}
          >
            {d} يومًا
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Box title="مسار التحويل — شركات سجّلت في الفترة">
          <div className="flex flex-col gap-2.5">
            {steps.map((s) => (
              <div key={s.label}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-700">{s.label}</span>
                  <span className="text-slate-500">{s.value} ({pct(s.value, f.registered)}%)</span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-teal-600 rounded-full" style={{ width: `${pct(s.value, f.registered)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Box>

        <Box title="التسجيلات الأسبوعية">
          <Bars data={data.signups.map((w) => ({ label: w.week.slice(5), value: w.count }))} />
        </Box>

        <Box title="الإيراد">
          <div className="flex gap-6 mb-4 flex-wrap">
            <div>
              <p className="text-xs text-slate-500">الإيراد الشهري المتكرر (ر.س)</p>
              <p className="text-2xl font-bold text-slate-900">{money(data.revenue.mrr)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500">مشتركون مدفوعون</p>
              <p className="text-2xl font-bold text-slate-900">{data.revenue.payingNow}</p>
            </div>
          </div>
          <Bars
            data={data.revenue.monthly.map((m) => ({ label: MONTHS[Number(m.month.slice(5)) - 1] ?? m.month, value: m.amount }))}
            format={money}
          />
          <p className="text-xs text-slate-400 mt-2">المحصَّل شهريًا (ر.س) — آخر 6 أشهر</p>
        </Box>

        <Box title="الإيراد حسب الباقة">
          {data.revenue.byPlan.length === 0 ? (
            <p className="text-sm text-slate-400">لا توجد اشتراكات بعد</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr><th className="text-right font-medium pb-2">الباقة</th><th className="text-right font-medium pb-2">مدفوع</th><th className="text-right font-medium pb-2">تجربة</th><th className="text-right font-medium pb-2">إيراد شهري</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.revenue.byPlan.map((p) => (
                  <tr key={p.planName}>
                    <td className="py-2 font-medium text-slate-900">{p.planName}</td>
                    <td className="py-2">{p.subscribers}</td>
                    <td className="py-2">{p.trialing}</td>
                    <td className="py-2">{money(p.mrr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Box>

        <Box title="حالة الاشتراكات الآن">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(data.statusCounts) as SubscriptionStatus[]).map((st) => (
              <span key={st} className="text-sm bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                {STATUS_LABELS[st] ?? st}: <strong>{data.statusCounts[st]}</strong>
              </span>
            ))}
          </div>
        </Box>

        <Box title={`الفقد — آخر ${data.period.days} يومًا`}>
          <div className="flex gap-6 flex-wrap mb-3">
            <div><p className="text-xs text-slate-500">تجارب انتهت دون اشتراك</p><p className="text-2xl font-bold text-slate-900">{data.churn.trialsExpired}</p></div>
            <div><p className="text-xs text-slate-500">مشتركون مدفوعون فُقدوا</p><p className="text-2xl font-bold text-slate-900">{data.churn.paidLost}</p></div>
            <div><p className="text-xs text-slate-500">معدل الفقد</p><p className="text-2xl font-bold text-slate-900">{data.churn.ratePct}%</p></div>
          </div>
          {data.churn.recent.length > 0 && (
            <ul className="text-sm divide-y divide-slate-100">
              {data.churn.recent.map((r, i) => (
                <li key={i} className="py-1.5 flex gap-2">
                  {r.tenantId ? (
                    <button onClick={() => onOpenTenant(r.tenantId!)} className="text-teal-700 hover:underline">{r.name}</button>
                  ) : <span>{r.name}</span>}
                  <span className="text-slate-400 mr-auto text-xs">{r.action === 'SUB_CANCEL' ? 'إلغاء' : 'انتهاء'} · {new Date(r.at).toLocaleDateString('ar-SA')}</span>
                </li>
              ))}
            </ul>
          )}
        </Box>
      </div>

      <Box title={`شركات خاملة — بلا نشاط منذ ${data.period.dormantDays} يومًا أو أكثر (${data.dormant.length})`}>
        {data.dormant.length === 0 ? (
          <p className="text-sm text-slate-400">لا توجد شركات خاملة</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500">
                <tr>
                  {['الشركة', 'الباقة', 'الاشتراك', 'سجّلت', 'آخر نشاط', 'خاملة منذ'].map((h) => (
                    <th key={h} className="text-right font-medium pb-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.dormant.map((d) => (
                  <tr key={d.tenantId} onClick={() => onOpenTenant(d.tenantId)} className="hover:bg-slate-50 cursor-pointer">
                    <td className="py-2 font-medium text-slate-900">{d.name}</td>
                    <td className="py-2 text-slate-600">{d.planName ?? '—'}</td>
                    <td className="py-2 text-slate-600">{d.status ? STATUS_LABELS[d.status] : '—'}</td>
                    <td className="py-2 text-slate-500">{new Date(d.createdAt).toLocaleDateString('ar-SA')}</td>
                    <td className="py-2 text-slate-500">{d.lastActivityAt ? new Date(d.lastActivityAt).toLocaleDateString('ar-SA') : 'لم تبدأ'}</td>
                    <td className="py-2"><span className="bg-amber-50 text-amber-700 text-xs font-semibold px-2 py-0.5 rounded-full">{d.daysIdle} يومًا</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Box>

      <Box title="الأكثر نشاطًا — مبيعات آخر 30 يومًا">
        {data.topTenants.length === 0 ? (
          <p className="text-sm text-slate-400">لا توجد مبيعات مسجّلة</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {data.topTenants.map((t, i) => (
              <li key={t.tenantId} className="py-2 flex gap-3 items-center">
                <span className="text-slate-400 w-5">{i + 1}</span>
                <button onClick={() => onOpenTenant(t.tenantId)} className="text-teal-700 hover:underline font-medium">{t.name}</button>
                <span className="mr-auto text-slate-500">{t.invoices30} فاتورة</span>
                <span className="font-semibold text-slate-900">{money(t.sales30)}</span>
              </li>
            ))}
          </ul>
        )}
      </Box>
    </div>
  );
}
