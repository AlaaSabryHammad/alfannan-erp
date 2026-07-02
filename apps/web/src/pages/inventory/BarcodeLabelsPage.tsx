import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, RefreshCw, Tag } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { PageHeader } from '../../components/ui/PageHeader';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Input';
import { formatMoney } from '../../lib/utils';
import apiClient from '../../lib/api';
import type { PaginatedResponse } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Product {
  id: number;
  nameAr: string;
  sku: string;
  barcode?: string | null;
  salePrice: number;
  department?: { id: number; nameAr: string } | null;
}

interface Department {
  id: number;
  nameAr: string;
}

type SelectionMode = 'single' | 'department' | 'all';
type CodeType = 'barcode' | 'qr';

interface LabelOptions {
  selectionMode: SelectionMode;
  productId: string;
  departmentId: string;
  codeType: CodeType;
  labelWidth: number;
  labelHeight: number;
  labelsPerRow: number;
  labelCount: number;
  fontSize: number;
  barcodeHeight: number;
  showCompany: boolean;
  showProductName: boolean;
  showPrice: boolean;
  showCodeText: boolean;
}

// ─── API ──────────────────────────────────────────────────────────────────────

const fetchProductsAll = async (): Promise<Product[]> => {
  const res = await apiClient.get<PaginatedResponse<Product>>('/products', {
    params: { page: 1, pageSize: 500 },
  });
  return res.data.data;
};

const fetchDepartmentsAll = async (): Promise<Department[]> => {
  const res = await apiClient.get<PaginatedResponse<Department>>('/departments', {
    params: { page: 1, pageSize: 200 },
  });
  return res.data.data;
};

// mm → px approximation (96 dpi)
const MM_TO_PX = 3.78;

// ─── Single Label Cell ────────────────────────────────────────────────────────

function LabelCell({
  product,
  opts,
}: {
  product: Product;
  opts: LabelOptions;
}) {
  const barcodeRef = useRef<SVGSVGElement>(null);
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  const code = product.barcode || product.sku || String(product.id);
  const wPx = opts.labelWidth * MM_TO_PX;
  const hPx = opts.labelHeight * MM_TO_PX;
  const bcHeightPx = opts.barcodeHeight * MM_TO_PX;

  useEffect(() => {
    if (opts.codeType === 'barcode' && barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, code, {
          format: 'CODE128',
          width: 1.5,
          height: bcHeightPx,
          displayValue: false,
          margin: 2,
        });
      } catch {
        // invalid barcode value — show raw text fallback
      }
    }
    if (opts.codeType === 'qr' && qrCanvasRef.current) {
      QRCode.toCanvas(qrCanvasRef.current, code, {
        width: Math.min(wPx - 8, bcHeightPx + 10),
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      }).catch(() => {/* ignore */});
    }
  }, [code, opts.codeType, bcHeightPx, wPx]);

  return (
    <div
      className="label-cell bg-white border border-gray-400 flex flex-col items-center justify-center overflow-hidden"
      style={{
        width: wPx,
        height: hPx,
        padding: 3,
        boxSizing: 'border-box',
        fontSize: opts.fontSize,
        lineHeight: '1.2',
        fontFamily: 'Tajawal, Cairo, Arial, sans-serif',
      }}
    >
      {opts.showCompany && (
        <div
          style={{ fontSize: opts.fontSize - 1, color: '#555', fontWeight: 600, marginBottom: 1 }}
          className="truncate w-full text-center"
        >
          الفنان للتوريدات
        </div>
      )}

      {opts.showProductName && (
        <div
          style={{ fontSize: opts.fontSize, fontWeight: 700, color: '#000', marginBottom: 1 }}
          className="truncate w-full text-center"
        >
          {product.nameAr}
        </div>
      )}

      {/* Barcode or QR */}
      {opts.codeType === 'barcode' ? (
        <svg ref={barcodeRef} style={{ maxWidth: '100%' }} />
      ) : (
        <canvas ref={qrCanvasRef} style={{ maxWidth: '100%', maxHeight: bcHeightPx + 10 }} />
      )}

      {opts.showCodeText && (
        <div
          style={{ fontSize: opts.fontSize - 1, color: '#333', fontFamily: 'monospace', marginTop: 1 }}
          className="truncate w-full text-center"
        >
          {code}
        </div>
      )}

      {opts.showPrice && (
        <div
          style={{ fontSize: opts.fontSize, fontWeight: 700, color: '#0e9384', marginTop: 1 }}
          className="truncate w-full text-center"
        >
          {formatMoney(Number(product.salePrice))}
        </div>
      )}
    </div>
  );
}

// ─── Checkbox Row ─────────────────────────────────────────────────────────────

function CheckRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 cursor-pointer text-sm select-none">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary/30"
      />
      <span className="text-app-text">{label}</span>
    </label>
  );
}

// ─── Number Setting Row ────────────────────────────────────────────────────────

function NumSetting({
  label,
  value,
  onChange,
  min = 1,
  max = 999,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-xs text-app-text whitespace-nowrap">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || min)}
        className="w-20 rounded-lg border border-app-border px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary text-center"
      />
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function BarcodeLabelsPage() {
  const { data: products = [] } = useQuery({
    queryKey: ['products', 'all-labels'],
    queryFn: fetchProductsAll,
    staleTime: 1000 * 60 * 5,
  });
  const { data: departments = [] } = useQuery({
    queryKey: ['departments', 'all-labels'],
    queryFn: fetchDepartmentsAll,
    staleTime: 1000 * 60 * 5,
  });

  const [opts, setOpts] = useState<LabelOptions>({
    selectionMode: 'single',
    productId: '',
    departmentId: '',
    codeType: 'barcode',
    labelWidth: 38,
    labelHeight: 25,
    labelsPerRow: 3,
    labelCount: 12,
    fontSize: 9,
    barcodeHeight: 12,
    showCompany: true,
    showProductName: true,
    showPrice: true,
    showCodeText: true,
  });

  const [generatedProducts, setGeneratedProducts] = useState<Product[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const set = useCallback(<K extends keyof LabelOptions>(key: K, value: LabelOptions[K]) => {
    setOpts((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleGenerate = () => {
    setGenerating(true);
    let pool: Product[] = [];

    if (opts.selectionMode === 'single') {
      const found = products.find((p) => String(p.id) === opts.productId);
      if (found) pool = [found];
    } else if (opts.selectionMode === 'department') {
      pool = products.filter((p) => String(p.department?.id) === opts.departmentId);
    } else {
      pool = [...products];
    }

    // Repeat to fill labelCount
    const result: Product[] = [];
    if (pool.length > 0) {
      for (let i = 0; i < opts.labelCount; i++) {
        result.push(pool[i % pool.length]);
      }
    }
    setGeneratedProducts(result);
    setGenerating(false);
  };

  const handlePrint = () => {
    window.print();
  };

  // Determine which products are in the selected department for display
  const deptProducts = opts.departmentId
    ? products.filter((p) => String(p.department?.id) === opts.departmentId)
    : [];

  return (
    <>
      {/* Print-only styles */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #label-print-area, #label-print-area * { visibility: visible !important; }
          #label-print-area {
            position: fixed !important;
            inset: 0 !important;
            display: flex !important;
            flex-wrap: wrap !important;
            gap: 2mm !important;
            padding: 5mm !important;
            background: white !important;
          }
          .label-cell {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
        }
      `}</style>

      <div>
        <PageHeader
          title="ملصقات الباركود والـQR Code"
          subtitle="تصميم وطباعة ملصقات الأصناف بسهولة واحترافية"
        />

        <div className="flex gap-4 items-start" dir="rtl">
          {/* ── Right panel: Options ─────────────────────────────────────────── */}
          <div className="w-72 flex-shrink-0 bg-white rounded-2xl border border-app-border shadow-sm p-5 space-y-4">
            <h3 className="text-sm font-bold text-app-text border-b border-app-border pb-2">
              خيارات وتحديد الأصناف
            </h3>

            {/* Selection mode */}
            <div>
              <label className="block text-xs font-medium text-app-text mb-1">طريقة التحديد</label>
              <select
                value={opts.selectionMode}
                onChange={(e) => set('selectionMode', e.target.value as SelectionMode)}
                className="w-full rounded-lg border border-app-border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                <option value="single">صنف محدد (فردي)</option>
                <option value="department">حسب القسم</option>
                <option value="all">كل الأصناف</option>
              </select>
            </div>

            {/* Product select */}
            {opts.selectionMode === 'single' && (
              <div>
                <label className="block text-xs font-medium text-app-text mb-1">اختر الصنف</label>
                <select
                  value={opts.productId}
                  onChange={(e) => set('productId', e.target.value)}
                  className="w-full rounded-lg border border-app-border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                >
                  <option value="">— اختر منتجاً —</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nameAr}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Department select */}
            {opts.selectionMode === 'department' && (
              <div>
                <label className="block text-xs font-medium text-app-text mb-1">اختر القسم</label>
                <select
                  value={opts.departmentId}
                  onChange={(e) => set('departmentId', e.target.value)}
                  className="w-full rounded-lg border border-app-border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                >
                  <option value="">— اختر القسم —</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.nameAr}
                    </option>
                  ))}
                </select>
                {opts.departmentId && (
                  <p className="text-xs text-app-muted mt-1">
                    {deptProducts.length} صنف في هذا القسم
                  </p>
                )}
              </div>
            )}

            {/* Code type */}
            <div>
              <label className="block text-xs font-medium text-app-text mb-1">نوع الرمز</label>
              <select
                value={opts.codeType}
                onChange={(e) => set('codeType', e.target.value as CodeType)}
                className="w-full rounded-lg border border-app-border px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                <option value="barcode">باركود (CODE128)</option>
                <option value="qr">QR Code</option>
              </select>
            </div>

            {/* Dimensions */}
            <div className="space-y-2 pt-1">
              <p className="text-xs font-semibold text-app-muted uppercase tracking-wide">أبعاد الملصق</p>
              <NumSetting label="عرض الملصق (مم)" value={opts.labelWidth} onChange={(v) => set('labelWidth', v)} min={20} max={120} />
              <NumSetting label="ارتفاع الملصق (مم)" value={opts.labelHeight} onChange={(v) => set('labelHeight', v)} min={15} max={100} />
              <NumSetting label="عدد الملصقات بالسطر" value={opts.labelsPerRow} onChange={(v) => set('labelsPerRow', v)} min={1} max={10} />
              <NumSetting label="عدد الملصقات" value={opts.labelCount} onChange={(v) => set('labelCount', v)} min={1} max={200} />
              <NumSetting label="حجم الخط (بكسل)" value={opts.fontSize} onChange={(v) => set('fontSize', v)} min={6} max={24} />
              <NumSetting label="ارتفاع الرمز (مم)" value={opts.barcodeHeight} onChange={(v) => set('barcodeHeight', v)} min={5} max={60} />
            </div>

            {/* Visibility toggles */}
            <div className="space-y-2 pt-1">
              <p className="text-xs font-semibold text-app-muted uppercase tracking-wide">البيانات المعروضة</p>
              <CheckRow id="showCompany" label="إظهار اسم الشركة" checked={opts.showCompany} onChange={(v) => set('showCompany', v)} />
              <CheckRow id="showProductName" label="إظهار اسم المنتج" checked={opts.showProductName} onChange={(v) => set('showProductName', v)} />
              <CheckRow id="showPrice" label="إظهار السعر" checked={opts.showPrice} onChange={(v) => set('showPrice', v)} />
              <CheckRow id="showCodeText" label="إظهار رقم الكود نصياً" checked={opts.showCodeText} onChange={(v) => set('showCodeText', v)} />
            </div>

            {/* Generate button */}
            <Button
              className="w-full justify-center"
              icon={<RefreshCw size={14} />}
              loading={generating}
              onClick={handleGenerate}
            >
              توليد ومعاينة الملصقات
            </Button>
          </div>

          {/* ── Left panel: Preview ──────────────────────────────────────────── */}
          <div className="flex-1 bg-white rounded-2xl border border-app-border shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-app-text">
                المعاينة الحية للملصقات المجهزة
              </h3>
              {generatedProducts && generatedProducts.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  icon={<Printer size={14} />}
                  onClick={handlePrint}
                >
                  طباعة الآن
                </Button>
              )}
            </div>

            {/* Empty state */}
            {!generatedProducts ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-16 h-16 rounded-2xl bg-primary-50 flex items-center justify-center mb-4">
                  <Tag size={32} className="text-primary" />
                </div>
                <p className="text-app-muted text-sm max-w-xs leading-relaxed">
                  يرجى تحديد الصنف أو القسم وإعداد الخيارات ثم النقر على
                  <span className="font-semibold text-primary"> "توليد ومعاينة الملصقات"</span> للمشاهدة.
                </p>
              </div>
            ) : generatedProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <p className="text-app-muted text-sm">
                  لم يتم العثور على أصناف للخيارات المحددة. يرجى تعديل الاختيار.
                </p>
              </div>
            ) : (
              <>
                <div className="text-xs text-app-muted mb-3">
                  {generatedProducts.length} ملصق — عرض {opts.labelWidth}×{opts.labelHeight} مم
                </div>
                <div
                  id="label-print-area"
                  ref={printRef}
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: 4,
                    padding: 4,
                    background: '#f8f9fa',
                    borderRadius: 8,
                    maxHeight: 560,
                    overflowY: 'auto',
                  }}
                >
                  {generatedProducts.map((product, idx) => (
                    <LabelCell key={`${product.id}-${idx}`} product={product} opts={opts} />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
