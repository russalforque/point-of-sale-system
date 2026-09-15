import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { AppLoader } from '../components/ui/States'
import type { Permission } from '../utils/permissions'

export function ProtectedRoute() {
  const { user, ready } = useAuth()
  if (!ready) return <AppLoader />
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

export function GuestRoute() {
  const { user, ready } = useAuth()
  if (!ready) return <AppLoader />
  if (user) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

export function RequirePermission({ permission }: { permission: Permission }) {
  const { can } = useAuth()
  if (!can(permission)) return <Navigate to="/access-denied" replace />
  return <Outlet />
}
