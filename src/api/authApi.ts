import type { LoginResponse, User } from '../types'
import client from './axios'

export const authApi = {
  login: (email: string, password: string) =>
    client.post<LoginResponse>('/api/auth/login', { email, password }).then((r) => r.data),
  logout: () => client.post('/api/auth/logout').then((r) => r.data),
  me: () => client.get<User>('/api/auth/me').then((r) => r.data),
  changePassword: (currentPassword: string, newPassword: string) =>
    client.post('/api/auth/change-password', { currentPassword, newPassword }).then((r) => r.data),
}
