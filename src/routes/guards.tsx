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

/** Allows the route when the user has `permission`, or any one of a list of permissions. */
export function RequirePermission({ permission }: { permission: Permission | Permission[] }) {
  const { can } = useAuth()
  const allowed = Array.isArray(permission) ? permission.some(can) : can(permission)
  if (!allowed) return <Navigate to="/access-denied" replace />
  return <Outlet />
}
