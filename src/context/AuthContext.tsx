import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { authApi } from '../api/authApi'
import type { User } from '../types'
import { getErrorMessage } from '../utils/errors'
import { clearSession, getStoredUser, getToken, persistSession } from '../utils/session'
import { hasPermission, type Permission } from '../utils/permissions'

type AuthContextValue = {
  user: User | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  can: (permission: Permission) => boolean
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(getStoredUser())
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const token = getToken()
    if (!token) {
      setUser(null)
      setReady(true)
      return
    }

    authApi
      .me()
      .then((me) => {
        persistSession(token, me)
        setUser(me)
      })
      .catch(() => {
        clearSession()
        setUser(null)
      })
      .finally(() => setReady(true))
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const result = await authApi.login(email, password)
    persistSession(result.token, result.user)
    setUser(result.user)
  }, [])

  const logout = useCallback(async () => {
    try {
      await authApi.logout()
    } catch {
      /* token may already be invalid */
    }
    clearSession()
    setUser(null)
  }, [])

  const can = useCallback((permission: Permission) => hasPermission(user?.role, permission), [user])

  const value = useMemo(() => ({ user, ready, login, logout, can }), [user, ready, login, logout, can])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error(getErrorMessage(new Error('Auth context missing')))
  return ctx
}
