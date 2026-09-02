import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Spinner } from '../components/ui/States'

export function ProtectedRoute() {
  const { user, ready } = useAuth()
  if (!ready) return <Spinner label="Checking session…" />
  if (!user) return <Navigate to="/login" replace />
  return <Outlet />
}

export function GuestRoute() {
  const { user, ready } = useAuth()
  if (!ready) return <Spinner label="Checking session…" />
  if (user) return <Navigate to="/dashboard" replace />
  return <Outlet />
}
