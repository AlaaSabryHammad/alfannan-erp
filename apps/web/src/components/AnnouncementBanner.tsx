import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertOctagon, AlertTriangle, Info, X } from 'lucide-react';
import apiClient from '../lib/api';

interface Announcement {
  id: number;
  title: string;
  body: string;
  level: 'INFO' | 'WARNING' | 'CRITICAL';
}

const STORAGE_KEY = 'dismissed_announcements';

const readDismissed = (): number[] => {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((n) => typeof n === 'number') : [];
  } catch {
    return [];
  }
};

const STYLE = {
  INFO: { box: 'bg-sky-50 border-sky-200 text-sky-900', Icon: Info },
  WARNING: { box: 'bg-amber-50 border-amber-200 text-amber-900', Icon: AlertTriangle },
  CRITICAL: { box: 'bg-red-50 border-red-200 text-red-900', Icon: AlertOctagon },
};

/** Messages from the platform owner (maintenance, new features). INFO / WARNING can be hidden; CRITICAL cannot. */
export function AnnouncementBanner() {
  const [dismissed, setDismissed] = useState<number[]>(readDismissed);
  const { data } = useQuery({
    queryKey: ['announcements'],
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
    queryFn: async () => (await apiClient.get<Announcement[]>('/announcements')).data,
  });

  const hide = (id: number) => {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode: hidden for this visit only */ }
  };

  const visible = (data ?? []).filter((a) => a.level === 'CRITICAL' || !dismissed.includes(a.id));
  if (visible.length === 0) return null;

  return (
    <>
      {visible.map((a) => {
        const { box, Icon } = STYLE[a.level] ?? STYLE.INFO;
        return (
          <div key={a.id} className={`border-b px-6 py-2.5 text-sm flex items-start gap-3 ${box}`}>
            <Icon size={16} className="flex-shrink-0 mt-0.5" />
            <span className="flex-1 leading-6">
              <span className="font-bold">{a.title}</span>
              <span className="mx-2 opacity-50">—</span>
              {a.body}
            </span>
            {a.level !== 'CRITICAL' && (
              <button onClick={() => hide(a.id)} title="إخفاء" className="opacity-60 hover:opacity-100 flex-shrink-0">
                <X size={16} />
              </button>
            )}
          </div>
        );
      })}
    </>
  );
}
