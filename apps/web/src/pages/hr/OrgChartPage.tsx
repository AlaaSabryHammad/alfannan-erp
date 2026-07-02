import { useQuery } from '@tanstack/react-query';
import { Users2 } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import apiClient from '../../lib/api';

interface OrgEmployee {
  id: number;
  nameAr: string;
  position: string | null;
  department: string | null;
  managerId: number | null;
}

const fetchOrgChart = async (): Promise<OrgEmployee[]> => (await apiClient.get<OrgEmployee[]>('/employees/org-chart')).data;

function NodeCard({ emp }: { emp: OrgEmployee }) {
  return (
    <div className="bg-white rounded-xl border border-app-border shadow-sm px-4 py-3 min-w-[160px] text-center hover:border-primary hover:shadow-md transition-all">
      <p className="text-sm font-bold text-app-text truncate">{emp.nameAr}</p>
      <p className="text-xs text-primary mt-0.5 truncate">{emp.position ?? '—'}</p>
      {emp.department && <p className="text-[10px] text-app-muted mt-0.5 truncate">{emp.department}</p>}
    </div>
  );
}

function OrgNode({ emp, byManager }: { emp: OrgEmployee; byManager: Map<number, OrgEmployee[]> }) {
  const children = byManager.get(emp.id) ?? [];
  return (
    <div className="flex flex-col items-center">
      <NodeCard emp={emp} />
      {children.length > 0 && (
        <div className="flex flex-col items-center">
          <div className="w-px h-5 bg-app-border" />
          <div className="flex justify-center gap-8 border-t border-app-border pt-0">
            {children.map((child) => (
              <div key={child.id} className="flex flex-col items-center px-1">
                <div className="w-px h-5 bg-app-border" />
                <OrgNode emp={child} byManager={byManager} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function OrgChartPage() {
  const { data: employees = [], isLoading } = useQuery({ queryKey: ['org-chart'], queryFn: fetchOrgChart });

  const byManager = new Map<number, OrgEmployee[]>();
  const knownIds = new Set(employees.map((e) => e.id));
  for (const emp of employees) {
    if (emp.managerId !== null && knownIds.has(emp.managerId)) {
      const list = byManager.get(emp.managerId) ?? [];
      list.push(emp);
      byManager.set(emp.managerId, list);
    }
  }
  // Roots: employees with no manager, or whose manager isn't in the active-employee set
  // (e.g. the manager is inactive) — treated as top-level so nobody gets silently dropped.
  const roots = employees.filter((e) => e.managerId === null || !knownIds.has(e.managerId));

  return (
    <div>
      <PageHeader
        title="الهيكل التنظيمي"
        subtitle="التسلسل الإداري للموظفين النشطين بناءً على المسؤول المباشر لكل موظف"
      />

      <div className="bg-white rounded-2xl border border-app-border shadow-sm p-8 overflow-x-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <span className="inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : employees.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-app-muted">
            <Users2 size={36} className="text-gray-200" />
            <p className="text-sm">لا يوجد موظفون نشطون بعد لبناء الهيكل التنظيمي</p>
          </div>
        ) : (
          <div className="flex justify-center gap-10 min-w-fit">
            {roots.map((root) => (
              <OrgNode key={root.id} emp={root} byManager={byManager} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
