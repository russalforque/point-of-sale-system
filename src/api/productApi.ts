import type { PagedResult, Product } from '../types'
import client from './axios'

export type ProductPayload = {
  sku: string
  name: string
  description?: string
  categoryId: number
  supplierId?: number | null
  costPrice: number
  sellingPrice: number
  stockQuantity: number
  reorderLevel: number
  isActive: boolean
  imageUrl?: string
}

export const productApi = {
  list: (params: {
    search?: string
    categoryId?: number
    stockStatus?: string
    isActive?: boolean
    page?: number
    pageSize?: number
  }) => client.get<PagedResult<Product>>('/api/products', { params }).then((r) => r.data),
  catalog: (params?: { search?: string; categoryId?: number }) =>
    client.get<Product[]>('/api/products/catalog', { params }).then((r) => r.data),
  get: (id: number) => client.get<Product>(`/api/products/${id}`).then((r) => r.data),
  create: (payload: ProductPayload) => client.post<Product>('/api/products', payload).then((r) => r.data),
  update: (id: number, payload: ProductPayload) =>
    client.put<Product>(`/api/products/${id}`, payload).then((r) => r.data),
  deactivate: (id: number) => client.delete(`/api/products/${id}`),
}
