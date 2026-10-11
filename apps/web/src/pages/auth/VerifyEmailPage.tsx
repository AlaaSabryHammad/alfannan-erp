import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { CheckCircle2, Loader2, MailWarning } from 'lucide-react';
import apiClient from '../../lib/api';

type State =
  | { kind: 'loading' }
  | { kind: 'done'; email: string; already: boolean }
  | { kind: 'error'; message: string };

/** Landing page of the link in the confirmation e-mail. Public: the token in the URL is the proof. */
export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const qc = useQueryClient();
  const [state, setState] = useState<State>(token ? { kind: 'loading' } : { kind: 'error', message: 'رابط التأكيد غير مكتمل' });
  const started = useRef(false);

  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    apiClient
      .post<{ email: string; alreadyVerified: boolean }>('/auth/verify-email', { token })
      .then((r) => {
        setState({ kind: 'done', email: r.data.email, already: r.data.alreadyVerified });
        qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      })
      .catch((e) => {
        const message = axios.isAxiosError(e) && e.response?.data?.error ? String(e.response.data.error) : 'تعذّر تأكيد البريد الإلكتروني';
        setState({ kind: 'error', message });
      });
  }, [token, qc]);

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center">
        {state.kind === 'loading' && (
          <>
            <Loader2 size={40} className="animate-spin text-teal-700 mx-auto mb-4" />
            <h1 className="text-lg font-bold text-slate-900">جارٍ تأكيد بريدك الإلكتروني…</h1>
          </>
        )}
        {state.kind === 'done' && (
          <>
            <span className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 size={34} />
            </span>
            <h1 className="text-xl font-bold text-slate-900 mb-2">
              {state.already ? 'بريدك مؤكَّد مسبقًا' : 'تم تأكيد بريدك الإلكتروني'}
            </h1>
            <p className="text-sm text-slate-600 mb-6" dir="ltr">{state.email}</p>
            <Link to="/" className="inline-block bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold px-6 py-2.5 rounded-lg">
              متابعة إلى النظام
            </Link>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <span className="w-16 h-16 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
              <MailWarning size={32} />
            </span>
            <h1 className="text-xl font-bold text-slate-900 mb-2">تعذّر تأكيد البريد</h1>
            <p className="text-sm text-slate-600 mb-6">{state.message}</p>
            <Link to="/login" className="inline-block bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold px-6 py-2.5 rounded-lg">
              تسجيل الدخول
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
