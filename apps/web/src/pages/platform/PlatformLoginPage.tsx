import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';
import type { AxiosError } from 'axios';
import { platformApi, PLATFORM_ADMIN_KEY, PLATFORM_TOKEN_KEY } from '../../lib/platformApi';

export function PlatformLoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await platformApi.post<{ token: string; admin: { name: string; email: string } }>(
        '/auth/login',
        { email, password },
      );
      localStorage.setItem(PLATFORM_TOKEN_KEY, data.token);
      localStorage.setItem(PLATFORM_ADMIN_KEY, JSON.stringify(data.admin));
      navigate('/platform', { replace: true });
    } catch (err) {
      const e2 = err as AxiosError<{ error?: string }>;
      setError(e2.response?.data?.error ?? 'تعذّر تسجيل الدخول');
    } finally {
      setBusy(false);
    }
  };

  const input =
    'w-full border border-slate-300 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-600/30 focus:border-teal-600';

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4" dir="rtl">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl shadow-2xl p-8 flex flex-col gap-4">
        <div className="w-14 h-14 rounded-2xl bg-teal-50 flex items-center justify-center">
          <ShieldCheck className="text-teal-700" size={28} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">لوحة إدارة المنصة</h1>
          <p className="text-sm text-slate-500 mt-1">دخول مالك المنصة فقط</p>
        </div>

        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          البريد الإلكتروني
          <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
          كلمة المرور
          <input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required className={input} />
        </label>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

        <button
          type="submit"
          disabled={busy}
          className="bg-teal-700 hover:bg-teal-800 text-white font-semibold py-2.5 rounded-lg flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : null}
          دخول
        </button>
      </form>
    </div>
  );
}
