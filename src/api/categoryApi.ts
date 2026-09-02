import type { Category } from '../types'
import client from './axios'

export type CategoryPayload = { name: string; description?: string; isActive: boolean }

export const categoryApi = {
  list: (isActive?: boolean) =>
    client.get<Category[]>('/api/categories', { params: { isActive } }).then((r) => r.data),
  get: (id: number) => client.get<Category>(`/api/categories/${id}`).then((r) => r.data),
  create: (payload: CategoryPayload) => client.post<Category>('/api/categories', payload).then((r) => r.data),
  update: (id: number, payload: CategoryPayload) =>
    client.put<Category>(`/api/categories/${id}`, payload).then((r) => r.data),
  remove: (id: number) => client.delete(`/api/categories/${id}`),
}
