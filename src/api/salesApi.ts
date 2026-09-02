import type { PagedResult, PaymentMethod, Sale } from '../types'
import client from './axios'

export type CreateSalePayload = {
  customerId?: number | null
  discount: number
  paymentMethod: PaymentMethod
  amountReceived?: number | null
  reference?: string
  items: { productId: number; quantity: number }[]
}

export const salesApi = {
  list: (params: { search?: string; page?: number; pageSize?: number }) =>
    client.get<PagedResult<Sale>>('/api/sales', { params }).then((r) => r.data),
  get: (id: number) => client.get<Sale>(`/api/sales/${id}`).then((r) => r.data),
  create: (payload: CreateSalePayload) => client.post<Sale>('/api/sales', payload).then((r) => r.data),
}
