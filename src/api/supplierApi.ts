import type { Supplier } from '../types'
import client from './axios'

export type SupplierPayload = {
  companyName: string
  contactPerson?: string
  phone?: string
  email?: string
  address?: string
  isActive: boolean
}

export const supplierApi = {
  list: (params?: { search?: string; isActive?: boolean }) =>
    client.get<Supplier[]>('/api/suppliers', { params }).then((r) => r.data),
  get: (id: number) => client.get<Supplier>(`/api/suppliers/${id}`).then((r) => r.data),
  create: (payload: SupplierPayload) => client.post<Supplier>('/api/suppliers', payload).then((r) => r.data),
  update: (id: number, payload: SupplierPayload) =>
    client.put<Supplier>(`/api/suppliers/${id}`, payload).then((r) => r.data),
  deactivate: (id: number) => client.delete(`/api/suppliers/${id}`),
}
