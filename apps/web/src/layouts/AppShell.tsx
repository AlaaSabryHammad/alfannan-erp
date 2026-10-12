import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { SubscriptionBanner } from '../components/SubscriptionBanner';
import { LegalBanner } from '../components/LegalBanner';
import { EmailVerificationBanner } from '../components/EmailVerificationBanner';
import { AnnouncementBanner } from '../components/AnnouncementBanner';
import { ErrorBoundary } from '../components/ErrorBoundary';

export function AppShell() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-screen bg-app-bg flex flex-row">
      {/* Sidebar on the RIGHT: in RTL, flex-row places the first child at the start (right edge) */}
      <Sidebar />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <Topbar />

        {/* Trial ending / expired / grace — only visible when it needs attention */}
        <AnnouncementBanner />
        <SubscriptionBanner />
        <EmailVerificationBanner />
        <LegalBanner />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {/* a crash in one page shows a message here instead of a blank application */}
          <ErrorBoundary resetKey={pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>

        {/* Footer */}
        <footer className="border-t border-app-border bg-white px-6 py-3">
          <p className="text-xs text-app-muted text-center">
            © 2026 الفنان السعودي · حلول الفنان · جميع الحقوق محفوظة
          </p>
        </footer>
      </div>
    </div>
  );
}
