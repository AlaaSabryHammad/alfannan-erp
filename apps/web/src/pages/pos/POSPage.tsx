import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search, ShoppingCart, Plus, Minus, Trash2, Tag, ChevronDown,
  CreditCard, Banknote, Wifi, Receipt, PackageOpen, Printer, CheckCircle2
} from 'lucide-react';
import { formatMoney, resolveImageUrl, getApiErrorMessage } from '../../lib/utils';
import { printReceipt, type ReceiptDoc } from '../../lib/print';
import { useAuth } from '../../contexts/AuthContext';
import { useBranch } from '../../contexts/BranchContext';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import apiClient from '../../lib/api';
import type { PaginatedResponse } from '../../types';

// --- Types ---
interface Department {
  id: number;
  nameAr: string;
  children?: Department[];
}

interface Warehouse {
  id: number;
  nameAr: string;
  isActive: boolean;
  branch?: { id: number; nameAr: string } | null;
}

interface StockBalance {
  warehouseId: number;
  quantity: number;
}

interface Product {
  id: number;
  nameAr: string;
  sku: string;
  barcode?: string | null;
  salePrice: number;
  wholesalePrice?: number | null;
  halfWholesalePrice?: number | null;
  taxRate?: number | null;
  imageUrl?: string | null;
  isActive: boolean;
  departmentId?: number | null;
  unit?: { nameAr: string } | null;
  stockBalances?: StockBalance[];
}

interface Customer {
  id: number;
  nameAr: string;
  company?: string | null;
  loyaltyPoints?: number;
}

interface AppliedCoupon {
  code: string;
  discountAmount: number;
}

interface CartItem {
  productId: number;
  nameAr: string;
  sku: string;
  unitPrice: number;
  qty: number;
  unitName: string;
  stock: number;
  taxRate: number;
}

type PaymentMethod = 'CASH' | 'CARD' | 'NETWORK' | 'CREDIT';
const PAYMENT_METHODS: { code: PaymentMethod; label: string; icon: React.ReactNode }[] = [
  { code: 'CASH', label: 'نقداً', icon: <Banknote size={18} /> },
  { code: 'CARD', label: 'فيزا', icon: <CreditCard size={18} /> },
  { code: 'NETWORK', label: 'شبكة', icon: <Wifi size={18} /> },
  { code: 'CREDIT', label: 'أجل', icon: <Receipt size={18} /> },
];

const CASH_CUSTOMER_ID = 3; // "عميل نقدي عام" — matches the actual walk-in customer seeded in the DB

type PriceTier = 'RETAIL' | 'HALF' | 'WHOLESALE';
const PRICE_TIERS: { code: PriceTier; label: string }[] = [
  { code: 'RETAIL', label: 'تجزئة' },
  { code: 'HALF', label: 'نصف جملة' },
  { code: 'WHOLESALE', label: 'جملة' },
];

/** Resolve the unit price for a product given the selected tier. */
function priceForTier(product: Product, tier: PriceTier): number {
  if (tier === 'WHOLESALE' && product.wholesalePrice != null && Number(product.wholesalePrice) > 0) {
    return Number(product.wholesalePrice);
  }
  if (tier === 'HALF' && product.halfWholesalePrice != null && Number(product.halfWholesalePrice) > 0) {
    return Number(product.halfWholesalePrice);
  }
  return Number(product.salePrice);
}

// --- Toast ---
function toast(msg: string, type: 'success' | 'error' = 'success') {
  const div = document.createElement('div');
  div.className = `fixed top-4 left-1/2 -translate-x-1/2 z-[9999] px-5 py-3 rounded-xl shadow-lg text-white text-sm font-medium ${type === 'success' ? 'bg-green-600' : 'bg-red-600'}`;
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 3000);
}

// --- API helpers ---
const fetchDepartments = async (): Promise<Department[]> => {
  const res = await apiClient.get<Department[]>('/departments');
  return res.data;
};

const fetchWarehouses = async (): Promise<Warehouse[]> => {
  const res = await apiClient.get<PaginatedResponse<Warehouse>>('/warehouses', {
    params: { page: 1, pageSize: 200 },
  });
  return res.data.data.filter((w) => w.isActive);
};

const fetchAllProducts = async (): Promise<Product[]> => {
  // Fetch large page so we have all products for client-side filtering
  const res = await apiClient.get<PaginatedResponse<Product>>('/products', {
    params: { page: 1, pageSize: 500 },
  });
  return res.data.data.filter((p) => p.isActive);
};

const fetchCustomers = async (): Promise<Customer[]> => {
  const res = await apiClient.get<{ data: Customer[] }>('/customers', {
    params: { page: 1, pageSize: 500 },
  });
  return res.data.data;
};

// --- Flatten department tree ---
function flattenDepts(nodes: Department[]): Department[] {
  const result: Department[] = [];
  function walk(list: Department[]) {
    list.forEach((n) => {
      result.push({ id: n.id, nameAr: n.nameAr });
      if (n.children?.length) walk(n.children);
    });
  }
  walk(nodes);
  return result;
}

// --- Get stock for warehouse ---
function getStock(product: Product, warehouseId: number): number {
  const bal = product.stockBalances?.find((b) => b.warehouseId === warehouseId);
  return bal ? Number(bal.quantity) : 0;
}

// --- Product Card ---
function ProductCard({
  product,
  warehouseId,
  onAdd,
  priceTier,
}: {
  product: Product;
  warehouseId: number;
  onAdd: (p: Product) => void;
  priceTier: PriceTier;
}) {
  const stock = getStock(product, warehouseId);
  const displayPrice = priceForTier(product, priceTier);
  return (
    <button
      onClick={() => onAdd(product)}
      className="bg-white rounded-xl border border-app-border shadow-sm p-3 text-right hover:border-primary hover:shadow-md transition-all duration-150 flex flex-col gap-2 group"
    >
      {/* Product image */}
      <div className="w-full aspect-square rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden mb-1">
        {resolveImageUrl(product.imageUrl) ? (
          <img src={resolveImageUrl(product.imageUrl)!} alt={product.nameAr} className="w-full h-full object-cover" />
        ) : (
          <Tag size={28} className="text-gray-300 group-hover:text-primary transition-colors" />
        )}
      </div>
      <p className="text-xs font-semibold text-app-text leading-snug line-clamp-2">{product.nameAr}</p>
      <p className="text-[10px] text-app-muted">{product.sku}</p>
      <div className="flex items-center justify-between mt-auto">
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
            stock > 0 ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
          }`}
        >
          متاح: {stock}
        </span>
        <span className="text-xs font-bold text-primary">{formatMoney(displayPrice)}</span>
      </div>
    </button>
  );
}

// --- Main POS Page ---
export function POSPage() {
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [activeDept, setActiveDept] = useState<number | null>(null); // null = all
  const [cart, setCart] = useState<CartItem[]>([]);
  const [discount, setDiscount] = useState<number>(0);
  const [couponCodeInput, setCouponCodeInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<AppliedCoupon | null>(null);
  const [couponError, setCouponError] = useState('');
  const [redeemPointsInput, setRedeemPointsInput] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('CASH');
  const [customerId, setCustomerId] = useState<number>(CASH_CUSTOMER_ID);
  const [priceTier, setPriceTier] = useState<PriceTier>('RETAIL');
  const [tendered, setTendered] = useState<number>(0);
  const [lastReceipt, setLastReceipt] = useState<ReceiptDoc | null>(null);
  const [warehouseId, setWarehouseId] = useState<number | null>(null);
  const { user } = useAuth();
  const { branchId } = useBranch();

  const searchRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut F1 → focus search, F2 → confirm
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // --- Queries ---
  const { data: departments = [] } = useQuery({
    queryKey: ['departments', 'pos'],
    queryFn: fetchDepartments,
  });

  const { data: products = [], isLoading: loadingProducts } = useQuery({
    queryKey: ['products', 'pos'],
    queryFn: fetchAllProducts,
  });

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses', 'pos'],
    queryFn: fetchWarehouses,
  });

  // Pick the selling warehouse: keep the current choice if still valid, else
  // prefer one in the branch selected in the topbar, else the first warehouse.
  useEffect(() => {
    if (warehouses.length === 0) return;
    if (warehouseId != null && warehouses.some((w) => w.id === warehouseId)) return;
    const inBranch = branchId != null ? warehouses.find((w) => w.branch?.id === branchId) : undefined;
    setWarehouseId((inBranch ?? warehouses[0]).id);
  }, [warehouses, branchId, warehouseId]);

  const { data: customers = [] } = useQuery({
    queryKey: ['customers', 'pos'],
    queryFn: fetchCustomers,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () =>
      (await apiClient.get<{ vatNumber?: string; loyaltyEnabled?: string; loyaltyPointValue?: string; loyaltyEarnRate?: string }>('/settings')).data,
  });
  const loyaltyEnabled = (settings?.loyaltyEnabled ?? 'true') === 'true';
  const loyaltyPointValue = parseFloat(settings?.loyaltyPointValue ?? '0.05');

  const { data: treasuryAccounts = [] } = useQuery({
    queryKey: ['treasury-accounts'],
    queryFn: async () => (await apiClient.get<{ data: { id: number; code: string }[] }>('/treasury/accounts')).data.data,
  });

  const flatDepts = flattenDepts(departments);

  // --- Filtered products ---
  const filtered = products.filter((p) => {
    const matchesDept = activeDept == null || p.departmentId === activeDept;
    const q = search.trim().toLowerCase();
    const matchesSearch =
      !q ||
      p.nameAr.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      (p.barcode ?? '').toLowerCase().includes(q);
    return matchesDept && matchesSearch;
  });

  // --- Cart operations ---
  const addToCart = useCallback(
    (product: Product) => {
      const unitPrice = priceForTier(product, priceTier);
      setCart((prev) => {
        const existing = prev.find((i) => i.productId === product.id);
        const stock = getStock(product, warehouseId ?? 0);
        if (existing) {
          if (existing.qty >= stock && stock > 0) {
            toast(`لا يمكن إضافة أكثر من المتاح في المخزون (${stock})`, 'error');
            return prev;
          }
          // Update unit price to the current tier on re-add
          return prev.map((i) =>
            i.productId === product.id ? { ...i, qty: i.qty + 1, unitPrice } : i
          );
        }
        return [
          ...prev,
          {
            productId: product.id,
            nameAr: product.nameAr,
            sku: product.sku,
            unitPrice,
            qty: 1,
            unitName: product.unit?.nameAr ?? 'حبة',
            stock,
            taxRate: Number(product.taxRate ?? 0),
          },
        ];
      });
      // Brief audio-style feedback toast for scanner adds
    },
    [priceTier, warehouseId]
  );

  // --- Barcode scanner: Enter on the search field exact-matches barcode/SKU ---
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const q = search.trim();
      if (!q) return;
      // Exact match on barcode or SKU (case-insensitive)
      const match = products.find(
        (p) =>
          p.barcode?.toLowerCase() === q.toLowerCase() ||
          p.sku.toLowerCase() === q.toLowerCase()
      );
      if (match) {
        addToCart(match);
        toast(`تمت إضافة: ${match.nameAr}`);
        setSearch('');
      } else if (filtered.length === 1) {
        // If only one result remains, add it (quick single-match add)
        addToCart(filtered[0]);
        setSearch('');
      } else {
        toast('لا يوجد صنف بهذا الباركود', 'error');
      }
    }
  };

  const changeQty = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.productId !== productId) return i;
          const newQty = i.qty + delta;
          if (newQty <= 0) return null as unknown as CartItem;
          if (newQty > i.stock && i.stock > 0) {
            toast(`الحد الأقصى المتاح: ${i.stock}`, 'error');
            return i;
          }
          return { ...i, qty: newQty };
        })
        .filter(Boolean)
    );
  };

  const removeItem = (productId: number) => {
    setCart((prev) => prev.filter((i) => i.productId !== productId));
  };

  const clearCart = () => {
    setCart([]);
    setDiscount(0);
    setCouponCodeInput('');
    setAppliedCoupon(null);
    setCouponError('');
    setRedeemPointsInput('');
    setPaymentMethod('CASH');
    setCustomerId(CASH_CUSTOMER_ID);
  };

  const selectedCustomer = customers.find((c) => c.id === customerId);
  const customerPointsBalance = selectedCustomer?.loyaltyPoints ?? 0;

  // --- Totals ---
  const subtotal = cart.reduce((s, i) => s + i.unitPrice * i.qty, 0);
  const redeemPoints = Math.min(Math.max(0, parseFloat(redeemPointsInput) || 0), customerPointsBalance);
  const pointsValue = redeemPoints * loyaltyPointValue;
  const discountAmt = Math.min(discount + (appliedCoupon?.discountAmount ?? 0) + pointsValue, subtotal);
  const taxableBase = subtotal - discountAmt;
  // Auto VAT from each product's taxRate × its line share
  const taxAmount = cart.reduce((s, i) => {
    const rate = Number(i.taxRate ?? 0);
    if (rate <= 0) return s;
    const lineNet = i.unitPrice * i.qty - discountAmt * ((i.unitPrice * i.qty) / Math.max(subtotal, 1));
    return s + lineNet * (rate / 100);
  }, 0);
  const total = taxableBase + taxAmount;
  const changeDue = paymentMethod === 'CASH' && tendered > 0 ? Math.max(0, tendered - total) : 0;
  const pointsToEarn = loyaltyEnabled ? Math.floor(total * parseFloat(settings?.loyaltyEarnRate ?? '0.1')) : 0;

  const couponValidateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiClient.get<{ coupon: { code: string }; discountAmount: number }>('/coupons/validate', {
        params: { code: couponCodeInput.trim(), subtotal },
      });
      return res.data;
    },
    onSuccess: (data) => {
      setAppliedCoupon({ code: data.coupon.code, discountAmount: data.discountAmount });
      setCouponError('');
    },
    onError: (err) => {
      setAppliedCoupon(null);
      setCouponError(getApiErrorMessage(err, 'كود الكوبون غير صحيح'));
    },
  });

  // --- Submit invoice ---
  // "المدفوع" (tendered) only overrides the status when the cashier explicitly
  // entered a nonzero amount less than the total — otherwise (0, or >= total)
  // a cash/card sale is assumed paid in full, same as before.
  const paidStatus =
    paymentMethod === 'CREDIT' ? 'UNPAID' :
    tendered > 0 && tendered < total ? 'PARTIAL' :
    'PAID';

  // Map NETWORK → CARD for backend (enum CASH|CARD|CREDIT)
  const backendPaymentMethod =
    paymentMethod === 'NETWORK' ? 'CARD' : paymentMethod === 'CREDIT' ? 'CREDIT' : paymentMethod === 'CARD' ? 'CARD' : 'CASH';

  const submitMutation = useMutation({
    mutationFn: () =>
      apiClient.post('/sales-invoices', {
        customerId,
        warehouseId,
        discount,
        tax: Number(taxAmount.toFixed(2)),
        paymentMethod: backendPaymentMethod,
        paidStatus,
        couponCode: appliedCoupon?.code,
        redeemPoints,
        items: cart.map((i) => ({
          productId: i.productId,
          qty: i.qty,
          unitPrice: i.unitPrice,
        })),
      }),
    onSuccess: (res) => {
      const inv = res.data as { id: number; refNo: string };
      toast(`تم إنشاء الفاتورة بنجاح — ${inv.refNo}`);

      // Register the actual amount tendered as a payment linked to this invoice,
      // so its paidStatus/paidAmount and the customer's statement reflect the
      // real partial payment instead of silently treating it as fully paid.
      if (paidStatus === 'PARTIAL') {
        const treasuryCode = paymentMethod === 'CASH' ? '1000' : '1100';
        const treasuryAccountId = treasuryAccounts.find((a) => a.code === treasuryCode)?.id;
        if (treasuryAccountId) {
          apiClient.post('/vouchers', {
            type: 'RECEIPT',
            treasuryAccountId,
            partyType: 'CUSTOMER',
            partyId: customerId,
            salesInvoiceId: inv.id,
            amount: tendered,
            description: `دفعة جزئية عند البيع — ${inv.refNo}`,
            branchId: branchId ?? undefined,
          }).catch(() => {
            toast('تم إنشاء الفاتورة لكن تعذر تسجيل الدفعة الجزئية — سجّلها يدويًا من تفاصيل الفاتورة', 'error');
          });
        }
      }
      // Snapshot the receipt BEFORE clearing the cart.
      const paymentText = PAYMENT_METHODS.find((p) => p.code === paymentMethod)?.label ?? '';
      const customerName = customers.find((c) => c.id === customerId)?.nameAr ?? 'زبون نقدي عام';
      setLastReceipt({
        refNo: inv.refNo,
        cashier: user?.name ?? null,
        customer: customerName,
        paymentText,
        items: cart.map((i) => ({
          name: i.nameAr,
          qty: i.qty,
          unitPrice: i.unitPrice,
          lineTotal: i.unitPrice * i.qty,
        })),
        subtotal,
        discount: discountAmt,
        tax: Number(taxAmount.toFixed(2)),
        total,
        sellerVatNumber: settings?.vatNumber,
      });
      clearCart();
      setTendered(0);
      // Invalidate so stock + invoices reflect the sale
      qc.invalidateQueries({ queryKey: ['products', 'pos'] });
      qc.invalidateQueries({ queryKey: ['sales-invoices'] });
      qc.invalidateQueries({ queryKey: ['sales-invoices-all'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['customer-statement'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
      qc.invalidateQueries({ queryKey: ['coupons'] });
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data
          ?.error ??
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'حدث خطأ أثناء إنشاء الفاتورة';
      toast(msg, 'error');
    },
  });

  const handleConfirm = () => {
    if (cart.length === 0) {
      toast('أضف منتجات إلى السلة أولاً', 'error');
      return;
    }
    if (warehouseId == null) {
      toast('اختر مستودع البيع أولاً', 'error');
      return;
    }
    submitMutation.mutate();
  };

  // F2 shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart, discount, paymentMethod, customerId]);

  return (
    <div className="flex gap-4 h-[calc(100vh-8rem)] overflow-hidden">
      {/* ====== LEFT: Product Grid ====== */}
      <div className="flex-1 flex flex-col gap-3 overflow-hidden">
        {/* Search + warehouse */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-app-muted" />
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="ابحث بالاسم، رمز الصنف SKU، أو امسح الباركود مباشرة (Enter للإضافة)... (F1)"
              className="w-full border border-app-border rounded-xl pr-10 pl-4 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors shadow-sm"
            />
          </div>
          {warehouses.length > 1 && (
            <select
              value={warehouseId ?? ''}
              onChange={(e) => { setWarehouseId(Number(e.target.value)); setCart([]); }}
              title="مستودع البيع"
              className="flex-shrink-0 border border-app-border rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary shadow-sm max-w-[12rem]"
            >
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.nameAr}</option>
              ))}
            </select>
          )}
        </div>

        {/* Department tabs */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 flex-shrink-0">
          <button
            onClick={() => setActiveDept(null)}
            className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              activeDept === null
                ? 'bg-primary text-white border-primary'
                : 'bg-white border-app-border text-app-muted hover:border-primary hover:text-primary'
            }`}
          >
            كل الأقسام
          </button>
          {flatDepts.map((d) => (
            <button
              key={d.id}
              onClick={() => setActiveDept(d.id)}
              className={`flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                activeDept === d.id
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white border-app-border text-app-muted hover:border-primary hover:text-primary'
              }`}
            >
              {d.nameAr}
            </button>
          ))}
        </div>

        {/* Price tier selector */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs text-app-muted">مستوى السعر:</span>
          {PRICE_TIERS.map((t) => (
            <button
              key={t.code}
              onClick={() => setPriceTier(t.code)}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition-colors ${
                priceTier === t.code
                  ? 'bg-accent text-white border-accent'
                  : 'bg-white border-app-border text-app-muted hover:border-accent hover:text-accent'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Product Grid */}
        <div className="flex-1 overflow-y-auto">
          {loadingProducts ? (
            <div className="flex items-center justify-center h-40">
              <span className="inline-block w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-app-muted gap-2">
              <PackageOpen size={36} className="text-gray-300" />
              <p className="text-sm">لا توجد منتجات تطابق البحث</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 pb-4">
              {filtered.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  warehouseId={warehouseId ?? 0}
                  onAdd={addToCart}
                  priceTier={priceTier}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ====== RIGHT: Cart Panel ====== */}
      <div className="w-80 flex-shrink-0 flex flex-col bg-white rounded-2xl border border-app-border shadow-sm overflow-hidden">
        {/* Cart Header */}
        <div className="px-4 py-3 border-b border-app-border bg-gray-50 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <ShoppingCart size={18} className="text-primary" />
            <span className="font-bold text-sm text-app-text">سلة المبيعات</span>
            {cart.length > 0 && (
              <span className="w-5 h-5 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
                {cart.length}
              </span>
            )}
          </div>
          {cart.length > 0 && (
            <button
              onClick={clearCart}
              className="text-xs text-danger hover:underline"
            >
              مسح الكل
            </button>
          )}
        </div>

        {/* Customer Selector */}
        <div className="px-4 py-2 border-b border-app-border flex-shrink-0">
          <label className="text-xs font-medium text-app-muted mb-1 block">الزبون / العميل الحالي</label>
          <div className="relative">
            <select
              value={customerId}
              onChange={(e) => setCustomerId(Number(e.target.value))}
              className="w-full border border-app-border rounded-lg px-3 py-1.5 text-sm text-app-text bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary appearance-none pr-8"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameAr}{c.company ? ` — ${c.company}` : ''}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-app-muted pointer-events-none" />
          </div>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-app-muted gap-3 py-10">
              <ShoppingCart size={36} className="text-gray-200" />
              <p className="text-sm text-center">سلة المبيعات فارغة حالياً</p>
              <p className="text-xs text-center">انقر على منتج لإضافته</p>
            </div>
          ) : (
            cart.map((item) => (
              <div
                key={item.productId}
                className="bg-gray-50 rounded-xl p-2.5 border border-app-border"
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-app-text leading-snug truncate">
                      {item.nameAr}
                    </p>
                    <p className="text-[10px] text-app-muted">{item.sku}</p>
                  </div>
                  <button
                    onClick={() => removeItem(item.productId)}
                    className="text-danger hover:bg-danger-bg rounded-lg p-1 flex-shrink-0"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  {/* Qty stepper */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => changeQty(item.productId, -1)}
                      className="w-6 h-6 rounded-lg border border-app-border bg-white flex items-center justify-center hover:bg-primary hover:text-white hover:border-primary transition-colors"
                    >
                      <Minus size={10} />
                    </button>
                    <span className="w-8 text-center text-sm font-bold">{item.qty}</span>
                    <button
                      onClick={() => changeQty(item.productId, 1)}
                      className="w-6 h-6 rounded-lg border border-app-border bg-white flex items-center justify-center hover:bg-primary hover:text-white hover:border-primary transition-colors"
                    >
                      <Plus size={10} />
                    </button>
                  </div>
                  <div className="text-left">
                    <p className="text-[10px] text-app-muted">{formatMoney(item.unitPrice)} × {item.qty}</p>
                    <p className="text-xs font-bold text-primary">{formatMoney(item.unitPrice * item.qty)}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Totals + Controls */}
        <div className="border-t border-app-border px-4 py-3 flex-shrink-0 space-y-3">
          {/* Discount */}
          <div className="flex items-center gap-2">
            <label className="text-xs text-app-muted whitespace-nowrap">خصم إضافي (ر.س)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={discount || ''}
              onChange={(e) => setDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
              placeholder="0.00"
              className="flex-1 border border-app-border rounded-lg px-2 py-1 text-sm text-app-text bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary min-w-0"
            />
          </div>

          {/* Coupon */}
          {appliedCoupon ? (
            <div className="flex items-center justify-between bg-success-bg rounded-lg px-2.5 py-1.5">
              <span className="text-xs font-medium text-success">كوبون {appliedCoupon.code} مُطبّق (− {formatMoney(appliedCoupon.discountAmount)})</span>
              <button
                onClick={() => { setAppliedCoupon(null); setCouponCodeInput(''); setCouponError(''); }}
                className="text-xs text-success hover:underline"
              >
                إزالة
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={couponCodeInput}
                onChange={(e) => { setCouponCodeInput(e.target.value.toUpperCase()); setCouponError(''); }}
                placeholder="كود الكوبون"
                className="flex-1 border border-app-border rounded-lg px-2 py-1 text-sm text-app-text bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary min-w-0"
              />
              <button
                onClick={() => couponCodeInput.trim() && couponValidateMutation.mutate()}
                disabled={!couponCodeInput.trim() || couponValidateMutation.isPending}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-primary-50 text-primary hover:bg-primary/10 disabled:opacity-50 whitespace-nowrap"
              >
                تطبيق
              </button>
            </div>
          )}
          {couponError && <p className="text-xs text-danger">{couponError}</p>}

          {/* Loyalty points redemption */}
          {loyaltyEnabled && customerPointsBalance > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-app-muted whitespace-nowrap">
                استبدال نقاط (المتاح: {customerPointsBalance.toLocaleString('en-US')})
              </label>
              <input
                type="number"
                min={0}
                max={customerPointsBalance}
                step={1}
                value={redeemPointsInput}
                onChange={(e) => setRedeemPointsInput(e.target.value)}
                placeholder="0"
                className="flex-1 border border-app-border rounded-lg px-2 py-1 text-sm text-app-text bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary min-w-0"
              />
            </div>
          )}
          {redeemPoints > 0 && (
            <p className="text-xs text-success">سيتم خصم {formatMoney(pointsValue)} مقابل {redeemPoints.toLocaleString('en-US')} نقطة</p>
          )}

          {/* Subtotal */}
          <div className="flex justify-between text-sm">
            <span className="text-app-muted">المجموع الفرعي</span>
            <span className="font-mono">{formatMoney(subtotal)}</span>
          </div>
          {discountAmt > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-app-muted">الخصم</span>
              <span className="font-mono text-danger">− {formatMoney(discountAmt)}</span>
            </div>
          )}
          {taxAmount > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-app-muted">ضريبة القيمة المضافة</span>
              <span className="font-mono text-app-muted">+ {formatMoney(taxAmount)}</span>
            </div>
          )}

          {/* Total */}
          <div className="flex justify-between items-center bg-primary-50 rounded-xl px-3 py-2">
            <span className="text-sm font-bold text-primary">إجمالي الفاتورة</span>
            <span className="text-base font-bold text-primary font-mono">{formatMoney(total)}</span>
          </div>
          {pointsToEarn > 0 && (
            <p className="text-xs text-app-muted text-center">سيحصل العميل على {pointsToEarn.toLocaleString('en-US')} نقطة ولاء من هذه الفاتورة</p>
          )}

          {/* Payment method */}
          <div className="grid grid-cols-4 gap-1">
            {PAYMENT_METHODS.map((pm) => (
              <button
                key={pm.code}
                onClick={() => setPaymentMethod(pm.code)}
                className={`flex flex-col items-center gap-0.5 py-2 rounded-xl text-[10px] font-medium border transition-all ${
                  paymentMethod === pm.code
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white border-app-border text-app-muted hover:border-primary hover:text-primary'
                }`}
              >
                {pm.icon}
                {pm.label}
              </button>
            ))}
          </div>

          {/* Tendered + change (cash only) */}
          {paymentMethod === 'CASH' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-app-muted block mb-0.5">المدفوع</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={tendered || ''}
                  onChange={(e) => setTendered(Math.max(0, parseFloat(e.target.value) || 0))}
                  placeholder="0.00"
                  className="w-full border border-app-border rounded-lg px-2 py-1 text-sm text-app-text bg-white focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
              </div>
              <div>
                <label className="text-[10px] text-app-muted block mb-0.5">الباقي للعميل</label>
                <div className="border border-app-border rounded-lg px-2 py-1 text-sm font-bold text-success bg-success-bg text-center">
                  {formatMoney(changeDue)}
                </div>
              </div>
            </div>
          )}

          {/* Confirm Button */}
          <button
            onClick={handleConfirm}
            disabled={cart.length === 0 || warehouseId == null || submitMutation.isPending}
            className="w-full py-3 rounded-xl bg-accent hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm flex items-center justify-center gap-2 transition-colors"
          >
            {submitMutation.isPending ? (
              <span className="inline-block w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Receipt size={18} />
            )}
            إرسال وتأكيد الطلب السريع (F2)
          </button>
        </div>
      </div>

      {/* Sale success — offer receipt printing */}
      <Modal
        open={!!lastReceipt}
        onClose={() => setLastReceipt(null)}
        title="تمت العملية بنجاح"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setLastReceipt(null)}>إغلاق</Button>
            <Button
              icon={<Printer size={15} />}
              onClick={() => lastReceipt && printReceipt(lastReceipt)}
            >
              طباعة الإيصال
            </Button>
          </>
        }
      >
        <div className="flex flex-col items-center text-center gap-2 py-2">
          <CheckCircle2 size={44} className="text-success" />
          <p className="text-sm text-app-text">تم إنشاء الفاتورة وتسجيل البيع بنجاح.</p>
          {lastReceipt?.refNo && (
            <p className="font-mono font-bold text-primary">{lastReceipt.refNo}</p>
          )}
          <p className="text-lg font-bold text-primary">{formatMoney(lastReceipt?.total ?? 0)}</p>
        </div>
      </Modal>
    </div>
  );
}
