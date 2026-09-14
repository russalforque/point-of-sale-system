import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { SettingsProvider } from './context/SettingsContext'
import { ToastProvider } from './context/ToastContext'
import { CheckoutProvider } from './context/CheckoutContext'
import { MainLayout } from './components/layout/MainLayout'
import { GuestRoute, ProtectedRoute } from './routes/guards'
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
import { initializeDatabase } from './database/database'

export default function App() {
useEffect(() => {
  initializeDatabase().catch((error) => {
    console.error('SQLite database initialization failed:', error)
  })
}, [])

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
                    <Route path="/sales" element={<SalesPage />} />
                    <Route path="/payment" element={<PaymentPage />} />

                    <Route path="/customers" element={<CustomersPage />} />
                    <Route path="/customers/create" element={<CustomersPage />} />
                    <Route path="/customers/edit/:id" element={<CustomersPage />} />
                    <Route path="/customers/:id" element={<CustomersPage />} />

                    <Route path="/inventory" element={<InventoryPage />} />

                    <Route path="/products" element={<ProductsPage />} />
                    <Route path="/products/create" element={<ProductsPage />} />
                    <Route path="/products/edit/:id" element={<ProductsPage />} />
                    <Route path="/products/:id" element={<ProductsPage />} />

                    <Route path="/categories" element={<CategoriesPage />} />
                    <Route path="/suppliers" element={<SuppliersPage />} />
                    <Route path="/reports" element={<ReportsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
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