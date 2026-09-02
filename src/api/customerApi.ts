import type { Customer, PagedResult } from '../types'
import client from './axios'

export type CustomerPayload = {
  fullName: string
  phone?: string
  email?: string
  address?: string
  isActive: boolean
}

export const customerApi = {
  list: (params: { search?: string; isActive?: boolean; page?: number; pageSize?: number }) =>
    client.get<PagedResult<Customer>>('/api/customers', { params }).then((r) => r.data),
  lookup: (search?: string) =>
    client.get<Customer[]>('/api/customers/lookup', { params: { search } }).then((r) => r.data),
  get: (id: number) => client.get<Customer>(`/api/customers/${id}`).then((r) => r.data),
  create: (payload: CustomerPayload) => client.post<Customer>('/api/customers', payload).then((r) => r.data),
  update: (id: number, payload: CustomerPayload) =>
    client.put<Customer>(`/api/customers/${id}`, payload).then((r) => r.data),
  deactivate: (id: number) => client.delete(`/api/customers/${id}`),
}
