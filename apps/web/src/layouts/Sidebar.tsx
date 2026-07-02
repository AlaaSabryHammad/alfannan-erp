import { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Package,
  Layers,
  Tag,
  Ruler,
  Warehouse,
  BarChart2,
  ArrowLeftRight,
  QrCode,
  ShoppingCart,
  Users,
  FileText,
  Truck,
  Receipt,
  HandCoins,
  BookOpen,
  TrendingUp,
  Bell,
  Settings,
  UserCog,
  Shield,
  ScrollText,
  Wallet,
  Banknote,
  Building2,
  Users2,
  BadgeDollarSign,
  ChevronDown,
  ChevronLeft,
  Repeat,
  ClipboardCheck,
  Factory,
  Ticket,
  Network,
  GitBranch,
  Undo2,
  RotateCcw,
} from 'lucide-react';
import { cn } from '../lib/utils';

interface NavItem {
  label: string;
  path: string;
  icon: React.ReactNode;
  highlight?: 'orange';
}

interface NavGroup {
  label: string;
  items: NavItem[];
  defaultOpen?: boolean;
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'الرئيسية والتحليلات',
    defaultOpen: true,
    items: [
      { label: 'لوحة التحكم', path: '/', icon: <LayoutDashboard size={17} /> },
    ],
  },
  {
    label: 'المخزون والأصناف',
    defaultOpen: true,
    items: [
      { label: 'الأصناف', path: '/products', icon: <Package size={17} /> },
      { label: 'الأقسام', path: '/departments', icon: <Layers size={17} /> },
      { label: 'العلامات التجارية', path: '/brands', icon: <Tag size={17} /> },
      { label: 'وحدات القياس', path: '/units', icon: <Ruler size={17} /> },
      { label: 'المستودعات', path: '/warehouses', icon: <Warehouse size={17} /> },
      { label: 'رصيد المخزون', path: '/stock', icon: <BarChart2 size={17} /> },
      { label: 'تحويل المخزون', path: '/stock-transfer', icon: <ArrowLeftRight size={17} /> },
      { label: 'الجرد المخزني', path: '/stock-count', icon: <ClipboardCheck size={17} /> },
      { label: 'ملصقات الباركود والـQR', path: '/barcode-labels', icon: <QrCode size={17} /> },
    ],
  },
  {
    label: 'المبيعات والمشتريات',
    defaultOpen: true,
    items: [
      { label: 'شاشة POS السريعة', path: '/pos', icon: <ShoppingCart size={17} />, highlight: 'orange' },
      { label: 'العملاء', path: '/customers', icon: <Users size={17} /> },
      { label: 'فواتير البيع', path: '/sales-invoices', icon: <FileText size={17} /> },
      { label: 'مرتجعات المبيعات', path: '/sales-returns', icon: <Undo2 size={17} /> },
      { label: 'الموردون', path: '/suppliers', icon: <Truck size={17} /> },
      { label: 'فواتير الشراء', path: '/purchase-invoices', icon: <Receipt size={17} /> },
      { label: 'مرتجعات المشتريات', path: '/purchase-returns', icon: <RotateCcw size={17} /> },
      { label: 'كوبونات الخصم', path: '/coupons', icon: <Ticket size={17} /> },
    ],
  },
  {
    label: 'الحسابات والشركاء',
    defaultOpen: false,
    items: [
      { label: 'نظام الشركاء (حقوق الملكية)', path: '/partners', icon: <HandCoins size={17} /> },
      { label: 'الحسابات العامة', path: '/accounts', icon: <BookOpen size={17} /> },
      { label: 'دفتر اليومية', path: '/journal', icon: <FileText size={17} /> },
      { label: 'مراكز التكلفة', path: '/cost-centers', icon: <Layers size={17} /> },
      { label: 'الموازنات التقديرية', path: '/budgets', icon: <TrendingUp size={17} /> },
      { label: 'القيود المتكررة', path: '/recurring-entries', icon: <Repeat size={17} /> },
      { label: 'اعتماد القيود', path: '/journal-approvals', icon: <Shield size={17} /> },
    ],
  },
  {
    label: 'الخزينة والسندات',
    defaultOpen: false,
    items: [
      { label: 'السندات', path: '/vouchers', icon: <Wallet size={17} /> },
      { label: 'الكمبيالات والشيكات', path: '/promissory-notes', icon: <Banknote size={17} /> },
      { label: 'حركة الصندوق', path: '/cash-movement', icon: <ArrowLeftRight size={17} /> },
    ],
  },
  {
    label: 'التصنيع',
    defaultOpen: false,
    items: [
      { label: 'قوائم المكونات (BOM)', path: '/bom', icon: <Layers size={17} /> },
      { label: 'أوامر التصنيع', path: '/work-orders', icon: <Factory size={17} /> },
    ],
  },
  {
    label: 'الأصول الثابتة',
    defaultOpen: false,
    items: [
      { label: 'الأصول الثابتة والإهلاك', path: '/assets', icon: <Building2 size={17} /> },
    ],
  },
  {
    label: 'الموارد البشرية',
    defaultOpen: false,
    items: [
      { label: 'الموظفون', path: '/employees', icon: <Users2 size={17} /> },
      { label: 'الرواتب', path: '/payroll', icon: <BadgeDollarSign size={17} /> },
      { label: 'الهيكل التنظيمي', path: '/org-chart', icon: <Network size={17} /> },
    ],
  },
  {
    label: 'الإدارة والتقارير',
    defaultOpen: false,
    items: [
      { label: 'تقارير النظام', path: '/reports', icon: <TrendingUp size={17} /> },
      { label: 'سجل التنبيهات', path: '/alerts', icon: <Bell size={17} /> },
      { label: 'الفروع ومزامنة البيانات', path: '/branches', icon: <GitBranch size={17} /> },
      { label: 'سجل التدقيق', path: '/audit', icon: <ScrollText size={17} /> },
      { label: 'الإعدادات', path: '/settings', icon: <Settings size={17} /> },
      { label: 'المستخدمون', path: '/users', icon: <UserCog size={17} /> },
      { label: 'الأدوار والصلاحيات', path: '/roles', icon: <Shield size={17} /> },
    ],
  },
];

function LiveClock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <span className="text-white/50 text-xs font-mono tabular-nums">
      {time.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}

interface NavGroupComponentProps {
  group: NavGroup;
  currentPath: string;
}

function NavGroupComponent({ group, currentPath }: NavGroupComponentProps) {
  const hasActive = group.items.some(
    (item) => item.path === '/' ? currentPath === '/' : currentPath.startsWith(item.path)
  );
  const [open, setOpen] = useState(group.defaultOpen ?? hasActive);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-white/40 hover:text-white/60 transition-colors"
      >
        <span className="text-[10px] font-semibold uppercase tracking-widest">{group.label}</span>
        <ChevronDown
          size={13}
          className={cn('transition-transform duration-200', open ? 'rotate-0' : '-rotate-90')}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-0.5 mb-2">
          {group.items.map((item) => (
            <NavItemComponent key={item.path} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}

function NavItemComponent({ item }: { item: NavItem }) {
  const isPos = item.highlight === 'orange';

  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 mx-1',
          isPos && isActive
            ? 'bg-accent text-white'
            : isPos
            ? 'text-accent hover:bg-accent/10'
            : isActive
            ? 'bg-primary text-white'
            : 'text-white/70 hover:bg-white/10 hover:text-white'
        )
      }
    >
      <span className="flex-shrink-0">{item.icon}</span>
      <span className="truncate">{item.label}</span>
      {isPos && (
        <ChevronLeft size={13} className="mr-auto flex-shrink-0 opacity-70" />
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const { pathname } = useLocation();

  return (
    <aside className="w-64 flex-shrink-0 h-screen sticky top-0 flex flex-col bg-gradient-to-b from-[#0b1f1d] to-[#103a35] overflow-hidden">
      {/* Brand block */}
      <div className="px-4 py-5 border-b border-white/10">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-lg">ف</span>
          </div>
          <div className="min-w-0">
            <p className="text-white font-bold text-sm leading-tight truncate">الفنان للتوريدات</p>
            <p className="text-white/50 text-xs truncate">لوحة التحكم الإدارية</p>
          </div>
        </div>
        <div className="flex items-center justify-between">
          <span className="bg-white/10 text-white/60 text-[10px] px-2 py-0.5 rounded-full">v2.5.0</span>
          <LiveClock />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-1 flex flex-col gap-1">
        {NAV_GROUPS.map((group) => (
          <NavGroupComponent key={group.label} group={group} currentPath={pathname} />
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/10">
        <p className="text-white/30 text-[10px] text-center">
          © 2026 نظام الفنان · حلول الفنان
        </p>
      </div>
    </aside>
  );
}
