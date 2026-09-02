import type { InventoryHistory, InventoryItem, PagedResult } from '../types'
import client from './axios'

export const inventoryApi = {
  list: (params: { search?: string; stockStatus?: string; page?: number; pageSize?: number }) =>
    client.get<PagedResult<InventoryItem>>('/api/inventory', { params }).then((r) => r.data),
  history: (params: { productId?: number; page?: number; pageSize?: number }) =>
    client.get<PagedResult<InventoryHistory>>('/api/inventory/history', { params }).then((r) => r.data),
  adjust: (payload: { productId: number; type: number; quantity: number; reason: string }) =>
    client.post('/api/inventory/adjust', payload).then((r) => r.data),
}
