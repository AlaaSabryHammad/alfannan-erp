/**
 * Platform console shell: right-hand navigation sidebar + page header.
 * Visual language: deep Saudi green, gold, sand paper; Sadu weaving bands and an eight-point star
 * ground pattern; El Messiri for headings, IBM Plex Sans Arabic for text.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, Building2, Inbox, KeyRound, Layers, LayoutDashboard, LogOut, Megaphone, Menu, ScrollText,
  ShieldCheck, TrendingUp, Wallet, X,
} from 'lucide-react';
import { BrandMark, BRAND_NAME } from '../../components/BrandLogo';

export type SectionId =
  | 'overview' | 'tenants' | 'requests' | 'plans' | 'payments' | 'analytics'
  | 'announcements' | 'system' | 'admins' | 'audit';

interface NavItem {
  id: SectionId;
  label: string;
  hint: string;
  icon: typeof Building2;
  ownerOnly?: boolean;
}

const GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: 'الرئيسية',
    items: [
      { id: 'overview', label: 'نظرة عامة', hint: 'مؤشرات المنصة وما يحتاج متابعة', icon: LayoutDashboard },
      { id: 'tenants', label: 'الشركات', hint: 'العملاء المسجّلون ومستخدموهم', icon: Building2 },
    ],
  },
  {
    label: 'الاشتراكات',
    items: [
      { id: 'requests', label: 'طلبات الترقية', hint: 'طلبات تغيير الباقة الواردة', icon: Inbox },
      { id: 'plans', label: 'الباقات', hint: 'الأسعار والحدود والمزايا', icon: Layers },
      { id: 'payments', label: 'المدفوعات', hint: 'التحصيل اليدوي والإلكتروني', icon: Wallet },
    ],
  },
  {
    label: 'النمو',
    items: [{ id: 'analytics', label: 'التقارير والنمو', hint: 'التحويل والإيراد والفقد', icon: TrendingUp }],
  },
  {
    label: 'المنصة',
    items: [
      { id: 'announcements', label: 'الإعلانات', hint: 'رسائل لكل الشركات', icon: Megaphone },
      { id: 'system', label: 'حالة النظام', hint: 'البريد والنسخ الاحتياطي والتسجيل', icon: Activity },
      { id: 'admins', label: 'مديرو المنصة', hint: 'الصلاحيات والحسابات', icon: ShieldCheck, ownerOnly: true },
      { id: 'audit', label: 'سجل العمليات', hint: 'كل ما جرى في اللوحة', icon: ScrollText },
    ],
  },
];

const hijri = (d: Date) =>
  new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
const gregorian = (d: Date) =>
  new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);

/** A woven Sadu strip: zig-zag with gold diamonds. */
export function SaduBand({ className = '', tone = 'gold' }: { className?: string; tone?: 'gold' | 'green' }) {
  return <div aria-hidden="true" className={`sadu-band ${tone === 'green' ? 'sadu-band-green' : ''} ${className}`} />;
}

/** Section divider ornament: line — diamond — line. */
export function Ornament({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center gap-3 text-najd-gold ${className}`} aria-hidden="true">
      <span className="h-px flex-1 bg-gradient-to-l from-najd-gold/60 to-transparent" />
      <svg width="14" height="14" viewBox="0 0 14 14"><path d="M7 0 14 7 7 14 0 7Z" fill="currentColor" /><path d="M7 3.5 10.5 7 7 10.5 3.5 7Z" fill="#fffdf8" /></svg>
      <span className="h-px flex-1 bg-gradient-to-r from-najd-gold/60 to-transparent" />
    </div>
  );
}

interface ShellProps {
  section: SectionId;
  isOwner: boolean;
  badges?: Partial<Record<SectionId, number>>;
  adminName: string;
  roleLabel: string;
  onChangePassword: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}

export function PlatformShell({ section, isOwner, badges, adminName, roleLabel, onChangePassword, onLogout, children }: ShellProps) {
  const [open, setOpen] = useState(false);
  const current = GROUPS.flatMap((g) => g.items).find((i) => i.id === section);
  const today = new Date();

  const nav = (
    <div className="flex flex-col h-full">
      <div className="px-5 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <BrandMark size={44} tone="onDark" />
          <div className="min-w-0">
            <p className="font-display text-[22px] leading-tight font-bold text-najd-gold-light">{BRAND_NAME}</p>
            <p className="text-[11px] tracking-wide text-white/55">إدارة المنصة</p>
          </div>
        </div>
      </div>
      <SaduBand className="mx-5 opacity-80" />

      <nav className="flex-1 overflow-y-auto px-3 py-5 flex flex-col gap-5">
        {GROUPS.map((g) => {
          const items = g.items.filter((i) => !i.ownerOnly || isOwner);
          if (items.length === 0) return null;
          return (
            <div key={g.label}>
              <p className="px-3 mb-1.5 text-[11px] font-semibold tracking-widest text-najd-gold/80">{g.label}</p>
              <ul className="flex flex-col gap-0.5">
                {items.map((i) => {
                  const active = i.id === section;
                  const badge = badges?.[i.id];
                  return (
                    <li key={i.id}>
                      <Link
                        to={i.id === 'overview' ? '/platform' : `/platform/${i.id}`}
                        onClick={() => setOpen(false)}
                        className={`group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] transition-colors ${
                          active ? 'bg-white/10 text-najd-gold-light font-semibold' : 'text-white/75 hover:bg-white/5 hover:text-white'
                        }`}
                      >
                        {active && <span className="absolute right-0 top-2 bottom-2 w-1 rounded-l-full bg-najd-gold" />}
                        <i.icon size={18} className={active ? 'text-najd-gold' : 'text-white/50 group-hover:text-najd-gold-light'} />
                        <span className="flex-1">{i.label}</span>
                        {badge ? (
                          <span className="min-w-5 h-5 px-1.5 rounded-full bg-najd-gold text-najd-green-deep text-[11px] font-bold flex items-center justify-center">
                            {badge}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <SaduBand className="mx-5 opacity-60" />
      <div className="p-4">
        <div className="rounded-2xl bg-white/5 border border-white/10 p-3 flex items-center gap-3">
          <span className="w-10 h-10 rounded-full bg-najd-green-deep border border-najd-gold/60 text-najd-gold-light font-display text-lg font-bold flex items-center justify-center flex-shrink-0">
            {adminName.trim().charAt(0) || 'م'}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white truncate">{adminName}</p>
            <p className="text-[11px] text-najd-gold">{roleLabel}</p>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button onClick={onChangePassword} className="flex items-center justify-center gap-1.5 text-xs text-white/70 hover:text-white hover:bg-white/5 rounded-lg py-2">
            <KeyRound size={14} /> كلمة المرور
          </button>
          <button onClick={onLogout} className="flex items-center justify-center gap-1.5 text-xs text-white/70 hover:text-white hover:bg-white/5 rounded-lg py-2">
            <LogOut size={14} /> خروج
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="platform-root min-h-screen bg-najd-sand" dir="rtl">
      {/* desktop sidebar (right edge in RTL) */}
      <aside className="hidden lg:block fixed top-0 bottom-0 right-0 w-72 platform-sidebar z-30">{nav}</aside>

      {/* mobile drawer */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div className="w-72 platform-sidebar h-full shadow-2xl">{nav}</div>
          <div className="flex-1 bg-black/50" onClick={() => setOpen(false)} />
        </div>
      )}

      <div className="lg:mr-72 min-h-screen flex flex-col platform-ground">
        <header className="sticky top-0 z-20 bg-najd-paper/90 backdrop-blur border-b border-najd-line">
          <div className="px-5 lg:px-8 h-16 flex items-center gap-3">
            <button onClick={() => setOpen(true)} className="lg:hidden p-2 -mr-2 text-najd-ink" aria-label="القائمة">
              {open ? <X size={22} /> : <Menu size={22} />}
            </button>
            <div className="min-w-0">
              <h1 className="font-display text-[26px] leading-none font-bold text-najd-ink">{current?.label ?? 'لوحة المنصة'}</h1>
              <p className="text-xs text-najd-muted mt-1 truncate">{current?.hint}</p>
            </div>
            <div className="mr-auto text-left hidden sm:block">
              <p className="text-sm font-semibold text-najd-ink">{hijri(today)}</p>
              <p className="text-xs text-najd-muted">{gregorian(today)} م</p>
            </div>
          </div>
          <SaduBand tone="green" className="opacity-70" />
        </header>

        <main className="flex-1 px-5 lg:px-8 py-6 flex flex-col gap-6 max-w-[1280px] w-full">{children}</main>

        <footer className="px-8 py-5">
          <Ornament />
          <p className="text-center text-xs text-najd-muted mt-3">{BRAND_NAME} · لوحة إدارة المنصة · حلول الفنان</p>
        </footer>
      </div>
    </div>
  );
}
