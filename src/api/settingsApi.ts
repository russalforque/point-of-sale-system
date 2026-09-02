import type { StoreSetting } from '../types'
import client from './axios'

export type SettingsPayload = Omit<StoreSetting, 'id'>

export const settingsApi = {
  get: () => client.get<StoreSetting>('/api/settings').then((r) => r.data),
  update: (payload: SettingsPayload) => client.put<StoreSetting>('/api/settings', payload).then((r) => r.data),
}
