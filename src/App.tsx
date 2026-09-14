import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { SettingsProvider } from './context/SettingsContext'
import { ToastProvider } from './context/ToastContext'
import { CheckoutProvider } from './context/CheckoutContext'
import { MainLayout } from './components/layout/MainLayout'
import { GuestRoute, ProtectedRoute, RequirePermission } from './routes/guards'
import { LoginPage } from './pages/Login'
import { DashboardPage } from './pages/Dashboard'
import { SalesPage } from './pages/Sales'
import { PaymentPage } from './pages/Payment'
import { CustomersPage } from './pages/Customers/CustomersPage'
import { ProductsPage } from './pages/Products/ProductsPage'
import { CategoriesPage } from './pages/Categories/CategoriesPage'
import { SuppliersPage } from './pages/Suppliers/SuppliersPage'
import { InventoryPage } from './pages/Inventory'
import { ReportsPage } from './pages/Reports'
import { SettingsPage } from './pages/Settings'
import { UsersPage } from './pages/Users/UsersPage'
import { AccessDeniedPage } from './pages/AccessDenied'
import { PrinterSettingsPage } from './pages/PrinterSettings'

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <SettingsProvider>
          <CheckoutProvider>
            <BrowserRouter>
              <Routes>
                <Route element={<GuestRoute />}>
                  <Route path="/login" element={<LoginPage />} />
                </Route>

                <Route element={<ProtectedRoute />}>
                  <Route element={<MainLayout />}>
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/access-denied" element={<AccessDeniedPage />} />

                    <Route element={<RequirePermission permission="sales.process" />}>
                      <Route path="/sales" element={<SalesPage />} />
                      <Route path="/payment" element={<PaymentPage />} />
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
                      <Route path="/reports" element={<ReportsPage />} />
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
            </BrowserRouter>
          </CheckoutProvider>
        </SettingsProvider>
      </ToastProvider>
    </AuthProvider>
  )
}
