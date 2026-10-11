import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Loader2, MailCheck } from 'lucide-react';
import apiClient from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

/**
 * Asks company admins to confirm their e-mail address. Soft: nothing is blocked, the banner simply
 * stays until the link in the e-mail has been opened.
 */
export function EmailVerificationBanner() {
  const { hasPermission } = useAuth();
  const isAdmin = hasPermission('settings.edit');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const { data } = useQuery({
    queryKey: ['auth', 'me'],
    staleTime: 60_000,
    enabled: isAdmin,
    queryFn: async () => (await apiClient.get<{ email: string; emailVerified: boolean }>('/auth/me')).data,
  });

  const resend = useMutation({
    mutationFn: async () => (await apiClient.post<{ sent: boolean; alreadyVerified: boolean }>('/auth/resend-verification')).data,
    onSuccess: (r) =>
      setNotice({ ok: true, text: r.alreadyVerified ? 'بريدك مؤكَّد بالفعل' : 'أُرسلت رسالة التأكيد — تفقّد صندوق الوارد' }),
    onError: (e) =>
      setNotice({
        ok: false,
        text: axios.isAxiosError(e) && e.response?.data?.error ? String(e.response.data.error) : 'تعذّر الإرسال',
      }),
  });

  if (!isAdmin || !data || data.emailVerified) return null;

  return (
    <div className="border-b px-6 py-2.5 text-sm flex items-center gap-3 bg-amber-50 border-amber-200 text-amber-900">
      <MailCheck size={16} className="flex-shrink-0" />
      <span className="flex-1">
        {notice ? notice.text : (
          <>أكّد بريدك الإلكتروني <span dir="ltr" className="font-semibold">{data.email}</span> عبر الرابط الذي أرسلناه إليك.</>
        )}
      </span>
      <button
        onClick={() => { setNotice(null); resend.mutate(); }}
        disabled={resend.isPending}
        className="bg-amber-700 hover:bg-amber-800 text-white text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60 flex items-center gap-1.5 whitespace-nowrap"
      >
        {resend.isPending && <Loader2 size={13} className="animate-spin" />}
        إعادة إرسال الرابط
      </button>
    </div>
  );
}
