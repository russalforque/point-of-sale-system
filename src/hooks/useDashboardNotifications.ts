import { useMemo } from 'react'

import { useAuth } from '../context/AuthContext'
import { useSettings } from '../context/SettingsContext'
import { formatMoney } from '../utils/format'
import { formatQty } from '../services/units'
import type { LowStockIngredient } from '../types'
import { usePersistentNotifications } from './usePersistentNotifications'

export type NotificationKind = 'out-of-stock' | 'low-stock' | 'sale'

export interface AppNotification {
  id: string
  kind: NotificationKind
  title: string
  description: string
  /** When it happened (ISO). Stock alerts are ongoing states, so they have none. */
  at?: string
  /** Where to go to deal with it; absent when the user lacks permission for that screen. */
  action?: { label: string; to: string }
  read: boolean
}

/** The slice of dashboard data notifications are built from (shared by the desktop and phone dashboards). */
interface NotificationSource {
  lowStockProducts?: { id: string | number; name: string; sku: string; stockQuantity: number; reorderLevel: number }[]
  /** Ingredients and supplies running low (food-service stores). */
  lowStockIngredients?: LowStockIngredient[]
  recentTransactions?: {
    id: string | number
    invoiceNumber: string
    customerName?: string | null
    total: number
    createdAt: string | Date
    paymentMethod?: string
  }[]
}

const RECENT_SALES = 3

/**
 * Notifications derived from the latest dashboard data, with read / dismissed state
 * persisted per user. IDs (`oos-`, `low-`, `tx-`) are stable so saved state carries over.
 */
export function useDashboardNotifications(data: NotificationSource | null | undefined) {
  const { settings } = useSettings()
  const { can } = useAuth()

  const canManageStock = can('inventory.manage')
  const canViewProducts = can('products.view')
  const canViewReports = can('reports.view')

  const generated = useMemo<AppNotification[]>(() => {
    if (!data) return []

    const stockAction = canManageStock
      ? { label: 'Restock', to: '/inventory' }
      : canViewProducts
        ? { label: 'View product', to: '/products' }
        : undefined
    const items: AppNotification[] = []
    const lowStock = data.lowStockProducts ?? []

    // Out of stock first: it's losing sales right now.
    for (const p of lowStock.filter((p) => p.stockQuantity <= 0)) {
      items.push({
        id: `oos-${p.id}`,
        kind: 'out-of-stock',
        title: p.name,
        description: `No units left · SKU ${p.sku}`,
        action: stockAction,
        read: false,
      })
    }

    for (const p of lowStock.filter((p) => p.stockQuantity > 0)) {
      items.push({
        id: `low-${p.id}`,
        kind: 'low-stock',
        title: p.name,
        description: `Only ${p.stockQuantity} left · alert at ${p.reorderLevel}`,
        action: stockAction,
        read: false,
      })
    }

    // Ingredients: out first, then low. A café can't sell lattes without milk.
    const ingredientAction =
      can('inventory.manage') || can('inventory.receive') ? { label: 'Restock', to: '/ingredients?tab=stock' } : undefined
    const ingredients = data.lowStockIngredients ?? []
    for (const item of [...ingredients.filter((i) => i.onHand <= 0), ...ingredients.filter((i) => i.onHand > 0)]) {
      items.push({
        id: `${item.onHand <= 0 ? 'ing-oos' : 'ing-low'}-${item.id}`,
        kind: item.onHand <= 0 ? 'out-of-stock' : 'low-stock',
        title: item.name,
        description:
          item.onHand <= 0
            ? 'Out · recipes using it can’t be sold'
            : `Only ${formatQty(item.onHand, item.baseUnit)} left · alert at ${formatQty(item.reorderLevel, item.baseUnit)}`,
        action: ingredientAction,
        read: false,
      })
    }

    for (const tx of (data.recentTransactions ?? []).slice(0, RECENT_SALES)) {
      items.push({
        id: `tx-${tx.id}`,
        kind: 'sale',
        title: `Sale ${formatMoney(tx.total, settings.currencySymbol)}`,
        description: [tx.invoiceNumber, tx.customerName || 'Walk-in customer', tx.paymentMethod].filter(Boolean).join(' · '),
        at: tx.createdAt instanceof Date ? tx.createdAt.toISOString() : tx.createdAt,
        action: canViewReports ? { label: 'View sales', to: '/reports' } : undefined,
        read: false,
      })
    }

    return items
  }, [data, settings.currencySymbol, canManageStock, canViewProducts, canViewReports, can])

  return usePersistentNotifications(generated, Boolean(data))
}
