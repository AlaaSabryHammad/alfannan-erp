import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, ChevronDown, LogOut, User, ShoppingCart, Building2, Menu, CalendarDays } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useDateRange, type DatePreset } from '../contexts/DateRangeContext';
import apiClient from '../lib/api';

interface AlertsSummary {
  total: number;
}

const PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'all',    label: 'الكل' },
  { key: 'today',  label: 'اليوم' },
  { key: 'week',   label: 'هذا الأسبوع' },
  { key: 'month',  label: 'هذا الشهر' },
  { key: 'year',   label: 'هذا العام' },
  { key: 'custom', label: 'مخصص' },
];

const PRESET_LABELS: Record<DatePreset, string> = {
  all: 'الكل',
  today: 'اليوم',
  week: 'هذا الأسبوع',
  month: 'هذا الشهر',
  year: 'هذا العام',
  custom: 'مخصص',
};

export function Topbar({ onMenuToggle }: { onMenuToggle?: () => void }) {
  const { user, logout } = useAuth();
  const { from, to, preset, setPreset, setCustomFrom, setCustomTo } = useDateRange();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);

  const { data: alertsSummary } = useQuery({
    queryKey: ['alerts-summary'],
    queryFn: async () => (await apiClient.get<AlertsSummary>('/alerts/summary')).data,
    refetchInterval: 60_000,
  });
  const alertsCount = alertsSummary?.total ?? 0;

  const getInitials = (name: string) =>
    name
      .split(' ')
      .slice(0, 2)
      .map((n) => n[0])
      .join('');

  return (
    <header className="h-16 bg-white border-b border-app-border sticky top-0 z-30 flex items-center px-4 gap-3">
      {/* Right side: user chip + notifications + POS button */}
      <div className="flex items-center gap-3">
        {/* User chip */}
        <div className="relative">
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className="flex items-center gap-2.5 hover:bg-gray-50 rounded-xl px-2 py-1.5 transition-colors"
          >
            <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
              {user ? getInitials(user.name) : 'U'}
            </div>
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-app-text leading-tight">{user?.name}</p>
              <p className="text-xs text-app-muted leading-tight">{user?.role?.nameAr}</p>
            </div>
            <ChevronDown size={14} className="text-app-muted" />
          </button>

          {/* User dropdown */}
          {userMenuOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setUserMenuOpen(false)}
              />
              <div className="absolute top-full right-0 mt-1 w-48 bg-white rounded-xl border border-app-border shadow-lg z-20 py-1 overflow-hidden">
                <div className="px-4 py-2 border-b border-app-border">
                  <p className="text-sm font-semibold text-app-text">{user?.name}</p>
                  <p className="text-xs text-app-muted">{user?.email}</p>
                </div>
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-app-muted hover:bg-gray-50 transition-colors"
                >
                  <User size={15} />
                  <span>الملف الشخصي</span>
                </button>
                <button
                  onClick={() => {
                    setUserMenuOpen(false);
                    logout();
                  }}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-danger hover:bg-danger-bg transition-colors"
                >
                  <LogOut size={15} />
                  <span>تسجيل الخروج</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Notifications */}
        <Link
          to="/alerts"
          className="relative w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-50 text-app-muted hover:text-app-text transition-colors"
          title="التنبيهات"
        >
          <Bell size={18} />
          {alertsCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center bg-danger text-white text-[10px] font-bold rounded-full">
              {alertsCount > 99 ? '99+' : alertsCount}
            </span>
          )}
        </Link>

        {/* POS button */}
        <Link
          to="/pos"
          className="flex items-center gap-2 bg-accent hover:bg-accent-600 text-white text-sm font-semibold px-3 py-2 rounded-xl transition-colors"
        >
          <ShoppingCart size={16} />
          <span className="hidden sm:inline">شاشة البيع السريع</span>
        </Link>
      </div>

      {/* Center: date range filter controls */}
      <div className="flex-1 hidden md:flex items-center justify-center gap-2">
        {/* Preset dropdown */}
        <div className="relative">
          <button
            onClick={() => setPresetOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-app-border rounded-lg text-xs text-app-text hover:bg-gray-50 transition-colors font-medium"
          >
            <CalendarDays size={13} className="text-primary flex-shrink-0" />
            <span>الفترة: {PRESET_LABELS[preset]}</span>
            <ChevronDown size={12} className="text-app-muted" />
          </button>
          {presetOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setPresetOpen(false)} />
              <div className="absolute top-full right-0 mt-1 w-44 bg-white rounded-xl border border-app-border shadow-lg z-20 py-1 overflow-hidden">
                {PRESETS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => {
                      setPreset(p.key);
                      setPresetOpen(false);
                    }}
                    className={`w-full text-right px-4 py-2 text-sm transition-colors ${
                      preset === p.key
                        ? 'bg-primary-50 text-primary font-semibold'
                        : 'text-app-text hover:bg-gray-50'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* From date */}
        <div className="flex items-center gap-1">
          <label className="text-xs text-app-muted whitespace-nowrap">من:</label>
          <input
            type="date"
            value={from ?? ''}
            onChange={(e) => setCustomFrom(e.target.value)}
            className="border border-app-border rounded-lg px-2 py-1 text-xs text-app-text bg-white focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary"
          />
        </div>

        {/* To date */}
        <div className="flex items-center gap-1">
          <label className="text-xs text-app-muted whitespace-nowrap">إلى:</label>
          <input
            type="date"
            value={to ?? ''}
            onChange={(e) => setCustomTo(e.target.value)}
            className="border border-app-border rounded-lg px-2 py-1 text-xs text-app-text bg-white focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary"
          />
        </div>

        {/* Clear badge when a range is active */}
        {(from || to) && preset !== 'all' && (
          <button
            onClick={() => setPreset('all')}
            className="text-xs text-app-muted hover:text-danger transition-colors px-1"
            title="إزالة الفلتر"
          >
            ✕
          </button>
        )}
      </div>

      {/* Left: branch selector + hamburger */}
      <div className="flex items-center gap-2 mr-auto">
        <button className="flex items-center gap-1.5 text-sm font-medium text-primary border border-primary/20 bg-primary-50 rounded-xl px-3 py-2 hover:bg-primary-100 transition-colors">
          <Building2 size={15} />
          <span className="hidden sm:inline">كافة الفروع والمستودعات</span>
          <ChevronDown size={13} />
        </button>
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            className="md:hidden w-9 h-9 flex items-center justify-center rounded-xl hover:bg-gray-50 text-app-muted"
          >
            <Menu size={18} />
          </button>
        )}
      </div>
    </header>
  );
}
