import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, BarChart3, QrCode, GitBranch, Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import type { AxiosError } from 'axios';

const loginSchema = z.object({
  email: z.string().email('البريد الإلكتروني غير صحيح'),
  password: z.string().min(1, 'كلمة المرور مطلوبة'),
  rememberMe: z.boolean().optional(),
});

type LoginForm = z.infer<typeof loginSchema>;

interface QuickLoginChip {
  label: string;
  email: string;
  password: string;
  color: string;
}

const QUICK_LOGINS: QuickLoginChip[] = [
  { label: 'المدير العام', email: 'admin@store.com', password: '123456', color: 'bg-purple-100 text-purple-700 hover:bg-purple-200' },
  { label: 'مدير النظام', email: 'manager@store.com', password: '123456', color: 'bg-blue-100 text-blue-700 hover:bg-blue-200' },
  { label: 'المحاسب المالي', email: 'accountant@store.com', password: '123456', color: 'bg-green-100 text-green-700 hover:bg-green-200' },
  { label: 'أمين المخزن', email: 'storekeeper@store.com', password: '123456', color: 'bg-amber-100 text-amber-700 hover:bg-amber-200' },
  { label: 'كاشير', email: 'cashier@store.com', password: '123456', color: 'bg-rose-100 text-rose-700 hover:bg-rose-200' },
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const from = (location.state as { from?: { pathname: string } })?.from?.pathname ?? '/';

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', rememberMe: false },
  });

  const onSubmit = async (data: LoginForm) => {
    setServerError(null);
    try {
      await login({ email: data.email, password: data.password });
      navigate(from, { replace: true });
    } catch (err) {
      const axiosErr = err as AxiosError<{ message?: string }>;
      setServerError(
        axiosErr.response?.data?.message ?? 'فشل تسجيل الدخول. تحقق من البيانات وأعد المحاولة.'
      );
    }
  };

  const fillAndSubmit = (chip: QuickLoginChip) => {
    setValue('email', chip.email);
    setValue('password', chip.password);
    setServerError(null);
    // Submit after state update
    handleSubmit(onSubmit)();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-row-reverse">
        {/* RIGHT = Brand panel (teal gradient) */}
        <div className="hidden md:flex flex-col justify-between w-2/5 bg-gradient-to-b from-[#0b1f1d] to-[#103a35] p-8 text-white">
          <div>
            {/* Brand name */}
            <div className="mb-8">
              <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center mb-4">
                <span className="text-2xl font-bold text-white">ف</span>
              </div>
              <h1 className="text-xl font-bold leading-snug mb-2">
                نظام الفنان للتوريدات والمخازن
              </h1>
              <p className="text-white/60 text-sm">إدارة أعمالك باحترافية</p>
            </div>

            {/* Feature bullets */}
            <div className="flex flex-col gap-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-primary/20 rounded-lg flex-shrink-0 flex items-center justify-center mt-0.5">
                  <GitBranch size={16} className="text-primary-200" />
                </div>
                <div>
                  <p className="text-sm font-medium">إدارة الفروع والمستودعات</p>
                  <p className="text-xs text-white/50 mt-0.5">تحكم كامل بجميع المواقع</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-primary/20 rounded-lg flex-shrink-0 flex items-center justify-center mt-0.5">
                  <QrCode size={16} className="text-primary-200" />
                </div>
                <div>
                  <p className="text-sm font-medium">ملصقات الباركود و QR مخصصة</p>
                  <p className="text-xs text-white/50 mt-0.5">طباعة سريعة وسهلة</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-primary/20 rounded-lg flex-shrink-0 flex items-center justify-center mt-0.5">
                  <BarChart3 size={16} className="text-primary-200" />
                </div>
                <div>
                  <p className="text-sm font-medium">تقارير وتحليلات متطورة</p>
                  <p className="text-xs text-white/50 mt-0.5">قرارات مبنية على البيانات</p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <p className="text-xs text-white/40">
            إصدار 2.5 · © 2026 حلول الفنان
          </p>
        </div>

        {/* LEFT = Form panel */}
        <div className="flex-1 p-8 flex flex-col justify-center">
          <div className="max-w-sm mx-auto w-full">
            <h2 className="text-2xl font-bold text-app-text mb-1">أهلاً بك مجدداً!</h2>
            <p className="text-app-muted text-sm mb-8">سجل دخولك للمتابعة إلى النظام</p>

            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
              {/* Email */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-app-text">
                  البريد الإلكتروني
                </label>
                <input
                  type="email"
                  placeholder="admin@store.com"
                  autoComplete="email"
                  {...register('email')}
                  className="w-full border border-app-border rounded-lg px-3 py-2.5 text-sm text-app-text bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                />
                {errors.email && (
                  <p className="text-xs text-danger">{errors.email.message}</p>
                )}
              </div>

              {/* Password */}
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-app-text">
                  كلمة المرور
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••"
                    autoComplete="current-password"
                    {...register('password')}
                    className="w-full border border-app-border rounded-lg px-3 py-2.5 pl-10 text-sm text-app-text bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-app-muted hover:text-app-text"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-xs text-danger">{errors.password.message}</p>
                )}
              </div>

              {/* Remember me */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="rememberMe"
                  {...register('rememberMe')}
                  className="w-4 h-4 rounded border-app-border text-primary focus:ring-primary/30"
                />
                <label htmlFor="rememberMe" className="text-sm text-app-muted cursor-pointer">
                  تذكرني على هذا الجهاز
                </label>
              </div>

              {/* Server error */}
              {serverError && (
                <div className="bg-danger-bg border border-danger/20 text-danger text-sm rounded-lg px-4 py-3">
                  {serverError}
                </div>
              )}

              {/* Submit */}
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-primary hover:bg-primary-600 text-white font-semibold py-2.5 rounded-lg transition-colors duration-200 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed mt-1"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>جاري الدخول...</span>
                  </>
                ) : (
                  'دخول النظام'
                )}
              </button>
            </form>

            {/* Quick login chips — dev/demo only, never shipped in a production build */}
            {import.meta.env.DEV && (
              <div className="mt-6">
                <p className="text-xs text-app-muted mb-3 text-center">
                  تجربة سريعة للنظام بأدوار مختلفة:
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {QUICK_LOGINS.map((chip) => (
                    <button
                      key={chip.email}
                      type="button"
                      onClick={() => fillAndSubmit(chip)}
                      disabled={isSubmitting}
                      className={`text-xs font-medium px-3 py-1.5 rounded-full transition-colors cursor-pointer disabled:opacity-60 ${chip.color}`}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
