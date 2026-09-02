import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { settingsApi } from '../api/settingsApi'
import { useAuth } from './AuthContext'
import type { StoreSetting } from '../types'

const fallback: StoreSetting = {
  id: 0,
  storeName: 'Sellix POS',
  phone: null,
  email: null,
  address: null,
  currency: 'PHP',
  currencySymbol: '₱',
  taxRate: 0.12,
  receiptFooter: '',
  showLogoOnReceipt: false,
}

type SettingsContextValue = {
  settings: StoreSetting
  reload: () => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [settings, setSettings] = useState<StoreSetting>(fallback)

  const reload = useCallback(async () => {
    if (!user) return
    try {
      setSettings(await settingsApi.get())
    } catch {
      /* keep last known store settings */
    }
  }, [user])

  useEffect(() => {
    void reload()
  }, [reload])

  const value = useMemo(() => ({ settings, reload }), [settings, reload])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('Settings context missing')
  return ctx
}
