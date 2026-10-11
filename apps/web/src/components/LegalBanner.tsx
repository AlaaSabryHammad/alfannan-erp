import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileCheck2, Loader2 } from 'lucide-react';
import apiClient from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface LegalStatus {
  currentVersion: string;
  acceptedVersion: string | null;
  upToDate: boolean;
}

/**
 * Shown to company admins when the company has not accepted the current Terms / Privacy Policy
 * (a company created before they existed, or after a new version was published). Soft: the system
 * keeps working; it only asks.
 */
export function LegalBanner() {
  const qc = useQueryClient();
  const { hasPermission } = useAuth();
  const canAccept = hasPermission('settings.edit');

  const { data } = useQuery({
    queryKey: ['legal', 'status'],
    staleTime: 5 * 60_000,
    enabled: canAccept,
    queryFn: async () => (await apiClient.get<LegalStatus>('/legal/status')).data,
  });

  const accept = useMutation({
    mutationFn: async () => apiClient.post('/legal/accept'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['legal'] }),
  });

  if (!canAccept || !data || data.upToDate) return null;

  return (
    <div className="border-b px-6 py-2.5 text-sm flex items-center gap-3 bg-sky-50 border-sky-200 text-sky-900">
      <FileCheck2 size={16} className="flex-shrink-0" />
      <span className="flex-1">
        {data.acceptedVersion
          ? 'تم تحديث شروط الاستخدام وسياسة الخصوصية. يلزم موافقة الشركة على النسخة الجديدة.'
          : 'لم توافق شركتك بعد على شروط الاستخدام وسياسة الخصوصية.'}{' '}
        <Link to="/terms" target="_blank" className="underline font-semibold">الشروط</Link>
        {' · '}
        <Link to="/privacy" target="_blank" className="underline font-semibold">الخصوصية</Link>
      </span>
      <button
        onClick={() => accept.mutate()}
        disabled={accept.isPending}
        className="bg-sky-700 hover:bg-sky-800 text-white text-xs font-semibold px-3 py-1.5 rounded-lg disabled:opacity-60 flex items-center gap-1.5 whitespace-nowrap"
      >
        {accept.isPending && <Loader2 size={13} className="animate-spin" />}
        أوافق
      </button>
    </div>
  );
}
