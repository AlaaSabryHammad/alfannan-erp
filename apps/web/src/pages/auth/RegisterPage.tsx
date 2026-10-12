import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import type { AxiosError } from 'axios';
import { useAuth } from '../../contexts/AuthContext';
import { BrandLockup } from '../../components/BrandLogo';

const registerSchema = z
  .object({
    companyName: z.string().trim().min(2, 'اسم الشركة قصير جدًا').max(100),
    adminName: z.string().trim().min(2, 'اسم المدير قصير جدًا').max(100),
    email: z.string().trim().email('البريد الإلكتروني غير صحيح'),
    password: z.string().min(8, 'كلمة المرور يجب ألا تقل عن 8 أحرف').max(128),
    confirm: z.string(),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'يجب الموافقة على الشروط وسياسة الخصوصية للمتابعة' }) }),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'كلمتا المرور غير متطابقتين' });

type RegisterForm = z.infer<typeof registerSchema>;

const inputClass =
  'w-full border border-app-border rounded-lg px-3 py-2.5 text-sm text-app-text bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors';

export function RegisterPage() {
  const { registerCompany } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async ({ confirm: _confirm, ...data }: RegisterForm) => {
    setServerError(null);
    try {
      await registerCompany(data);
      navigate('/', { replace: true });
    } catch (err) {
      const e = err as AxiosError<{ error?: string }>;
      setServerError(e.response?.data?.error ?? 'تعذّر إنشاء الشركة. حاول مرة أخرى.');
    }
  };

  const field = (label: string, name: keyof RegisterForm, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-app-text">{label}</label>
      <input {...register(name)} {...props} className={inputClass} />
      {errors[name] && <p className="text-xs text-danger">{errors[name]?.message as string}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
        <div className="mb-4">
          <BrandLockup size={44} />
        </div>
        <h1 className="text-2xl font-bold text-app-text mb-1">أنشئ شركتك</h1>
        <p className="text-app-muted text-sm mb-6">
          حساب جديد بدليل حسابات وصلاحيات جاهزة — تبدأ العمل خلال دقيقة.
        </p>

        <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4">
          {field('اسم الشركة', 'companyName', { placeholder: 'مثال: شركة النور للتجارة' })}
          {field('اسم المدير', 'adminName', { autoComplete: 'name' })}
          {field('البريد الإلكتروني', 'email', { type: 'email', autoComplete: 'email', dir: 'ltr' })}

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-app-text">كلمة المرور</label>
            <div className="relative">
              <input
                {...register('password')}
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                className={`${inputClass} pl-10`}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-app-muted hover:text-app-text"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password && <p className="text-xs text-danger">{errors.password.message}</p>}
          </div>

          {field('تأكيد كلمة المرور', 'confirm', {
            type: showPassword ? 'text' : 'password',
            autoComplete: 'new-password',
          })}

          <div className="flex flex-col gap-1">
            <label className="flex items-start gap-2 text-sm text-app-text cursor-pointer">
              <input type="checkbox" {...register('acceptTerms')} className="mt-1 w-4 h-4 rounded border-app-border" />
              <span>
                أوافق على{' '}
                <Link to="/terms" target="_blank" className="text-primary font-semibold hover:underline">شروط الاستخدام</Link>
                {' '}و{' '}
                <Link to="/privacy" target="_blank" className="text-primary font-semibold hover:underline">سياسة الخصوصية</Link>
              </span>
            </label>
            {errors.acceptTerms && <p className="text-xs text-danger">{errors.acceptTerms.message as string}</p>}
          </div>

          {serverError && (
            <div className="bg-danger-bg border border-danger/20 text-danger text-sm rounded-lg px-4 py-3">
              {serverError}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-primary hover:bg-primary-600 text-white font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>جاري إنشاء الشركة...</span>
              </>
            ) : (
              'إنشاء الشركة'
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-app-muted">
          لديك حساب بالفعل؟{' '}
          <Link to="/login" className="text-primary font-semibold hover:underline">
            تسجيل الدخول
          </Link>
        </p>
      </div>
    </div>
  );
}
