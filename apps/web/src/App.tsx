import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './contexts/AuthContext';
import { DateRangeProvider } from './contexts/DateRangeContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppShell } from './layouts/AppShell';
import { LoginPage } from './pages/auth/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { UnderConstruction } from './pages/UnderConstruction';
import { ProductsPage } from './pages/products/ProductsPage';
import { DepartmentsPage } from './pages/products/DepartmentsPage';
import { BrandsPage } from './pages/products/BrandsPage';
import { UnitsPage } from './pages/products/UnitsPage';
import { WarehousesPage } from './pages/inventory/WarehousesPage';
import { StockPage } from './pages/inventory/StockPage';
import { StockTransfersPage } from './pages/inventory/StockTransfersPage';
import { StockCountPage } from './pages/inventory/StockCountPage';
import { BomPage } from './pages/manufacturing/BomPage';
import { WorkOrdersPage } from './pages/manufacturing/WorkOrdersPage';
import { CouponsPage } from './pages/marketing/CouponsPage';
import { BarcodeLabelsPage } from './pages/inventory/BarcodeLabelsPage';
import { CustomersPage } from './pages/sales/CustomersPage';
import { SalesInvoicesPage } from './pages/sales/SalesInvoicesPage';
import { SalesReturnsPage, PurchaseReturnsPage } from './pages/returns/ReturnsPage';
import { POSPage } from './pages/pos/POSPage';
import { SuppliersPage } from './pages/purchases/SuppliersPage';
import { PurchaseInvoicesPage } from './pages/purchases/PurchaseInvoicesPage';
import { AccountsPage } from './pages/accounting/AccountsPage';
import { JournalPage } from './pages/accounting/JournalPage';
import { PartnersPage } from './pages/accounting/PartnersPage';
import { CostCentersPage } from './pages/accounting/CostCentersPage';
import { BudgetsPage } from './pages/accounting/BudgetsPage';
import { RecurringEntriesPage } from './pages/accounting/RecurringEntriesPage';
import { JournalApprovalsPage } from './pages/accounting/JournalApprovalsPage';
import { VouchersPage } from './pages/treasury/VouchersPage';
import { PromissoryNotesPage } from './pages/treasury/PromissoryNotesPage';
import { CashMovementPage } from './pages/treasury/CashMovementPage';
import { FixedAssetsPage } from './pages/assets/FixedAssetsPage';
import { EmployeesPage } from './pages/hr/EmployeesPage';
import { PayrollPage } from './pages/hr/PayrollPage';
import { OrgChartPage } from './pages/hr/OrgChartPage';
import { ReportsPage } from './pages/admin/ReportsPage';
import { UsersPage } from './pages/admin/UsersPage';
import { RolesPage } from './pages/admin/RolesPage';
import { SettingsPage } from './pages/admin/SettingsPage';
import { AlertsPage } from './pages/admin/AlertsPage';
import { BranchesPage } from './pages/admin/BranchesPage';
import { AuditLogPage } from './pages/admin/AuditLogPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <DateRangeProvider>
        <BrowserRouter>
          <Routes>
            {/* Public routes */}
            <Route path="/login" element={<LoginPage />} />

            {/* Protected routes — all inside the AppShell */}
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <AppShell />
                </ProtectedRoute>
              }
            >
              {/* Dashboard */}
              <Route index element={<DashboardPage />} />

              {/* Products & Inventory */}
              <Route path="products" element={<ProductsPage />} />
              <Route path="departments" element={<DepartmentsPage />} />
              <Route path="brands" element={<BrandsPage />} />
              <Route path="units" element={<UnitsPage />} />
              <Route path="warehouses" element={<WarehousesPage />} />
              <Route path="stock" element={<StockPage />} />
              <Route path="stock-transfer" element={<StockTransfersPage />} />
              <Route path="stock-count" element={<StockCountPage />} />
              <Route path="barcode-labels" element={<BarcodeLabelsPage />} />

              {/* Sales & Purchases */}
              <Route path="pos" element={<POSPage />} />
              <Route path="customers" element={<CustomersPage />} />
              <Route path="sales-invoices" element={<SalesInvoicesPage />} />
              <Route path="sales-returns" element={<SalesReturnsPage />} />
              <Route path="suppliers" element={<SuppliersPage />} />
              <Route path="purchase-invoices" element={<PurchaseInvoicesPage />} />
              <Route path="purchase-returns" element={<PurchaseReturnsPage />} />

              {/* Accounts & Partners */}
              <Route path="partners" element={<PartnersPage />} />
              <Route path="accounts" element={<AccountsPage />} />
              <Route path="journal" element={<JournalPage />} />
              <Route path="cost-centers" element={<CostCentersPage />} />
              <Route path="budgets" element={<BudgetsPage />} />
              <Route path="recurring-entries" element={<RecurringEntriesPage />} />
              <Route path="journal-approvals" element={<JournalApprovalsPage />} />

              {/* Treasury & Vouchers */}
              <Route path="vouchers" element={<VouchersPage />} />
              <Route path="promissory-notes" element={<PromissoryNotesPage />} />
              <Route path="cash-movement" element={<CashMovementPage />} />

              {/* Manufacturing */}
              <Route path="bom" element={<BomPage />} />
              <Route path="work-orders" element={<WorkOrdersPage />} />

              {/* Marketing */}
              <Route path="coupons" element={<CouponsPage />} />

              {/* Fixed Assets */}
              <Route path="assets" element={<FixedAssetsPage />} />

              {/* Human Resources */}
              <Route path="employees" element={<EmployeesPage />} />
              <Route path="payroll" element={<PayrollPage />} />
              <Route path="org-chart" element={<OrgChartPage />} />

              {/* Admin & Reports */}
              <Route path="reports" element={<ReportsPage />} />
              <Route path="alerts" element={<AlertsPage />} />
              <Route path="branches" element={<BranchesPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="roles" element={<RolesPage />} />
              <Route path="audit" element={<AuditLogPage />} />

              {/* Catch-all: redirect unknown protected paths to dashboard */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>

            {/* Catch-all public: redirect to login */}
            <Route path="*" element={<Navigate to="/login" replace />} />
          </Routes>
        </BrowserRouter>
        </DateRangeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
