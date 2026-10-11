import { Link } from 'react-router-dom';
import { AlertTriangle, Clock } from 'lucide-react';
import { daysLabel, useSubscription } from '../hooks/useSubscription';

/** Shown above every page when the trial/subscription needs attention. Hidden when all is well. */
export function SubscriptionBanner() {
  const { data } = useSubscription();
  if (!data) return null;

  let tone: 'warn' | 'danger' | null = null;
  let text = '';

  if (data.readOnly) {
    tone = 'danger';
    text =
      data.status === 'CANCELED'
        ? 'تم إلغاء اشتراك شركتك — النظام في وضع القراءة فقط.'
        : 'انتهى اشتراك شركتك — النظام في وضع القراءة فقط. جدّد الاشتراك لمتابعة العمل.';
  } else if (data.status === 'PAST_DUE') {
    tone = 'danger';
    text = 'انتهت فترة اشتراكك وأنت الآن في فترة السماح. جدّد قبل أن يتحول النظام لوضع القراءة فقط.';
  } else if (data.status === 'TRIALING' && data.daysLeft !== null && data.daysLeft <= 7) {
    tone = 'warn';
    text = `تنتهي فترتك التجريبية خلال ${daysLabel(Math.max(data.daysLeft, 0))}. اختر باقتك لتستمر دون انقطاع.`;
  } else if (data.status === 'ACTIVE' && data.daysLeft !== null && data.daysLeft <= 7) {
    tone = 'warn';
    text = `ينتهي اشتراكك خلال ${daysLabel(Math.max(data.daysLeft, 0))}.`;
  }

  if (!tone) return null;

  const cls =
    tone === 'danger'
      ? 'bg-red-50 border-red-200 text-red-800'
      : 'bg-amber-50 border-amber-200 text-amber-900';
  const Icon = tone === 'danger' ? AlertTriangle : Clock;

  return (
    <div className={`border-b px-6 py-2.5 text-sm flex items-center gap-3 ${cls}`}>
      <Icon size={16} className="flex-shrink-0" />
      <span className="flex-1">{text}</span>
      <Link to="/subscription" className="font-semibold underline whitespace-nowrap">
        إدارة الاشتراك
      </Link>
    </div>
  );
}
