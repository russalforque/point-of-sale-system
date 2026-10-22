import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { settingsApi } from '../api/settingsApi'
import { useAuth } from './AuthContext'
import type { StoreSetting } from '../types'

const fallback: StoreSetting = {
  id: 0,
  businessType: 'retail',
  businessSetupComplete: true,
  storeName: 'Sellix POS',
  phone: null,
  email: null,
  address: null,
  currency: 'PHP',
  currencySymbol: '₱',
  taxRate: 0.12,
  receiptFooter: '',
  showLogoOnReceipt: false,
  maxDiscountPercent: 10,
  seniorDiscountPercent: 20,
  loyaltyEnabled: false,
  loyaltyAmountPerPoint: 100,
  loyaltyPointValue: 1,
  creditEnabled: false,
  creditDefaultDays: 30,
  allowNegativeStock: false,
  foodServiceEnabled: false,
}

type SettingsContextValue = {
  settings: StoreSetting
  error: string | null
  reload: () => Promise<void>
}

const SettingsContext = createContext<SettingsContextValue | undefined>(undefined)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [settings, setSettings] = useState<StoreSetting>(fallback)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!user) return
    try {
      setSettings(await settingsApi.get())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load store settings.')
    }
  }, [user])

  useEffect(() => {
    void reload()
  }, [reload])

  const value = useMemo(() => ({ settings, reload, error }), [settings, reload, error])
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('Settings context missing')
  return ctx
}
