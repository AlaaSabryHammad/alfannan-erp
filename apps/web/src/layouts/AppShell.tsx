import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';

export function AppShell() {
  return (
    <div className="min-h-screen bg-app-bg flex flex-row">
      {/* Sidebar on the RIGHT: in RTL, flex-row places the first child at the start (right edge) */}
      <Sidebar />

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Topbar */}
        <Topbar />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>

        {/* Footer */}
        <footer className="border-t border-app-border bg-white px-6 py-3">
          <p className="text-xs text-app-muted text-center">
            © 2026 نظام الفنان للتوريدات والمخازن · حلول الفنان · جميع الحقوق محفوظة
          </p>
        </footer>
      </div>
    </div>
  );
}
