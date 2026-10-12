/**
 * Platform console tab: the people who can sign in to the console (owner only).
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Loader2, Plus, UserCheck, UserX, X } from 'lucide-react';
import type { AxiosError } from 'axios';
import { platformApi } from '../../lib/platformApi';

const errorOf = (err: unknown) => (err as AxiosError<{ error?: string }>).response?.data?.error ?? 'تعذّر تنفيذ العملية';
const input =
  'w-full border border-najd-line rounded-lg px-3 py-2 text-sm bg-najd-paper focus:outline-none focus:ring-2 focus:ring-najd-gold/40 focus:border-najd-gold';

interface PlatformAdminRow {
  id: number;
  name: string;
  email: string;
  role: 'OWNER' | 'SUPPORT';
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  mustChangePassword: boolean;
}

export const ROLE_LABEL: Record<'OWNER' | 'SUPPORT', string> = { OWNER: 'مالك', SUPPORT: 'دعم فني' };

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function Temp({ email, password, onClose }: { email: string; password: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mx-4 mt-4 bg-amber-50 border border-amber-200 rounded-lg p-4">
      <p className="text-sm font-semibold text-amber-900">كلمة مرور مؤقتة لـ <span dir="ltr">{email}</span></p>
      <p className="mt-2 font-mono text-base select-all bg-najd-paper border border-amber-200 rounded px-3 py-2" dir="ltr">{password}</p>
      <p className="text-xs text-amber-800 mt-2">تُعرض مرة واحدة فقط. سيُطلب منه تغييرها عند أول دخول.</p>
      <div className="flex items-center gap-4 mt-2">
        <button
          onClick={async () => {
            try { await navigator.clipboard.writeText(password); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* selectable anyway */ }
          }}
          className="text-xs font-semibold text-amber-900 flex items-center gap-1"
        >
          <Copy size={13} /> {copied ? 'تم النسخ' : 'نسخ'}
        </button>
        <button onClick={onClose} className="text-xs text-amber-900 underline">إخفاء</button>
      </div>
    </div>
  );
}

function AddForm({ onClose, onCreated }: { onClose: () => void; onCreated: (email: string, password: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'OWNER' | 'SUPPORT'>('SUPPORT');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: async () =>
      (await platformApi.post<{ admin: PlatformAdminRow; temporaryPassword: string }>('/admins', { name, email, role })).data,
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['platform'] });
      onCreated(r.admin.email, r.temporaryPassword);
      onClose();
    },
    onError: (e) => setError(errorOf(e)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" dir="rtl">
      <div className="bg-najd-paper rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-najd-ink">مدير منصة جديد</h2>
          <button onClick={onClose} className="text-najd-muted hover:text-najd-ink"><X size={20} /></button>
        </div>
        <label className="text-sm font-medium text-najd-ink/80 flex flex-col gap-1">
          الاسم
          <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </label>
        <label className="text-sm font-medium text-najd-ink/80 flex flex-col gap-1">
          البريد الإلكتروني
          <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
        </label>
        <label className="text-sm font-medium text-najd-ink/80 flex flex-col gap-1">
          الدور
          <select value={role} onChange={(e) => setRole(e.target.value as 'OWNER' | 'SUPPORT')} className={input}>
            <option value="SUPPORT">دعم فني — يقرأ كل شيء ويساعد المستخدمين فقط</option>
            <option value="OWNER">مالك — كل الصلاحيات</option>
          </select>
        </label>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
        <button
          disabled={create.isPending || name.trim().length < 2 || !email.includes('@')}
          onClick={() => { setError(null); create.mutate(); }}
          className="bg-najd-green hover:bg-najd-green-dark text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-60 flex items-center justify-center gap-2"
        >
          {create.isPending && <Loader2 size={14} className="animate-spin" />} إنشاء وتوليد كلمة مرور مؤقتة
        </button>
      </div>
    </div>
  );
}

export function AdminsTab({ myId }: { myId: number | null }) {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [temp, setTemp] = useState<{ email: string; password: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['platform', 'admins'],
    queryFn: async () => (await platformApi.get<PlatformAdminRow[]>('/admins')).data,
  });

  const patch = useMutation({
    mutationFn: async (a: { id: number; body: object }) => (await platformApi.patch(`/admins/${a.id}`, a.body)).data,
    onSuccess: () => { setNotice(null); qc.invalidateQueries({ queryKey: ['platform'] }); },
    onError: (e) => setNotice(errorOf(e)),
  });
  const reset = useMutation({
    mutationFn: async (id: number) =>
      (await platformApi.post<{ email: string; temporaryPassword: string }>(`/admins/${id}/reset-password`)).data,
    onSuccess: (r) => { setNotice(null); setTemp({ email: r.email, password: r.temporaryPassword }); qc.invalidateQueries({ queryKey: ['platform'] }); },
    onError: (e) => setNotice(errorOf(e)),
  });

  return (
    <div className="pb-4">
      <div className="flex items-center gap-3 p-4 border-b border-najd-line">
        <p className="text-sm text-najd-muted">
          <strong>المالك</strong> بكل الصلاحيات، و<strong>الدعم الفني</strong> يقرأ كل شيء ويساعد المستخدمين (كلمة مرور، جلسات، تأكيد بريد) دون الفوترة أو الباقات أو الإيقاف.
        </p>
        <button onClick={() => setAdding(true)} className="mr-auto flex items-center gap-1.5 text-sm font-semibold bg-najd-green hover:bg-najd-green-dark text-white px-3 py-1.5 rounded-lg whitespace-nowrap">
          <Plus size={16} /> مدير جديد
        </button>
      </div>

      {temp && <Temp email={temp.email} password={temp.password} onClose={() => setTemp(null)} />}
      {notice && <p className="mx-4 mt-4 text-sm rounded-lg px-3 py-2 border bg-red-50 border-red-200 text-red-700">{notice}</p>}

      <ul className="divide-y divide-najd-line/70">
        {list.isLoading && <li className="py-10 text-center text-najd-muted/70"><Loader2 className="inline animate-spin" /></li>}
        {list.data?.map((a) => {
          const me = a.id === myId;
          return (
            <li key={a.id} className={`p-4 flex items-center gap-3 flex-wrap ${a.isActive ? '' : 'bg-najd-sand/60'}`}>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${a.isActive ? 'text-najd-ink' : 'text-najd-muted/70 line-through'}`}>
                  {a.name} {me && <span className="text-xs font-normal text-najd-muted/70">(أنت)</span>}
                </p>
                <p className="text-xs text-najd-muted" dir="ltr">{a.email}</p>
              </div>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${a.role === 'OWNER' ? 'bg-najd-green/10 text-najd-green' : 'bg-sky-50 text-sky-700'}`}>
                {ROLE_LABEL[a.role]}
              </span>
              {!a.isActive && <span className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded-full">معطّل</span>}
              {a.mustChangePassword && <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">لم يغيّر كلمة المرور</span>}
              <span className="text-xs text-najd-muted/70">آخر دخول: {fmt(a.lastLoginAt)}</span>
              {!me && (
                <span className="flex items-center">
                  <select
                    value={a.role}
                    disabled={patch.isPending}
                    onChange={(e) => patch.mutate({ id: a.id, body: { role: e.target.value } })}
                    className="border border-najd-line rounded-lg px-2 py-1 text-xs bg-najd-paper"
                  >
                    <option value="OWNER">مالك</option>
                    <option value="SUPPORT">دعم فني</option>
                  </select>
                  <button
                    title="إعادة تعيين كلمة المرور"
                    disabled={reset.isPending}
                    onClick={() => window.confirm(`إنشاء كلمة مرور مؤقتة جديدة لـ ${a.email}؟ ستنتهي جلساته الحالية.`) && reset.mutate(a.id)}
                    className="p-1.5 text-najd-muted hover:text-najd-green disabled:opacity-50"
                  >
                    <KeyRound size={16} />
                  </button>
                  <button
                    title={a.isActive ? 'تعطيل' : 'تفعيل'}
                    disabled={patch.isPending}
                    onClick={() => patch.mutate({ id: a.id, body: { isActive: !a.isActive } })}
                    className={`p-1.5 text-najd-muted disabled:opacity-50 ${a.isActive ? 'hover:text-red-600' : 'hover:text-emerald-700'}`}
                  >
                    {a.isActive ? <UserX size={16} /> : <UserCheck size={16} />}
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ul>

      {adding && <AddForm onClose={() => setAdding(false)} onCreated={(email, password) => setTemp({ email, password })} />}
    </div>
  );
}
