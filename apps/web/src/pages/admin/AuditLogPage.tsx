import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ScrollText } from 'lucide-react';
import { PageHeader } from '../../components/ui/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { usePermission } from '../../contexts/AuthContext';
import { useDateRange } from '../../contexts/DateRangeContext';
import { formatDate } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginationMeta } from '../../types';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface AuditLog {
  id: number;
  userId: number | null;
  userName: string | null;
  method: string;
  path: string;
  action: string | null;
  entity: string | null;
  statusCode: number;
  ip: string | null;
  createdAt: string;
}

interface AuditLogsResponse {
  data: AuditLog[];
  pagination: PaginationMeta;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function statusVariant(code: number): 'success' | 'warning' | 'danger' | 'default' {
  if (code >= 200 && code < 300) return 'success';
  if (code >= 400 && code < 500) return 'warning';
  if (code >= 500) return 'danger';
  return 'default';
}

function statusLabel(code: number): string {
  if (code >= 200 && code < 300) return `نجاح ${code}`;
  if (code >= 400 && code < 500) return `خطأ عميل ${code}`;
  if (code >= 500) return `خطأ خادم ${code}`;
  return String(code);
}

function formatDateTime(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  return {
    date: formatDate(iso),
    time: d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

// ─── API ──────────────────────────────────────────────────────────────────────

const fetchAuditLogs = async (params: {
  page: number;
  pageSize: number;
  from: string | null;
  to: string | null;
}): Promise<AuditLogsResponse> => {
  const queryParams: Record<string, string | number> = {
    page: params.page,
    pageSize: params.pageSize,
  };
  if (params.from) queryParams.from = params.from;
  if (params.to) queryParams.to = params.to;
  const res = await apiClient.get<AuditLogsResponse>('/audit-logs', { params: queryParams });
  return res.data;
};

// ─── Main Component ────────────────────────────────────────────────────────────

export function AuditLogPage() {
  const canView = usePermission('users.view');
  const { from, to } = useDateRange();

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['audit-logs', page, pageSize, from, to],
    queryFn: () => fetchAuditLogs({ page, pageSize, from, to }),
    enabled: canView,
  });

  const columns: Column<AuditLog>[] = [
    {
      key: 'createdAt',
      header: 'التاريخ والوقت',
      render: (row) => {
        const { date, time } = formatDateTime(row.createdAt);
        return (
          <div>
            <div className="font-medium text-app-text text-xs">{date}</div>
            <div className="text-app-muted text-xs font-mono">{time}</div>
          </div>
        );
      },
    },
    {
      key: 'userName',
      header: 'المستخدم',
      render: (row) => (
        <span className="text-sm font-medium text-app-text">
          {row.userName ?? '—'}
        </span>
      ),
    },
    {
      key: 'action',
      header: 'العملية',
      render: (row) => (
        <div>
          <div className="text-sm font-medium text-app-text">
            {row.action ?? row.method}
          </div>
          <div className="text-xs text-app-muted font-mono truncate max-w-[220px]" title={row.path}>
            {row.method} {row.path}
          </div>
        </div>
      ),
    },
    {
      key: 'statusCode',
      header: 'النتيجة',
      render: (row) => (
        <Badge variant={statusVariant(row.statusCode)}>
          {statusLabel(row.statusCode)}
        </Badge>
      ),
    },
    {
      key: 'ip',
      header: 'عنوان IP',
      render: (row) => (
        <span className="text-xs text-app-muted font-mono">{row.ip ?? '—'}</span>
      ),
    },
  ];

  if (!canView) {
    return (
      <div>
        <PageHeader title="سجل التدقيق" subtitle="سجل جميع العمليات المنفذة في النظام" />
        <Card>
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <AlertTriangle size={40} className="text-warning" />
            <p className="text-warning font-semibold">ليس لديك صلاحية لعرض سجل التدقيق</p>
          </div>
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        <PageHeader title="سجل التدقيق" subtitle="سجل جميع العمليات المنفذة في النظام" />
        <Card>
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <AlertTriangle size={40} className="text-danger" />
            <p className="text-danger font-semibold">تعذّر تحميل سجل التدقيق</p>
            <p className="text-app-muted text-sm">تأكد من تشغيل الخادم الخلفي وصحة الاتصال</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="سجل التدقيق"
        subtitle="سجل جميع العمليات التعديلية المنفذة في النظام (غير قراءة)"
        actions={
          <div className="flex items-center gap-2 text-xs text-app-muted bg-gray-50 border border-app-border rounded-xl px-3 py-2">
            <ScrollText size={14} className="text-primary" />
            <span>
              {from || to
                ? `${from ?? '—'} ← ${to ?? '—'}`
                : 'جميع الفترات'}
            </span>
          </div>
        }
      />

      <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5">
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          pagination={data?.pagination}
          loading={isLoading}
          onPageChange={(p) => setPage(p)}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          rowKey={(r) => r.id}
          emptyText="لا توجد عمليات مسجلة في السجل"
        />
      </div>
    </div>
  );
}
