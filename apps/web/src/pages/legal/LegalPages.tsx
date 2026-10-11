import { Link } from 'react-router-dom';
import { ArrowRight, ScrollText, ShieldCheck } from 'lucide-react';
import {
  LEGAL_ENTITY,
  LEGAL_UPDATED_AR,
  LEGAL_VERSION,
  PRIVACY,
  TERMS,
  type LegalDocument,
} from './legalContent';

function LegalLayout({ doc, other, icon }: { doc: LegalDocument; other: { to: string; label: string }; icon: 'terms' | 'privacy' }) {
  const Icon = icon === 'terms' ? ScrollText : ShieldCheck;
  return (
    <div className="min-h-screen bg-slate-50" dir="rtl">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-3xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link to="/login" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
            <ArrowRight size={16} /> العودة
          </Link>
          <span className="mr-auto text-sm font-semibold text-slate-800">{LEGAL_ENTITY}</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-10">
          <div className="flex items-center gap-3 mb-2">
            <span className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
              <Icon size={20} />
            </span>
            <h1 className="text-2xl font-bold text-slate-900">{doc.title}</h1>
          </div>
          <p className="text-xs text-slate-500 mb-6">آخر تحديث: {LEGAL_UPDATED_AR} · النسخة {LEGAL_VERSION}</p>

          <p className="text-sm leading-7 text-slate-700 mb-8">{doc.intro}</p>

          <nav className="mb-8 rounded-lg bg-slate-50 border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-500 mb-2">المحتويات</p>
            <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1">
              {doc.sections.map((s) => (
                <li key={s.id}>
                  <a href={'#' + s.id} className="text-sm text-teal-700 hover:underline">{s.title}</a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex flex-col gap-7">
            {doc.sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-6">
                <h2 className="text-lg font-bold text-slate-900 mb-2">{s.title}</h2>
                {s.paragraphs?.map((p, i) => (
                  <p key={i} className="text-sm leading-7 text-slate-700 mb-2">{p}</p>
                ))}
                {s.items && (
                  <ul className="list-disc pr-5 space-y-1.5">
                    {s.items.map((it, i) => (
                      <li key={i} className="text-sm leading-7 text-slate-700">{it}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        </div>

        <p className="text-center text-sm text-slate-500 mt-6">
          <Link to={other.to} className="text-teal-700 hover:underline">{other.label}</Link>
        </p>
      </main>
    </div>
  );
}

export function TermsPage() {
  return <LegalLayout doc={TERMS} icon="terms" other={{ to: '/privacy', label: 'اطّلع على سياسة الخصوصية' }} />;
}

export function PrivacyPage() {
  return <LegalLayout doc={PRIVACY} icon="privacy" other={{ to: '/terms', label: 'اطّلع على شروط الاستخدام' }} />;
}
