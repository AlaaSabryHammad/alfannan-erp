import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Settings, Building2, DollarSign, Package, Layout, Gift, MessageCircle, ShieldCheck } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { usePermission } from '../../contexts/AuthContext';
import { getApiErrorMessage } from '../../lib/utils';
import apiClient from '../../lib/api';

// ─── Types & Schema ────────────────────────────────────────────────────────────
const settingsSchema = z.object({
  companyName: z.string().min(1, 'اسم الشركة مطلوب'),
  companyPhone: z.string().optional(),
  companyAddress: z.string().optional(),
  currency: z.string().min(1, 'العملة مطلوبة'),
  taxRate: z.string().optional(),
  vatNumber: z.string().optional()
    .refine((v) => !v || /^\d{15}$/.test(v), 'الرقم الضريبي يجب أن يكون 15 رقمًا'),
  crNumber: z.string().optional(),
  logoUrl: z.string().url('رابط الشعار غير صحيح').optional().or(z.literal('')),
  lowStockThreshold: z.string().optional(),
  itemsPerPage: z.string().optional(),
  loyaltyEnabled: z.string().optional(),
  loyaltyEarnRate: z.string().optional(),
  loyaltyPointValue: z.string().optional(),
  whatsappEnabled: z.string().optional(),
  whatsappApiUrl: z.string().optional(),
  whatsappApiToken: z.string().optional(),
  whatsappSenderId: z.string().optional(),
  smsEnabled: z.string().optional(),
  smsApiUrl: z.string().optional(),
  smsApiKey: z.string().optional(),
  smsSenderId: z.string().optional(),
  notificationAdminPhone: z.string().optional(),
  zatcaEnabled: z.string().optional(),
  zatcaEnvironment: z.string().optional(),
  zatcaApiBaseUrl: z.string().optional(),
  zatcaBinarySecurityToken: z.string().optional(),
  zatcaSecret: z.string().optional(),
  sellerVatNumber: z.string().optional()
    .refine((v) => !v || /^\d{15}$/.test(v), 'الرقم الضريبي يجب أن يكون 15 رقمًا'),
  sellerName: z.string().optional(),
  enableNotifications: z.boolean().optional(),
  enableAutoBackup: z.boolean().optional(),
});

type SettingsFormValues = z.infer<typeof settingsSchema>;

// Keys we send to the API (subset that the backend stores)
const API_KEYS = [
  'companyName', 'currency', 'taxRate', 'vatNumber', 'crNumber', 'logoUrl', 'lowStockThreshold', 'itemsPerPage',
  'loyaltyEnabled', 'loyaltyEarnRate', 'loyaltyPointValue',
  'whatsappEnabled', 'whatsappApiUrl', 'whatsappApiToken', 'whatsappSenderId',
  'smsEnabled', 'smsApiUrl', 'smsApiKey', 'smsSenderId', 'notificationAdminPhone',
  'zatcaEnabled', 'zatcaEnvironment', 'zatcaApiBaseUrl', 'zatcaBinarySecurityToken', 'zatcaSecret', 'sellerVatNumber', 'sellerName',
] as const;

const defaultSettings: SettingsFormValues = {
  companyName: 'الفنان للتوريدات العمومية',
  companyPhone: '',
  companyAddress: '',
  currency: 'ر.س',
  taxRate: '15',
  vatNumber: '',
  crNumber: '',
  logoUrl: '',
  lowStockThreshold: '10',
  itemsPerPage: '10',
  loyaltyEnabled: 'true',
  loyaltyEarnRate: '0.1',
  loyaltyPointValue: '0.05',
  whatsappEnabled: 'false',
  whatsappApiUrl: '',
  whatsappApiToken: '',
  whatsappSenderId: '',
  smsEnabled: 'false',
  smsApiUrl: '',
  smsApiKey: '',
  smsSenderId: '',
  notificationAdminPhone: '',
  zatcaEnabled: 'false',
  zatcaEnvironment: 'sandbox',
  zatcaApiBaseUrl: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  zatcaBinarySecurityToken: '',
  zatcaSecret: '',
  sellerVatNumber: '',
  sellerName: 'الفنان للتوريدات العمومية',
  enableNotifications: true,
  enableAutoBackup: false,
};

// ─── Toast ────────────────────────────────────────────────────────────────────
function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// ─── Section Card ─────────────────────────────────────────────────────────────
function SectionCard({ icon, title, subtitle, children }: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card padding="none" className="p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <div>
          <h3 className="font-bold text-app-text">{title}</h3>
          {subtitle && <p className="text-xs text-app-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {children}
    </Card>
  );
}

// ─── API ──────────────────────────────────────────────────────────────────────
interface SettingsApiResponse {
  companyName?: string;
  currency?: string;
  taxRate?: string;
  vatNumber?: string;
  crNumber?: string;
  logoUrl?: string;
  lowStockThreshold?: string;
  itemsPerPage?: string;
  loyaltyEnabled?: string;
  loyaltyEarnRate?: string;
  loyaltyPointValue?: string;
  [key: string]: string | undefined;
}

const fetchSettings = async (): Promise<SettingsApiResponse> => {
  const res = await apiClient.get<SettingsApiResponse>('/settings');
  return res.data;
};

// ─── Main Component ────────────────────────────────────────────────────────────
export function SettingsPage() {
  const qc = useQueryClient();
  const canEdit = usePermission('settings.edit');

  const { data: apiSettings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
  });

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isDirty },
  } = useForm<SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: defaultSettings,
  });

  // Populate form once API data arrives
  useEffect(() => {
    if (apiSettings) {
      const merged = { ...defaultSettings } as Record<string, string | boolean>;
      for (const key of API_KEYS) {
        if (apiSettings[key] !== undefined) merged[key] = apiSettings[key] as string;
      }
      reset(merged as SettingsFormValues);
    }
  }, [apiSettings, reset]);

  const saveMutation = useMutation({
    mutationFn: async (values: SettingsFormValues) => {
      // Only send keys the backend recognises
      const payload: Record<string, string> = {};
      for (const key of API_KEYS) {
        const v = values[key];
        if (v !== undefined && v !== null) {
          payload[key] = String(v);
        }
      }
      const res = await apiClient.put<SettingsApiResponse>('/settings', payload);
      return res.data;
    },
    onSuccess: (merged) => {
      qc.setQueryData(['settings'], merged);
      toast('تم حفظ الإعدادات بنجاح');
    },
    onError: (err) => {
      toast(getApiErrorMessage(err, 'حدث خطأ أثناء حفظ الإعدادات'), 'error');
    },
  });

  const onSubmit = (values: SettingsFormValues) => {
    saveMutation.mutate(values);
  };

  const onReset = () => {
    reset(defaultSettings);
    toast('تم إعادة ضبط الإعدادات إلى القيم الافتراضية (لم تُحفظ بعد)');
  };

  if (isLoading) {
    return (
      <div>
        <PageHeader title="إعدادات النظام" subtitle="ضبط معلومات الشركة والتفضيلات العامة للنظام" />
        <div className="flex items-center justify-center py-20">
          <span className="inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="إعدادات النظام"
        subtitle="ضبط معلومات الشركة والتفضيلات العامة للنظام"
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onReset} size="sm">إعادة الضبط</Button>
            <Button
              icon={<Settings size={16} />}
              onClick={handleSubmit(onSubmit)}
              loading={saveMutation.isPending}
              disabled={!canEdit || (!isDirty && !saveMutation.isIdle)}
            >
              {saveMutation.isSuccess ? 'تم الحفظ ✓' : 'حفظ الإعدادات'}
            </Button>
          </div>
        }
      />

      {!canEdit && (
        <div className="mb-4 bg-warning-bg border border-warning rounded-xl px-4 py-3 text-sm text-warning font-medium">
          أنت في وضع القراءة فقط — ليس لديك صلاحية تعديل الإعدادات
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Company Info */}
        <SectionCard icon={<Building2 size={20} className="text-primary" />} title="بيانات الشركة" subtitle="الاسم والمعلومات الأساسية للمنشأة">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="اسم الشركة"
              required
              placeholder="الفنان للتوريدات العمومية"
              {...register('companyName')}
              error={errors.companyName?.message}
              disabled={!canEdit}
            />
            <Input
              label="رقم الهاتف"
              placeholder="05xxxxxxxx"
              {...register('companyPhone')}
              error={errors.companyPhone?.message}
              disabled={!canEdit}
            />
            <Input
              label="العنوان"
              placeholder="الرياض، المملكة العربية السعودية"
              {...register('companyAddress')}
              error={errors.companyAddress?.message}
              className="md:col-span-2"
              disabled={!canEdit}
            />
            <Input
              label="الرقم الضريبي (VAT)"
              placeholder="3xxxxxxxxxxxxx3"
              maxLength={15}
              {...register('vatNumber')}
              error={errors.vatNumber?.message}
              disabled={!canEdit}
            />
            <Input
              label="رقم السجل التجاري (CR)"
              placeholder="10xxxxxxxx"
              {...register('crNumber')}
              error={errors.crNumber?.message}
              disabled={!canEdit}
            />
            <Input
              label="رابط الشعار (URL)"
              placeholder="https://example.com/logo.png"
              {...register('logoUrl')}
              error={errors.logoUrl?.message}
              className="md:col-span-2"
              disabled={!canEdit}
            />
          </div>
        </SectionCard>

        {/* Financial Settings */}
        <SectionCard icon={<DollarSign size={20} className="text-primary" />} title="الإعدادات المالية" subtitle="العملة ونسبة الضريبة">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="العملة"
              required
              placeholder="ر.س"
              {...register('currency')}
              error={errors.currency?.message}
              disabled={!canEdit}
            />
            <Input
              label="نسبة ضريبة القيمة المضافة (%)"
              type="number"
              step="0.1"
              min="0"
              max="100"
              placeholder="15"
              {...register('taxRate')}
              error={errors.taxRate?.message}
              disabled={!canEdit}
            />
          </div>
          <div className="mt-4 p-4 bg-primary-50 rounded-xl text-sm text-primary">
            <p className="font-medium">ملاحظة:</p>
            <p className="text-xs mt-1 text-primary/80">نسبة الضريبة تُطبَّق تلقائياً على فواتير المبيعات والمشتريات الجديدة عند إنشائها.</p>
          </div>
        </SectionCard>

        {/* Inventory Settings */}
        <SectionCard icon={<Package size={20} className="text-primary" />} title="إعدادات المخزون" subtitle="تفضيلات تتبع الأصناف والتنبيهات">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="حد التنبيه للمخزون المنخفض"
              type="number"
              min="0"
              placeholder="10"
              {...register('lowStockThreshold')}
              error={errors.lowStockThreshold?.message}
              disabled={!canEdit}
            />
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-app-text">وصف الحد</label>
              <p className="text-xs text-app-muted bg-gray-50 rounded-lg px-3 py-2.5 border border-app-border">
                عند وصول رصيد أي صنف إلى هذا الحد أو أقل، تظهر تنبيهات في لوحة التقارير وسجل التنبيهات.
              </p>
            </div>
          </div>
        </SectionCard>

        {/* Display Settings */}
        <SectionCard icon={<Layout size={20} className="text-primary" />} title="إعدادات العرض" subtitle="تفضيلات واجهة المستخدم">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-app-text">عدد السجلات في الصفحة</label>
              <select
                {...register('itemsPerPage')}
                disabled={!canEdit}
                className="w-full rounded-lg border border-app-border px-3 py-2 text-sm text-app-text bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-gray-50 disabled:text-app-muted"
              >
                <option value="10">10 سجلات</option>
                <option value="25">25 سجلاً</option>
                <option value="50">50 سجلاً</option>
                <option value="100">100 سجل</option>
              </select>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                {...register('enableNotifications')}
                disabled={!canEdit}
                className="w-4 h-4 rounded accent-primary"
              />
              <div>
                <p className="text-sm font-medium text-app-text group-hover:text-primary transition-colors">تفعيل الإشعارات</p>
                <p className="text-xs text-app-muted">عرض إشعارات التنبيه لنقص المخزون والفواتير غير المسددة</p>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                {...register('enableAutoBackup')}
                disabled={!canEdit}
                className="w-4 h-4 rounded accent-primary"
              />
              <div>
                <p className="text-sm font-medium text-app-text group-hover:text-primary transition-colors">النسخ الاحتياطي التلقائي</p>
                <p className="text-xs text-app-muted">حفظ نسخة احتياطية تلقائية يومياً (يتطلب تهيئة الخادم)</p>
              </div>
            </label>
          </div>
        </SectionCard>

        {/* Loyalty Points Settings */}
        <SectionCard icon={<Gift size={20} className="text-primary" />} title="نقاط الولاء" subtitle="مكافأة العملاء بنقاط عند كل عملية بيع، تُستبدل كخصم في عمليات لاحقة">
          <label className="flex items-center gap-3 cursor-pointer group mb-4">
            <input
              type="checkbox"
              checked={watch('loyaltyEnabled') === 'true'}
              onChange={(e) => setValue('loyaltyEnabled', e.target.checked ? 'true' : 'false', { shouldDirty: true })}
              disabled={!canEdit}
              className="w-4 h-4 rounded accent-primary"
            />
            <div>
              <p className="text-sm font-medium text-app-text group-hover:text-primary transition-colors">تفعيل نظام نقاط الولاء</p>
              <p className="text-xs text-app-muted">عند التفعيل، يكتسب العملاء نقاطاً تلقائياً مع كل فاتورة بيع</p>
            </div>
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="معدّل الكسب (نقطة لكل 1 ريال)"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.1"
              {...register('loyaltyEarnRate')}
              disabled={!canEdit || watch('loyaltyEnabled') !== 'true'}
            />
            <Input
              label="قيمة النقطة عند الاستبدال (ريال)"
              type="number"
              step="0.01"
              min="0"
              placeholder="0.05"
              {...register('loyaltyPointValue')}
              disabled={!canEdit || watch('loyaltyEnabled') !== 'true'}
            />
          </div>
          <div className="mt-4 p-4 bg-primary-50 rounded-xl text-sm text-primary">
            <p className="text-xs text-primary/80">
              مثال: بمعدّل 0.1 نقطة/ريال، فاتورة بقيمة 100 ريال تمنح 10 نقاط. بقيمة استبدال 0.05 ريال/نقطة، فإن 10 نقاط تساوي 0.5 ريال خصم.
            </p>
          </div>
        </SectionCard>

        {/* WhatsApp & SMS Notifications */}
        <SectionCard icon={<MessageCircle size={20} className="text-primary" />} title="واتساب والرسائل النصية" subtitle="أرقام ومفاتيح مزود الخدمة — قابلة للتغيير في أي وقت دون تعديل الكود">
          <div className="space-y-5">
            <div>
              <label className="flex items-center gap-3 cursor-pointer group mb-3">
                <input
                  type="checkbox"
                  checked={watch('whatsappEnabled') === 'true'}
                  onChange={(e) => setValue('whatsappEnabled', e.target.checked ? 'true' : 'false', { shouldDirty: true })}
                  disabled={!canEdit}
                  className="w-4 h-4 rounded accent-primary"
                />
                <p className="text-sm font-medium text-app-text group-hover:text-primary transition-colors">تفعيل إرسال واتساب</p>
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="رابط API لواتساب"
                  placeholder="https://graph.facebook.com/v20.0/<phone-number-id>/messages"
                  {...register('whatsappApiUrl')}
                  disabled={!canEdit || watch('whatsappEnabled') !== 'true'}
                />
                <Input
                  label="مفتاح الاعتماد (Token)"
                  type="password"
                  {...register('whatsappApiToken')}
                  disabled={!canEdit || watch('whatsappEnabled') !== 'true'}
                />
                <Input
                  label="رقم/مُعرّف المُرسل (اختياري)"
                  placeholder="رقم جوال واتساب الخاص بالمنشأة"
                  {...register('whatsappSenderId')}
                  disabled={!canEdit || watch('whatsappEnabled') !== 'true'}
                />
                <Input
                  label="جوال المسؤول لاستقبال تنبيهات المخزون"
                  placeholder="+9665xxxxxxxx"
                  {...register('notificationAdminPhone')}
                  disabled={!canEdit}
                />
              </div>
            </div>

            <div className="border-t border-app-border pt-4">
              <label className="flex items-center gap-3 cursor-pointer group mb-3">
                <input
                  type="checkbox"
                  checked={watch('smsEnabled') === 'true'}
                  onChange={(e) => setValue('smsEnabled', e.target.checked ? 'true' : 'false', { shouldDirty: true })}
                  disabled={!canEdit}
                  className="w-4 h-4 rounded accent-primary"
                />
                <p className="text-sm font-medium text-app-text group-hover:text-primary transition-colors">تفعيل إرسال رسائل نصية (SMS)</p>
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Input
                  label="رابط API للرسائل النصية"
                  {...register('smsApiUrl')}
                  disabled={!canEdit || watch('smsEnabled') !== 'true'}
                />
                <Input
                  label="مفتاح API"
                  type="password"
                  {...register('smsApiKey')}
                  disabled={!canEdit || watch('smsEnabled') !== 'true'}
                />
                <Input
                  label="اسم/رقم المُرسل (Sender ID)"
                  {...register('smsSenderId')}
                  disabled={!canEdit || watch('smsEnabled') !== 'true'}
                />
              </div>
            </div>
          </div>
          <div className="mt-4 p-4 bg-primary-50 rounded-xl text-sm text-primary">
            <p className="text-xs text-primary/80">
              متوافق مع أي مزود يقبل طلبات HTTP بمفتاح Bearer، بما فيها واتساب Cloud API الرسمي من Meta. لا حاجة لتعديل الكود عند تغيير المزود أو الأرقام — فقط حدّث القيم هنا.
            </p>
          </div>
        </SectionCard>

        {/* ZATCA Phase 2 */}
        <SectionCard icon={<ShieldCheck size={20} className="text-primary" />} title="الفوترة الإلكترونية — المرحلة الثانية (ZATCA)" subtitle="ربط ومصادقة الفواتير مع هيئة الزكاة والضريبة والجمارك">
          <label className="flex items-center gap-3 cursor-pointer group mb-4">
            <input
              type="checkbox"
              checked={watch('zatcaEnabled') === 'true'}
              onChange={(e) => setValue('zatcaEnabled', e.target.checked ? 'true' : 'false', { shouldDirty: true })}
              disabled={!canEdit}
              className="w-4 h-4 rounded accent-primary"
            />
            <div>
              <p className="text-sm font-medium text-app-text group-hover:text-primary transition-colors">تفعيل إرسال الفواتير لهيئة الزكاة</p>
              <p className="text-xs text-app-muted">يتطلب شهادة اعتماد (CSID) حقيقية من بوابة "فاتورة" — بدونها ستبقى الفواتير بحالة "غير مُهيّأة"</p>
            </div>
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-app-text">البيئة</label>
              <select
                {...register('zatcaEnvironment')}
                disabled={!canEdit}
                className="w-full rounded-lg border border-app-border px-3 py-2 text-sm text-app-text bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:bg-gray-50 disabled:text-app-muted"
              >
                <option value="sandbox">بيئة المطورين (Sandbox)</option>
                <option value="simulation">بيئة المحاكاة (Simulation)</option>
                <option value="production">بيئة الإنتاج (Production)</option>
              </select>
            </div>
            <Input
              label="الاسم الرسمي للمنشأة (البائع)"
              {...register('sellerName')}
              disabled={!canEdit}
            />
            <Input
              label="الرقم الضريبي للمنشأة"
              placeholder="15 رقمًا"
              {...register('sellerVatNumber')}
              error={errors.sellerVatNumber?.message}
              disabled={!canEdit}
            />
            <Input
              label="رابط API لهيئة الزكاة"
              {...register('zatcaApiBaseUrl')}
              disabled={!canEdit}
            />
            <Input
              label="شهادة الاعتماد (CSID / Binary Security Token)"
              type="password"
              {...register('zatcaBinarySecurityToken')}
              disabled={!canEdit}
            />
            <Input
              label="السر المشترك (Secret)"
              type="password"
              {...register('zatcaSecret')}
              disabled={!canEdit}
            />
          </div>
          <div className="mt-4 p-4 bg-warning-bg rounded-xl text-sm text-warning">
            <p className="text-xs">
              للحصول على شهادة اعتماد حقيقية: سجّل في بوابة "فاتورة" التابعة لهيئة الزكاة والضريبة والجمارك، أصدر طلب اعتماد (CSR)، واحصل على شهادة الامتثال (Compliance CSID) ثم شهادة الإنتاج (Production CSID). أدخل القيم هنا فقط — لا حاجة لتعديل أي كود بعد ذلك.
            </p>
          </div>
        </SectionCard>

        {/* Save button at bottom */}
        {canEdit && (
          <div className="flex justify-end">
            <Button
              size="lg"
              icon={<Settings size={18} />}
              onClick={handleSubmit(onSubmit)}
              loading={saveMutation.isPending}
            >
              حفظ جميع الإعدادات
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
