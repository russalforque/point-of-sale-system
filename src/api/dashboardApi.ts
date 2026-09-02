import type { DashboardData } from '../types'
import client from './axios'

export const dashboardApi = {
  get: () => client.get<DashboardData>('/api/dashboard').then((r) => r.data),
}
