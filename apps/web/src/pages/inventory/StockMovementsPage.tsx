import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../../components/ui/PageHeader';
import { Badge } from '../../components/ui/Badge';
import { Input, Select } from '../../components/ui/Input';
import { DataTable } from '../../components/ui/DataTable';
import type { Column } from '../../components/ui/DataTable';
import { formatDate } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginatedResponse, PaginationMeta } from '../../types';

// --- Types ---
interface StockMovement {
  id: number;
  type: 'IN' | 'OUT' | 'TRANSFER' | 'ADJUST';
  quantity: number;
  balanceAfter: number;
  refType: string | null;
  refId: number | null;
  reason: string | null;
  createdAt: string;
  product: { id: number; nameAr: string; sku: string };
  warehouse: { id: number; nameAr: string };
  createdBy: { id: number; name: string } | null;
}

interface Warehouse { id: number; nameAr: string; }
interface ProductOption { id: number; nameAr: string; sku: string; }

// --- Labels ---
const TYPE_LABELS: Record<StockMovement['type'], { label: string; variant: 'success' | 'danger' | 'info' | 'warning' }> = {
  IN: { label: 'وارد', variant: 'success' },
  OUT: { label: 'صادر', variant: 'danger' },
  TRANSFER: { label: 'تحويل', variant: 'info' },
  ADJUST: { label: 'تسوية', variant: 'warning' },
};

const SOURCE_LABELS: Record<string, string> = {
  OPENING: 'رصيد افتتاحي',
  PURCHASE: 'فاتورة شراء',
  INVOICE: 'فاتورة بيع',
  PURCHASE_RETURN: 'مرتجع مشتريات',
  SALES_RETURN: 'مرتجع مبيعات',
  TRANSFER: 'تحويل مخزني',
  STOCK_COUNT: 'جرد مخزني',
};

// --- API ---
interface Filters {
  page: number;
  pageSize: number;
  productId: string;
  warehouseId: string;
  type: string;
  refType: string;
  from: string;
  to: string;
}

const fetchMovements = async (f: Filters) => {
  const params: Record<string, string | number> = { page: f.page, pageSize: f.pageSize };
  (['productId', 'warehouseId', 'type', 'refType', 'from', 'to'] as const).forEach((k) => {
    if (f[k]) params[k] = f[k];
  });
  const res = await apiClient.get<PaginatedResponse<StockMovement>>('/stock/movements', { params });
  return res.data;
};

const fetchWarehouses = async () => {
  const res = await apiClient.get<PaginatedResponse<Warehouse>>('/warehouses', { params: { pageSize: 200 } });
  return res.data.data;
};

const fetchProducts = async () => {
  const res = await apiClient.get<PaginatedResponse<ProductOption>>('/products', { params: { pageSize: 500 } });
  return res.data.data;
};

// --- Component ---
export function StockMovementsPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [type, setType] = useState('');
  const [refType, setRefType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filters: Filters = { page, pageSize, productId, warehouseId, type, refType, from, to };
  const hasFilters = !!(productId || warehouseId || type || refType || from || to);

  const { data, isLoading } = useQuery({
    queryKey: ['stock-movements', filters],
    queryFn: () => fetchMovements(filters),
  });
  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses-all'], queryFn: fetchWarehouses });
  const { data: products = [] } = useQuery({ queryKey: ['products-options'], queryFn: fetchProducts });

  const reset = () => {
    setProductId(''); setWarehouseId(''); setType(''); setRefType(''); setFrom(''); setTo('');
    setPage(1);
  };
  const onFilter = (setter: (v: string) => void) => (v: string) => { setter(v); setPage(1); };

  const columns: Column<StockMovement>[] = [
    {
      key: 'createdAt',
      header: 'التاريخ',
      render: (row) => <span className="text-xs whitespace-nowrap">{formatDate(row.createdAt)}</span>,
    },
    {
      key: 'product',
      header: 'المنتج',
      render: (row) => (
        <div>
          <div className="font-medium text-app-text">{row.product.nameAr}</div>
          <div className="text-xs text-app-muted font-mono">{row.product.sku}</div>
        </div>
      ),
    },
    {
      key: 'warehouse',
      header: 'المستودع',
      render: (row) => (
        <span className="text-xs bg-primary-50 text-primary px-2 py-1 rounded-full">{row.warehouse.nameAr}</span>
      ),
    },
    {
      key: 'type',
      header: 'النوع',
      render: (row) => {
        const t = TYPE_LABELS[row.type];
        return <Badge variant={t.variant}>{t.label}</Badge>;
      },
    },
    {
      key: 'quantity',
      header: 'الكمية',
      render: (row) => {
        const sign = row.type === 'IN' ? '+' : row.type === 'OUT' ? '−' : '';
        const color = row.type === 'IN' ? 'text-success' : row.type === 'OUT' ? 'text-danger' : 'text-app-text';
        return <span dir="ltr" className={`font-bold font-mono ${color}`}>{sign}{Number(row.quantity)}</span>;
      },
    },
    {
      key: 'balanceAfter',
      header: 'الرصيد بعدها',
      render: (row) => <span className="font-mono">{Number(row.balanceAfter)}</span>,
    },
    {
      key: 'refType',
      header: 'المصدر',
      render: (row) => (
        <span className="text-xs">
          {row.refType ? (SOURCE_LABELS[row.refType] ?? row.refType) : <span className="text-app-muted">—</span>}
          {row.refId ? <span className="text-app-muted font-mono"> #{row.refId}</span> : null}
        </span>
      ),
    },
    {
      key: 'createdBy',
      header: 'بواسطة',
      render: (row) => row.createdBy?.name ?? <span className="text-app-muted text-xs">—</span>,
    },
    {
      key: 'reason',
      header: 'ملاحظة',
      render: (row) => row.reason ?? <span className="text-app-muted text-xs">—</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title="حركات المخزون"
        subtitle="سجل كل حركات الوارد والصادر والتحويل والتسوية على المخزون"
      />

      <div className="mb-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Select value={productId} onChange={(e) => onFilter(setProductId)(e.target.value)}>
          <option value="">كل المنتجات</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>{p.nameAr}</option>
          ))}
        </Select>
        <Select value={warehouseId} onChange={(e) => onFilter(setWarehouseId)(e.target.value)}>
          <option value="">كل المستودعات</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.nameAr}</option>
          ))}
        </Select>
        <Select value={type} onChange={(e) => onFilter(setType)(e.target.value)}>
          <option value="">كل الأنواع</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </Select>
        <Select value={refType} onChange={(e) => onFilter(setRefType)(e.target.value)}>
          <option value="">كل المصادر</option>
          {Object.entries(SOURCE_LABELS).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </Select>
        <Input type="date" aria-label="من تاريخ" value={from} onChange={(e) => onFilter(setFrom)(e.target.value)} />
        <Input type="date" aria-label="إلى تاريخ" value={to} onChange={(e) => onFilter(setTo)(e.target.value)} />
      </div>
      {hasFilters && (
        <button onClick={reset} className="mb-4 text-xs text-app-muted hover:text-app-text underline">
          إلغاء التصفية
        </button>
      )}

      <div className="bg-white rounded-2xl border border-app-border shadow-sm p-5">
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          pagination={data?.pagination as PaginationMeta | undefined}
          loading={isLoading}
          onPageChange={setPage}
          onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          rowKey={(r) => r.id}
          emptyText="لا توجد حركات مخزنية مطابقة للتصفية"
        />
      </div>
    </div>
  );
}
