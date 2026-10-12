import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { BrandMark, BRAND_NAME } from '../../components/BrandLogo';
import { Ornament, SaduBand } from './PlatformShell';
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
      const { data } = await platformApi.post<{ token: string; admin: { id: number; name: string; email: string; role: string; mustChangePassword: boolean } }>(
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
    'w-full border border-najd-line rounded-xl px-3.5 py-3 text-sm bg-najd-paper text-najd-ink focus:outline-none focus:ring-2 focus:ring-najd-gold/40 focus:border-najd-gold';

  return (
    <div className="platform-root platform-sidebar min-h-screen flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-6">
          <BrandMark size={84} tone="onDark" />
          <h1 className="font-display text-4xl font-bold text-najd-gold-light mt-4">{BRAND_NAME}</h1>
          <SaduBand className="w-48 mt-3 opacity-90" />
          <p className="text-sm text-white/60 mt-3">لوحة إدارة المنصة</p>
        </div>

        <form onSubmit={submit} className="bg-najd-paper rounded-3xl shadow-2xl border border-najd-gold/40 p-8 flex flex-col gap-4">
          <div>
            <h2 className="font-display text-2xl font-bold text-najd-ink">تسجيل الدخول</h2>
            <p className="text-sm text-najd-muted mt-1">للمالك وفريق الدعم المعتمد فقط</p>
          </div>
          <Ornament />

          <label className="flex flex-col gap-1.5 text-sm font-medium text-najd-ink/80">
            البريد الإلكتروني
            <input type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} required className={input} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-najd-ink/80">
            كلمة المرور
            <input type="password" dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} required className={input} />
          </label>

          {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

          <button
            type="submit"
            disabled={busy}
            className="bg-najd-green hover:bg-najd-green-dark text-najd-gold-light font-display text-lg font-bold py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60 border border-najd-gold/50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : null}
            دخول
          </button>
        </form>

        <p className="text-center text-xs text-white/40 mt-5">© 2026 {BRAND_NAME} · حلول الفنان</p>
      </div>
    </div>
  );
}
