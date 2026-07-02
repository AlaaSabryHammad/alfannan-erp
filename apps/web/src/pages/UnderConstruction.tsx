import { Construction } from 'lucide-react';
import { useLocation } from 'react-router-dom';

export function UnderConstruction() {
  const { pathname } = useLocation();

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <div className="w-20 h-20 rounded-full bg-warning-bg flex items-center justify-center">
        <Construction size={40} className="text-warning" />
      </div>
      <h2 className="text-xl font-bold text-app-text">قيد الإنشاء</h2>
      <p className="text-app-muted text-sm text-center max-w-xs">
        هذه الصفحة <span className="font-mono text-primary">{pathname}</span> قيد التطوير وستكون متاحة قريباً.
      </p>
    </div>
  );
}
