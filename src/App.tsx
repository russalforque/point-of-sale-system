import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { lazy, Suspense } from 'react'
import { AppLoader } from './components/ui/States'
import { isDesktop } from './services/platform'
import { AuthProvider } from './context/AuthContext'
import { SettingsProvider } from './context/SettingsContext'
import { ToastProvider } from './context/ToastContext'
import { CheckoutProvider } from './context/CheckoutContext'
import { MainLayout } from './components/layout/MainLayout'
import { GuestRoute, ProtectedRoute, RequirePermission } from './routes/guards'
import { LoginPage } from './pages/Login'
import { SalesPage } from './pages/Sales'
import { PaymentPage } from './pages/Payment'
import { CustomersPage } from './pages/Customers/CustomersPage'
import { ProductsPage } from './pages/Products/ProductsPage'
import { CategoriesPage } from './pages/Categories/CategoriesPage'
import { SuppliersPage } from './pages/Suppliers/SuppliersPage'
import { InventoryPage } from './pages/Inventory'
import { SettingsPage } from './pages/Settings'
import { UsersPage } from './pages/Users/UsersPage'
import { ShiftPage } from './pages/Shift/ShiftPage'
import { ShiftHistoryPage } from './pages/Shift/ShiftHistoryPage'
import { AccessDeniedPage } from './pages/AccessDenied'
import { PrinterSettingsPage } from './pages/PrinterSettings'
import { ReturnsPage } from './pages/Returns/ReturnsPage'
import { StockCountPage } from './pages/Inventory/StockCountPage'
import { ReceiveStockPage } from './pages/Inventory/ReceiveStockPage'
import { AuditLogPage } from './pages/AuditLog/AuditLogPage'
import { PurchaseOrdersPage } from './pages/PurchaseOrders/PurchaseOrdersPage'
import { ExpensesPage } from './pages/Expenses/ExpensesPage'
import { IngredientsPage } from './pages/Ingredients/IngredientsPage'
import { ModifiersPage } from './pages/Modifiers/ModifiersPage'
import { useSettings } from './context/SettingsContext'
import { LaundryDashboard } from './pages/Laundry/Dashboard'
import { LaundryNewOrder } from './pages/Laundry/NewOrder'
import { LaundryOrders, LaundryOrderDetail } from './pages/Laundry/Orders'
import { LaundryServices } from './pages/Laundry/Services'
import { LaundryReports } from './pages/Laundry/Reports'
import { useVisualViewport } from './hooks/useVisualViewport'
import './components/laundry/mobile.css'

// Charts are loaded only when opened; checkout and sign-in do not parse the reporting bundle.
const DashboardPage = lazy(async () => ({ default: (await import('./pages/Dashboard')).DashboardPage }))
const ReportsPage = lazy(async () => ({ default: (await import('./pages/Reports')).ReportsPage }))

function BusinessDashboard() {
  const { settings } = useSettings()
  return settings.businessType === 'laundry' ? <LaundryDashboard /> : <DashboardPage />
}
function BusinessReports() {
  const { settings } = useSettings()
  return settings.businessType === 'laundry' ? <LaundryReports /> : <ReportsPage />
}

export default function App() {
  useVisualViewport()
  const Router = isDesktop() ? HashRouter : BrowserRouter
  return (
    <AuthProvider>
      <ToastProvider>
        <SettingsProvider>
          <CheckoutProvider>
            <Router>
              <Suspense fallback={<AppLoader label="Loading Sellix…" />}>
              <Routes>
                <Route element={<GuestRoute />}>
                  <Route path="/login" element={<LoginPage />} />
                </Route>

                <Route element={<ProtectedRoute />}>
                  <Route element={<MainLayout />}>
                    <Route path="/dashboard" element={<BusinessDashboard />} />
                    <Route path="/access-denied" element={<AccessDeniedPage />} />

                    <Route element={<RequirePermission permission="sales.process" />}>
                      <Route path="/laundry/new" element={<LaundryNewOrder />} />
                      <Route path="/laundry/orders" element={<LaundryOrders />} />
                      <Route path="/laundry/orders/:id" element={<LaundryOrderDetail />} />
                      <Route path="/sales" element={<SalesPage />} />
                      <Route path="/payment" element={<PaymentPage />} />
                      <Route path="/shift" element={<ShiftPage />} />
                      {/* Cashiers can open returns; refunds and voids then need a manager PIN. */}
                      <Route path="/returns" element={<ReturnsPage />} />
                    </Route>

                    <Route element={<RequirePermission permission="shifts.manage" />}>
                      <Route path="/shift-history" element={<ShiftHistoryPage />} />
                    </Route>

                    <Route element={<RequirePermission permission="customers.view" />}>
                      <Route path="/customers" element={<CustomersPage />} />
                      <Route path="/customers/create" element={<CustomersPage />} />
                      <Route path="/customers/edit/:id" element={<CustomersPage />} />
                      <Route path="/customers/:id" element={<CustomersPage />} />
                    </Route>

                    <Route element={<RequirePermission permission="inventory.manage" />}>
                      <Route path="/inventory" element={<InventoryPage />} />
                    </Route>

                    <Route element={<RequirePermission permission="inventory.count" />}>
                      <Route path="/stock-count" element={<StockCountPage />} />
                    </Route>

                    <Route element={<RequirePermission permission="inventory.receive" />}>
                      <Route path="/receive-stock" element={<ReceiveStockPage />} />
                    </Route>

                    {/* Baristas reach it to log waste and make batches; managers for everything else. */}
                    <Route
                      element={<RequirePermission permission={['inventory.manage', 'inventory.count', 'inventory.waste', 'inventory.produce']} />}
                    >
                      <Route path="/ingredients" element={<IngredientsPage />} />
                    </Route>

                    <Route element={<RequirePermission permission="products.manage" />}>
                      <Route path="/laundry/services" element={<LaundryServices />} />
                      <Route path="/modifiers" element={<ModifiersPage />} />
                    </Route>

                    <Route element={<RequirePermission permission="purchasing.manage" />}>
                      <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
                    </Route>

                    <Route element={<RequirePermission permission="expenses.manage" />}>
                      <Route path="/expenses" element={<ExpensesPage />} />
                    </Route>

                    <Route element={<RequirePermission permission="audit.view" />}>
                      <Route path="/audit-log" element={<AuditLogPage />} />
                    </Route>

                    <Route element={<RequirePermission permission="products.view" />}>
                      <Route path="/products" element={<ProductsPage />} />
                      <Route path="/products/create" element={<ProductsPage />} />
                      <Route path="/products/edit/:id" element={<ProductsPage />} />
                      <Route path="/products/:id" element={<ProductsPage />} />
                    </Route>

                    <Route element={<RequirePermission permission="categories.manage" />}>
                      <Route path="/categories" element={<CategoriesPage />} />
                    </Route>

                    <Route element={<RequirePermission permission="suppliers.manage" />}>
                      <Route path="/suppliers" element={<SuppliersPage />} />
                    </Route>

                    <Route element={<RequirePermission permission="reports.view" />}>
                      <Route path="/reports" element={<BusinessReports />} />
                    </Route>

                    <Route element={<RequirePermission permission="settings.view" />}>
                      <Route path="/settings" element={<SettingsPage />} />
                    </Route>

                    <Route element={<RequirePermission permission="users.manage" />}>
                      <Route path="/users" element={<UsersPage />} />
                    </Route>

                    <Route element={<RequirePermission permission="printer.configure" />}>
                      <Route path="/printer-settings" element={<PrinterSettingsPage />} />
                    </Route>
                  </Route>
                </Route>

                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
              </Suspense>
            </Router>
          </CheckoutProvider>
        </SettingsProvider>
      </ToastProvider>
    </AuthProvider>
  )
}
