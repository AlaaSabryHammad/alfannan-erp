import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, KeyRound, Loader2, LogOut, PauseCircle, PlayCircle, Search, Users, X } from 'lucide-react';
import {
  platformApi,
  PLATFORM_ADMIN_KEY,
  PLATFORM_TOKEN_KEY,
  type PlatformAuditRow,
  type PlatformStats,
  type PlatformTenant,
  type PlatformTenantDetail,
} from '../../lib/platformApi';

const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleDateString('ar-SA', { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const fmtMoney = (n: number) => new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 0 }).format(n);

const ACTION_LABELS: Record<string, string> = {
  LOGIN: 'دخول مدير المنصة',
  TENANT_SUSPEND: 'إيقاف شركة',
  TENANT_ACTIVATE: 'تفعيل شركة',
  TENANT_RENAME: 'تغيير اسم شركة',
  USER_PASSWORD_RESET: 'إعادة تعيين كلمة مرور',
};

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function SignupsChart({ data }: { data: PlatformStats['signupsByDay'] }) {
  const max = Math.max(1, ...data.map((d) => d.count));
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-semibold text-slate-700 mb-3">تسجيلات الشركات — آخر 30 يومًا</p>
      <div className="flex items-end gap-1 h-24">
        {data.map((d) => (
          <div key={d.date} className="flex-1 flex flex-col justify-end" title={`${d.date}: ${d.count}`}>
            <div
              className={d.count ? 'bg-teal-600 rounded-t' : 'bg-slate-200 rounded-t'}
              style={{ height: `${d.count ? Math.max(8, (d.count / max) * 100) : 4}%` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function TenantPanel({ tenantId, onClose }: { tenantId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['platform', 'tenant', tenantId],
    queryFn: async () => (await platformApi.get<PlatformTenantDetail>(`/tenants/${tenantId}`)).data,
  });

  const toggle = useMutation({
    mutationFn: async (isActive: boolean) => (await platformApi.patch(`/tenants/${tenantId}`, { isActive })).data,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform'] });
    },
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

  const confirmToggle = () => {
    if (!data) return;
    const msg = data.isActive
      ? `إيقاف «${data.name}»؟ سيُمنع كل مستخدميها من الدخول فورًا.`
      : `إعادة تفعيل «${data.name}»؟`;
    if (window.confirm(msg)) toggle.mutate(!data.isActive);
  };

  return (
    <div className="fixed inset-0 z-40 flex" dir="rtl">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <aside className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl p-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{data?.name ?? '…'}</h2>
            <p className="text-xs text-slate-500 mt-0.5" dir="ltr">{data?.slug}</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-500 hover:text-slate-900"><X size={20} /></button>
        </div>

        {isLoading || !data ? (
          <div className="py-10 flex justify-center"><Loader2 className="animate-spin text-slate-400" /></div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-5">
              <span className={`text-xs font-semibold px-2 py-1 rounded-full ${data.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {data.isActive ? 'نشطة' : 'موقوفة'}
              </span>
              <span className="text-xs text-slate-500">منذ {fmtDate(data.createdAt)}</span>
              <button
                onClick={confirmToggle}
                disabled={toggle.isPending}
                className={`mr-auto flex items-center gap-1.5 text-sm font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60 ${data.isActive ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}
              >
                {data.isActive ? <PauseCircle size={16} /> : <PlayCircle size={16} />}
                {data.isActive ? 'إيقاف الشركة' : 'تفعيل الشركة'}
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <StatCard label="المستخدمون" value={data.usage.users} />
              <StatCard label="الأصناف" value={data.usage.products} />
              <StatCard label="العملاء" value={data.usage.customers} />
              <StatCard label="فواتير البيع" value={data.usage.salesInvoices} hint={`${data.usage.invoicesLast30Days} في آخر 30 يومًا`} />
              <StatCard label="مبيعات 30 يومًا" value={fmtMoney(data.usage.salesLast30Days)} />
              <StatCard label="آخر نشاط" value={fmtDate(data.usage.lastActivityAt)} />
            </div>

            <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2"><Users size={16} /> المستخدمون</h3>
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {data.users.map((u) => (
                <li key={u.id} className="p-3 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">{u.name}</p>
                    <p className="text-xs text-slate-500 truncate" dir="ltr">{u.email}</p>
                  </div>
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{u.role.nameAr}</span>
                  <button
                    title="إعادة تعيين كلمة المرور"
                    disabled={reset.isPending}
                    onClick={() => {
                      if (window.confirm(`إنشاء كلمة مرور مؤقتة جديدة لـ ${u.email}؟`)) reset.mutate(u.id);
                    }}
                    className="p-1.5 text-slate-500 hover:text-teal-700 disabled:opacity-50"
                  >
                    <KeyRound size={16} />
                  </button>
                </li>
              ))}
            </ul>

            {temp && (
              <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm font-semibold text-amber-900">كلمة مرور مؤقتة لـ <span dir="ltr">{temp.email}</span></p>
                <p className="mt-2 font-mono text-base select-all bg-white border border-amber-200 rounded px-3 py-2" dir="ltr">{temp.password}</p>
                <p className="text-xs text-amber-800 mt-2">تُعرض مرة واحدة فقط — سلّمها للمستخدم ليغيّرها بعد الدخول.</p>
                <button onClick={() => setTemp(null)} className="text-xs text-amber-900 underline mt-2">إخفاء</button>
              </div>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

export function PlatformDashboardPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState<'tenants' | 'audit'>('tenants');
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
  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      <header className="bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <Building2 size={20} className="text-teal-400" />
          <h1 className="font-bold">لوحة إدارة المنصة</h1>
          <span className="mr-auto text-sm text-slate-300">{admin?.name}</span>
          <button onClick={logout} className="flex items-center gap-1.5 text-sm text-slate-300 hover:text-white">
            <LogOut size={16} /> خروج
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 flex flex-col gap-6">
        <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="إجمالي الشركات" value={s?.tenants.total ?? '—'} />
          <StatCard label="نشطة" value={s?.tenants.active ?? '—'} />
          <StatCard label="موقوفة" value={s?.tenants.suspended ?? '—'} />
          <StatCard label="جديدة (7 أيام)" value={s?.tenants.newLast7Days ?? '—'} hint={`${s?.tenants.newLast30Days ?? 0} في 30 يومًا`} />
          <StatCard label="المستخدمون" value={s?.users ?? '—'} />
        </section>

        {s && <SignupsChart data={s.signupsByDay} />}

        <section className="bg-white rounded-xl border border-slate-200">
          <div className="flex items-center gap-2 p-3 border-b border-slate-200">
            {(['tenants', 'audit'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`text-sm font-semibold px-3 py-1.5 rounded-lg ${tab === t ? 'bg-teal-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
              >
                {t === 'tenants' ? 'الشركات' : 'سجل العمليات'}
              </button>
            ))}
            {tab === 'tenants' && (
              <div className="mr-auto relative">
                <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="بحث بالاسم…"
                  className="border border-slate-300 rounded-lg pr-9 pl-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-teal-600/30"
                />
              </div>
            )}
          </div>

          {tab === 'tenants' ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-500 text-xs">
                  <tr>
                    {['الشركة', 'الحالة', 'المستخدمون', 'الأصناف', 'فواتير 30 يومًا', 'مبيعات 30 يومًا', 'آخر نشاط', 'الإنشاء'].map((h) => (
                      <th key={h} className="text-right font-medium px-4 py-2.5">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {tenants.isLoading && (
                    <tr><td colSpan={8} className="py-10 text-center text-slate-400"><Loader2 className="inline animate-spin" /></td></tr>
                  )}
                  {tenants.data?.map((t) => (
                    <tr key={t.id} onClick={() => setSelected(t.id)} className="hover:bg-slate-50 cursor-pointer">
                      <td className="px-4 py-3 font-medium text-slate-900">{t.name}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${t.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                          {t.isActive ? 'نشطة' : 'موقوفة'}
                        </span>
                      </td>
                      <td className="px-4 py-3">{t.usage.users}</td>
                      <td className="px-4 py-3">{t.usage.products}</td>
                      <td className="px-4 py-3">{t.usage.invoicesLast30Days}</td>
                      <td className="px-4 py-3">{fmtMoney(t.usage.salesLast30Days)}</td>
                      <td className="px-4 py-3 text-slate-500">{fmtDate(t.usage.lastActivityAt)}</td>
                      <td className="px-4 py-3 text-slate-500">{fmtDate(t.createdAt)}</td>
                    </tr>
                  ))}
                  {tenants.data?.length === 0 && (
                    <tr><td colSpan={8} className="py-10 text-center text-slate-400">لا توجد شركات مطابقة</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {audit.isLoading && <li className="py-10 text-center text-slate-400"><Loader2 className="inline animate-spin" /></li>}
              {audit.data?.map((r) => (
                <li key={r.id} className="px-4 py-3 flex items-center gap-3 text-sm">
                  <span className="font-medium text-slate-900">{ACTION_LABELS[r.action] ?? r.action}</span>
                  {r.detail && <span className="text-slate-500 truncate" dir="auto">{r.detail}</span>}
                  <span className="mr-auto text-xs text-slate-400">
                    {r.admin?.name ?? '—'} · {new Date(r.createdAt).toLocaleString('ar-SA')}
                  </span>
                </li>
              ))}
              {audit.data?.length === 0 && <li className="py-10 text-center text-slate-400">لا توجد عمليات بعد</li>}
            </ul>
          )}
        </section>
      </main>

      {selected !== null && <TenantPanel tenantId={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
