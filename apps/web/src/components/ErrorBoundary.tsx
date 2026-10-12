import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** changing this (e.g. the route) clears a previous error */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

/**
 * A render error in one page must not blank the whole application: show what happened and let the
 * user go on (try again, or open another page from the sidebar).
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Page crashed:', error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="bg-white rounded-2xl border border-app-border shadow-sm p-8 max-w-xl mx-auto mt-10 text-center" dir="rtl">
        <span className="w-14 h-14 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={28} />
        </span>
        <h2 className="text-lg font-bold text-app-text mb-2">تعذّر عرض هذه الصفحة</h2>
        <p className="text-sm text-app-muted mb-4">
          حدث خطأ غير متوقع أثناء فتح الصفحة. بقية النظام يعمل بشكل طبيعي. جرّب مرة أخرى، أو افتح صفحة أخرى من القائمة.
        </p>
        <pre className="text-xs text-left bg-gray-50 border border-app-border rounded-lg p-3 mb-4 overflow-auto max-h-32" dir="ltr">
          {String(error.message || error)}
        </pre>
        <button
          onClick={() => this.setState({ error: null })}
          className="inline-flex items-center gap-2 bg-primary hover:bg-primary-600 text-white text-sm font-semibold px-4 py-2 rounded-lg"
        >
          <RefreshCw size={15} /> إعادة المحاولة
        </button>
      </div>
    );
  }
}
