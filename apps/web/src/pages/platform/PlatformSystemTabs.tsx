/**
 * Platform console tabs: announcements to every company, and the system status panel.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Loader2, Megaphone, Pencil, Plus, Send, Trash2, X, XCircle } from 'lucide-react';
import type { AxiosError } from 'axios';
import { platformApi } from '../../lib/platformApi';

const errorOf = (err: unknown) => (err as AxiosError<{ error?: string }>).response?.data?.error ?? 'تعذّر تنفيذ العملية';
const input =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-600';

const fmtDateTime = (v: string | null) => (v ? new Date(v).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

// ── announcements ─────────────────────────────────────────────────────────────

export interface Announcement {
  id: number;
  title: string;
  body: string;
  level: 'INFO' | 'WARNING' | 'CRITICAL';
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
  createdAt: string;
}

const LEVELS: Record<Announcement['level'], { label: string; style: string }> = {
  INFO: { label: 'معلومة', style: 'bg-sky-50 text-sky-700' },
  WARNING: { label: 'تنبيه', style: 'bg-amber-50 text-amber-700' },
  CRITICAL: { label: 'هام', style: 'bg-red-50 text-red-700' },
};

/** datetime-local value (local time) <-> ISO */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

function AnnouncementForm({ item, onClose }: { item: Announcement | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(item?.title ?? '');
  const [body, setBody] = useState(item?.body ?? '');
  const [level, setLevel] = useState<Announcement['level']>(item?.level ?? 'INFO');
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [startsAt, setStartsAt] = useState(toLocalInput(item?.startsAt ?? null));
  const [endsAt, setEndsAt] = useState(toLocalInput(item?.endsAt ?? null));
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const payload = { title, body, level, isActive, startsAt: fromLocalInput(startsAt), endsAt: fromLocalInput(endsAt) };
      return item
        ? (await platformApi.put(`/announcements/${item.id}`, payload)).data
        : (await platformApi.post('/announcements', payload)).data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platform'] });
      onClose();
    },
    onError: (e) => setError(errorOf(e)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" dir="rtl">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900">{item ? 'تعديل إعلان' : 'إعلان جديد'}</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900"><X size={20} /></button>
        </div>

        <label className="text-sm font-medium text-slate-700 flex flex-col gap-1">
          العنوان
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} className={input} />
        </label>
        <label className="text-sm font-medium text-slate-700 flex flex-col gap-1">
          النص
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={1000} className={input} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm font-medium text-slate-700 flex flex-col gap-1">
            الأهمية
            <select value={level} onChange={(e) => setLevel(e.target.value as Announcement['level'])} className={input}>
              <option value="INFO">معلومة</option>
              <option value="WARNING">تنبيه</option>
              <option value="CRITICAL">هام (لا يمكن إخفاؤه)</option>
            </select>
          </label>
          <label className="text-sm font-medium text-slate-700 flex items-end gap-2 pb-2">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} /> مفعّل
          </label>
          <label className="text-sm font-medium text-slate-700 flex flex-col gap-1">
            يبدأ (اختياري)
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={input} />
          </label>
          <label className="text-sm font-medium text-slate-700 flex flex-col gap-1">
            ينتهي (اختياري)
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={input} />
          </label>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
        <button
          disabled={save.isPending || title.trim().length < 2 || body.trim().length < 2}
          onClick={() => { setError(null); save.mutate(); }}
          className="bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {save.isPending && <Loader2 size={14} className="animate-spin" />} {item ? 'حفظ التعديل' : 'نشر الإعلان'}
        </button>
      </div>
    </div>
  );
}

export function AnnouncementsTab() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null);
  const list = useQuery({
    queryKey: ['platform', 'announcements'],
    queryFn: async () => (await platformApi.get<Announcement[]>('/announcements')).data,
  });
  const remove = useMutation({
    mutationFn: async (id: number) => platformApi.delete(`/announcements/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform'] }),
  });
  const toggle = useMutation({
    mutationFn: async (a: Announcement) =>
      platformApi.put(`/announcements/${a.id}`, { title: a.title, body: a.body, level: a.level, isActive: !a.isActive, startsAt: a.startsAt, endsAt: a.endsAt }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform'] }),
  });

  const now = Date.now();
  const stateOf = (a: Announcement) => {
    if (!a.isActive) return { label: 'معطّل', style: 'bg-slate-100 text-slate-600' };
    if (a.startsAt && new Date(a.startsAt).getTime() > now) return { label: 'مجدول', style: 'bg-violet-50 text-violet-700' };
    if (a.endsAt && new Date(a.endsAt).getTime() < now) return { label: 'منتهٍ', style: 'bg-slate-100 text-slate-600' };
    return { label: 'ظاهر الآن', style: 'bg-emerald-50 text-emerald-700' };
  };

  return (
    <div>
      <div className="flex items-center gap-3 p-4 border-b border-slate-100">
        <Megaphone size={18} className="text-teal-700" />
        <p className="text-sm text-slate-600">تظهر الإعلانات الفعّالة كشريط أعلى النظام لكل مستخدمي كل الشركات.</p>
        <button onClick={() => setEditing('new')} className="mr-auto flex items-center gap-1.5 text-sm font-semibold bg-teal-700 hover:bg-teal-800 text-white px-3 py-1.5 rounded-lg">
          <Plus size={16} /> إعلان جديد
        </button>
      </div>
      <ul className="divide-y divide-slate-100">
        {list.isLoading && <li className="py-10 text-center text-slate-400"><Loader2 className="inline animate-spin" /></li>}
        {list.data?.map((a) => {
          const st = stateOf(a);
          return (
            <li key={a.id} className="p-4 flex flex-col gap-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-slate-900">{a.title}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${LEVELS[a.level].style}`}>{LEVELS[a.level].label}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${st.style}`}>{st.label}</span>
                <span className="mr-auto flex items-center">
                  <button title={a.isActive ? 'تعطيل' : 'تفعيل'} onClick={() => toggle.mutate(a)} className="p-1.5 text-slate-500 hover:text-teal-700">
                    {a.isActive ? <XCircle size={16} /> : <CheckCircle2 size={16} />}
                  </button>
                  <button title="تعديل" onClick={() => setEditing(a)} className="p-1.5 text-slate-500 hover:text-teal-700"><Pencil size={16} /></button>
                  <button
                    title="حذف"
                    onClick={() => window.confirm(`حذف الإعلان «${a.title}»؟`) && remove.mutate(a.id)}
                    className="p-1.5 text-slate-500 hover:text-red-600"
                  >
                    <Trash2 size={16} />
                  </button>
                </span>
              </div>
              <p className="text-sm text-slate-600 leading-6">{a.body}</p>
              <p className="text-xs text-slate-400">
                {a.startsAt ? `من ${fmtDateTime(a.startsAt)} ` : ''}
                {a.endsAt ? `حتى ${fmtDateTime(a.endsAt)}` : a.startsAt ? '' : 'بدون مدة محددة'}
              </p>
            </li>
          );
        })}
        {list.data?.length === 0 && <li className="py-10 text-center text-slate-400">لا توجد إعلانات</li>}
      </ul>
      {editing !== null && <AnnouncementForm item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ── system status ─────────────────────────────────────────────────────────────

interface SystemStatus {
  runtime: { node: string; uptimeSeconds: number; env: string };
  signup: { enabled: boolean; source: 'console' | 'env'; envValue: boolean };
  subscriptions: { enforcement: string };
  payments: { enabled: boolean; provider: string };
  mail: { enabled: boolean; driver: string; host: string | null; from: string | null };
  database: { sizeBytes: number; tenants: number; users: number };
  backups: { available: boolean; count: number; latest: { name: string; at: string; bytes: number } | null };
  lifecycle: { ranAt?: string } | null;
}

const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
const fmtUptime = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)} يوم` : s >= 3600 ? `${Math.floor(s / 3600)} ساعة` : `${Math.floor(s / 60)} دقيقة`);

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0 text-sm">
      <span className="text-slate-500 w-40 flex-shrink-0">{label}</span>
      <span className="text-slate-900 flex items-center gap-2 flex-wrap">{children}</span>
    </div>
  );
}

const Pill = ({ ok, text }: { ok: boolean; text: string }) => (
  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{text}</span>
);

export function SystemTab() {
  const qc = useQueryClient();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const status = useQuery({
    queryKey: ['platform', 'system'],
    queryFn: async () => (await platformApi.get<SystemStatus>('/system')).data,
  });

  const signup = useMutation({
    mutationFn: async (enabled: boolean | null) => (await platformApi.put('/system/signup', { enabled })).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['platform', 'system'] }),
    onError: (e) => setNotice({ ok: false, text: errorOf(e) }),
  });
  const testMail = useMutation({
    mutationFn: async () => (await platformApi.post<{ to: string }>('/system/test-email', {})).data,
    onSuccess: (r) => setNotice({ ok: true, text: `أُرسلت رسالة اختبار إلى ${r.to}` }),
    onError: (e) => setNotice({ ok: false, text: errorOf(e) }),
  });

  const s = status.data;
  if (status.isLoading || !s) return <div className="py-10 text-center text-slate-400"><Loader2 className="inline animate-spin" /></div>;

  const backupAgeH = s.backups.latest ? (Date.now() - new Date(s.backups.latest.at).getTime()) / 3600000 : null;

  return (
    <div className="p-4 grid md:grid-cols-2 gap-4">
      <section className="border border-slate-200 rounded-xl p-4">
        <h3 className="font-semibold text-slate-800 mb-1">التسجيل</h3>
        <Row label="تسجيل الشركات الجديدة">
          <Pill ok={s.signup.enabled} text={s.signup.enabled ? 'مفتوح' : 'مغلق'} />
          <span className="text-xs text-slate-400">{s.signup.source === 'console' ? 'مضبوط من اللوحة' : 'حسب إعداد الخادم'}</span>
        </Row>
        <div className="flex gap-2 mt-2 flex-wrap">
          <button
            disabled={signup.isPending}
            onClick={() => signup.mutate(!s.signup.enabled)}
            className={`text-sm font-semibold px-3 py-1.5 rounded-lg text-white disabled:opacity-60 ${s.signup.enabled ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
          >
            {s.signup.enabled ? 'إغلاق التسجيل' : 'فتح التسجيل'}
          </button>
          {s.signup.source === 'console' && (
            <button
              disabled={signup.isPending}
              onClick={() => signup.mutate(null)}
              className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50"
            >
              اتباع إعداد الخادم ({s.signup.envValue ? 'مفتوح' : 'مغلق'})
            </button>
          )}
        </div>
      </section>

      <section className="border border-slate-200 rounded-xl p-4">
        <h3 className="font-semibold text-slate-800 mb-1">البريد الإلكتروني</h3>
        <Row label="الحالة"><Pill ok={s.mail.enabled} text={s.mail.enabled ? 'مفعّل' : 'غير مفعّل'} /></Row>
        <Row label="الخادم"><span dir="ltr">{s.mail.host ?? '—'}</span></Row>
        <Row label="المرسل"><span dir="auto">{s.mail.from ?? '—'}</span></Row>
        <button
          disabled={testMail.isPending || !s.mail.enabled}
          onClick={() => { setNotice(null); testMail.mutate(); }}
          className="mt-2 text-sm font-semibold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2"
        >
          {testMail.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} إرسال رسالة اختبار لي
        </button>
      </section>

      <section className="border border-slate-200 rounded-xl p-4">
        <h3 className="font-semibold text-slate-800 mb-1">النسخ الاحتياطي</h3>
        {!s.backups.available ? (
          <Row label="الحالة"><Pill ok={false} text="المجلد غير مرئي للـ API" /></Row>
        ) : s.backups.latest ? (
          <>
            <Row label="آخر نسخة">
              <Pill ok={(backupAgeH ?? 99) <= 36} text={(backupAgeH ?? 0) <= 36 ? 'حديثة' : 'قديمة!'} />
              <span>{fmtDateTime(s.backups.latest.at)}</span>
            </Row>
            <Row label="الحجم">{fmtBytes(s.backups.latest.bytes)}</Row>
            <Row label="عدد النسخ على السيرفر">{s.backups.count}</Row>
          </>
        ) : (
          <Row label="الحالة"><Pill ok={false} text="لا توجد نسخ" /></Row>
        )}
      </section>

      <section className="border border-slate-200 rounded-xl p-4">
        <h3 className="font-semibold text-slate-800 mb-1">النظام</h3>
        <Row label="الاشتراكات">
          <Pill ok={s.subscriptions.enforcement === 'enforce'} text={s.subscriptions.enforcement === 'enforce' ? 'تطبيق كامل' : s.subscriptions.enforcement === 'log' ? 'تسجيل فقط' : 'متوقف'} />
        </Row>
        <Row label="الدفع الإلكتروني">
          <Pill ok={s.payments.enabled} text={s.payments.enabled ? 'مفعّل' : 'غير مفعّل'} />
          <span className="text-xs text-slate-400">{s.payments.provider}</span>
        </Row>
        <Row label="قاعدة البيانات">{fmtBytes(s.database.sizeBytes)} · {s.database.tenants} شركة · {s.database.users} مستخدم</Row>
        <Row label="الخادم">
          <span dir="ltr">Node {s.runtime.node}</span>
          <span className="text-xs text-slate-400">يعمل منذ {fmtUptime(s.runtime.uptimeSeconds)}</span>
        </Row>
      </section>

      {notice && (
        <p className={`md:col-span-2 text-sm rounded-lg px-3 py-2 border flex items-center gap-2 ${notice.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>
          {notice.ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {notice.text}
        </p>
      )}
    </div>
  );
}
