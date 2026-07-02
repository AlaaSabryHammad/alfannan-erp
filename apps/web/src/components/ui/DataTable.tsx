import React, { useState, useRef } from 'react';
import { Search, ChevronUp, ChevronDown, Copy, FileSpreadsheet, FileText, Printer } from 'lucide-react';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import { cn } from '../../lib/utils';
import type { PaginationMeta } from '../../types';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (row: T, index: number) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  pagination?: PaginationMeta;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  onSearch?: (query: string) => void;
  searchValue?: string;
  loading?: boolean;
  rowKey?: (row: T) => string | number;
  onSort?: (key: string, dir: 'asc' | 'desc') => void;
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  emptyText?: string;
  exportTitle?: string;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/** Simple inline toast — same pattern as pages use */
function showToast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium transition-all ${
    type === 'success' ? 'bg-green-600' : 'bg-red-600'
  }`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 2500);
}

/** Extract plain text from a table cell (strips HTML/JSX rendered to DOM) */
function cellText(td: HTMLTableCellElement): string {
  return (td.textContent ?? '').trim();
}

/** Build the RTL print CSS + company header HTML used by both Print and PDF flows */
function buildPrintWindowHTML(tableHTML: string, title: string): string {
  const now = new Date().toLocaleDateString('ar-SA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
      direction: rtl;
      padding: 24px;
      font-size: 13px;
      color: #111;
      background: #fff;
    }
    .header {
      text-align: center;
      margin-bottom: 20px;
      border-bottom: 2px solid #0d9488;
      padding-bottom: 12px;
    }
    .header h1 { font-size: 20px; color: #0d9488; font-weight: 700; }
    .header h2 { font-size: 15px; color: #374151; margin-top: 4px; }
    .header .date { font-size: 12px; color: #6b7280; margin-top: 4px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
      font-size: 12px;
    }
    thead tr { background: #f0fdfa; }
    th, td {
      border: 1px solid #d1fae5;
      padding: 7px 10px;
      text-align: right;
    }
    th { font-weight: 600; color: #065f46; }
    tbody tr:nth-child(even) { background: #f9fafb; }
    @media print {
      body { padding: 12px; }
      @page { margin: 1.5cm; size: A4 landscape; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>الفنان للتوريدات العمومية</h1>
    <h2>${title}</h2>
    <div class="date">${now}</div>
  </div>
  ${tableHTML}
  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`;
}

export function DataTable<T>({
  columns,
  data,
  pagination,
  onPageChange,
  onPageSizeChange,
  onSearch,
  searchValue = '',
  loading = false,
  rowKey,
  onSort,
  sortKey,
  sortDir,
  emptyText = 'لا توجد بيانات',
  exportTitle = 'تقرير الفنان',
}: DataTableProps<T>) {
  const [localSearch, setLocalSearch] = useState(searchValue);
  const tableRef = useRef<HTMLTableElement>(null);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalSearch(e.target.value);
    onSearch?.(e.target.value);
  };

  const handleSort = (key: string) => {
    if (!onSort) return;
    if (sortKey === key) {
      onSort(key, sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      onSort(key, 'asc');
    }
  };

  // ── Export: Copy ──────────────────────────────────────────────────────────
  const handleCopy = async () => {
    const tbl = tableRef.current;
    if (!tbl) return;
    const rows: string[] = [];
    const headerCells = Array.from(tbl.querySelectorAll<HTMLTableCellElement>('thead th'));
    rows.push(headerCells.map(cellText).join('\t'));
    tbl.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll<HTMLTableCellElement>('td'));
      rows.push(cells.map(cellText).join('\t'));
    });
    const tsv = rows.join('\n');
    try {
      await navigator.clipboard.writeText(tsv);
      showToast('تم نسخ الجدول ✓');
    } catch {
      showToast('فشل النسخ — المتصفح لا يدعمه', 'error');
    }
  };

  // ── Export: Excel ─────────────────────────────────────────────────────────
  const handleExcel = () => {
    const tbl = tableRef.current;
    if (!tbl) return;
    try {
      const wb = XLSX.utils.table_to_book(tbl, { raw: false });
      // Set RTL worksheet view
      const wsName = wb.SheetNames[0];
      if (wsName && wb.Sheets[wsName]) {
        const ws = wb.Sheets[wsName];
        if (!ws['!views']) ws['!views'] = [];
        ws['!views'][0] = { rightToLeft: true };
      }
      const fileName = `${exportTitle}.xlsx`;
      XLSX.writeFile(wb, fileName);
      showToast(`تم تحميل ${fileName}`);
    } catch {
      showToast('فشل إنشاء ملف Excel', 'error');
    }
  };

  // ── Export: PDF (html2canvas → image → print window) ─────────────────────
  const handlePDF = async () => {
    const tbl = tableRef.current;
    if (!tbl) return;
    try {
      showToast('جارٍ إنشاء PDF…');
      const canvas = await html2canvas(tbl, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');
      const win = window.open('', '_blank');
      if (!win) {
        showToast('يرجى السماح بالنوافذ المنبثقة', 'error');
        return;
      }
      const now = new Date().toLocaleDateString('ar-SA', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      win.document.write(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8" />
  <title>${exportTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; direction: rtl; padding: 24px; background: #fff; }
    .header { text-align: center; margin-bottom: 16px; border-bottom: 2px solid #0d9488; padding-bottom: 10px; }
    .header h1 { font-size: 20px; color: #0d9488; font-weight: 700; }
    .header h2 { font-size: 14px; color: #374151; margin-top: 4px; }
    .header .date { font-size: 12px; color: #6b7280; margin-top: 4px; }
    img { width: 100%; height: auto; display: block; margin-top: 8px; }
    @media print {
      body { padding: 12px; }
      @page { margin: 1.5cm; size: A4 landscape; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>الفنان للتوريدات العمومية</h1>
    <h2>${exportTitle}</h2>
    <div class="date">${now}</div>
  </div>
  <img src="${imgData}" alt="${exportTitle}" />
  <script>window.onload = function() { window.print(); };<\/script>
</body>
</html>`);
      win.document.close();
    } catch {
      showToast('فشل إنشاء PDF', 'error');
    }
  };

  // ── Export: Print ─────────────────────────────────────────────────────────
  const handlePrint = () => {
    const tbl = tableRef.current;
    if (!tbl) return;
    try {
      const win = window.open('', '_blank');
      if (!win) {
        showToast('يرجى السماح بالنوافذ المنبثقة', 'error');
        return;
      }
      win.document.write(buildPrintWindowHTML(tbl.outerHTML, exportTitle));
      win.document.close();
    } catch {
      showToast('فشل فتح نافذة الطباعة', 'error');
    }
  };

  const total = pagination?.total ?? data.length;
  const page = pagination?.page ?? 1;
  const pageSize = pagination?.pageSize ?? data.length;
  const totalPages = pagination?.totalPages ?? 1;
  const fromRecord = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const toRecord = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-col gap-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        {/* Search */}
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-app-muted" />
          <input
            type="text"
            placeholder="بحث سريع..."
            value={localSearch}
            onChange={handleSearch}
            className="w-full border border-app-border rounded-lg pr-9 pl-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
          />
        </div>

        <div className="flex items-center gap-2">
          {/* Page size */}
          {onPageSizeChange && (
            <div className="flex items-center gap-1 text-sm text-app-muted">
              <span>عرض</span>
              <select
                value={pageSize}
                onChange={(e) => onPageSizeChange(Number(e.target.value))}
                className="border border-app-border rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <span>سجلات</span>
            </div>
          )}

          {/* Export buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopy}
              title="نسخ الجدول كنص"
              className="flex items-center gap-1 text-xs text-app-muted hover:text-app-text border border-app-border rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors"
            >
              <Copy size={13} />
              <span>نسخ</span>
            </button>
            <button
              onClick={handleExcel}
              title="تحميل ملف Excel"
              className="flex items-center gap-1 text-xs text-app-muted hover:text-app-text border border-app-border rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors"
            >
              <FileSpreadsheet size={13} />
              <span>Excel</span>
            </button>
            <button
              onClick={handlePDF}
              title="تصدير PDF"
              className="flex items-center gap-1 text-xs text-app-muted hover:text-app-text border border-app-border rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors"
            >
              <FileText size={13} />
              <span>PDF</span>
            </button>
            <button
              onClick={handlePrint}
              title="طباعة الجدول"
              className="flex items-center gap-1 text-xs text-app-muted hover:text-app-text border border-app-border rounded-lg px-2.5 py-1.5 hover:bg-gray-50 transition-colors"
            >
              <Printer size={13} />
              <span>طباعة</span>
            </button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-app-border">
        <table ref={tableRef} className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-app-border">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-4 py-3 text-right font-semibold text-app-muted text-xs uppercase tracking-wide',
                    col.sortable && onSort ? 'cursor-pointer hover:text-app-text select-none' : '',
                    col.className
                  )}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <div className="flex items-center gap-1 justify-start">
                    {col.header}
                    {col.sortable && onSort && (
                      <span className="flex flex-col">
                        <ChevronUp
                          size={10}
                          className={sortKey === col.key && sortDir === 'asc' ? 'text-primary' : 'text-gray-300'}
                        />
                        <ChevronDown
                          size={10}
                          className={sortKey === col.key && sortDir === 'desc' ? 'text-primary' : 'text-gray-300'}
                        />
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-app-muted">
                  <span className="inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-10 text-center text-app-muted">
                  {emptyText}
                </td>
              </tr>
            ) : (
              data.map((row, idx) => (
                <tr
                  key={rowKey ? rowKey(row) : idx}
                  className="border-b border-app-border last:border-0 hover:bg-gray-50 transition-colors"
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cn('px-4 py-3 text-app-text', col.className)}>
                      {col.render ? col.render(row, idx) : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination footer */}
      {pagination && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-app-muted">
            عرض <span className="font-medium text-app-text">{fromRecord}</span> إلى{' '}
            <span className="font-medium text-app-text">{toRecord}</span> من أصل{' '}
            <span className="font-medium text-app-text">{total}</span> سجل
          </p>

          <div className="flex items-center gap-1">
            <button
              onClick={() => onPageChange?.(1)}
              disabled={page === 1}
              className="px-3 py-1.5 text-xs border border-app-border rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              الأول
            </button>
            <button
              onClick={() => onPageChange?.(page - 1)}
              disabled={page === 1}
              className="px-3 py-1.5 text-xs border border-app-border rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              السابق
            </button>

            {/* Page numbers */}
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let p: number;
              if (totalPages <= 5) {
                p = i + 1;
              } else if (page <= 3) {
                p = i + 1;
              } else if (page >= totalPages - 2) {
                p = totalPages - 4 + i;
              } else {
                p = page - 2 + i;
              }
              return (
                <button
                  key={p}
                  onClick={() => onPageChange?.(p)}
                  className={cn(
                    'px-3 py-1.5 text-xs border rounded-lg transition-colors',
                    p === page
                      ? 'bg-primary text-white border-primary'
                      : 'border-app-border hover:bg-gray-50'
                  )}
                >
                  {p}
                </button>
              );
            })}

            <button
              onClick={() => onPageChange?.(page + 1)}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-xs border border-app-border rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              التالي
            </button>
            <button
              onClick={() => onPageChange?.(totalPages)}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-xs border border-app-border rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              الأخير
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
