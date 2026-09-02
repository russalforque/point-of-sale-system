import type { ReportsData } from '../types'
import client from './axios'

export const reportsApi = {
  get: (from?: string, to?: string) =>
    client.get<ReportsData>('/api/reports', { params: { from, to } }).then((r) => r.data),
}
