const TOKEN_KEY = 'sellix.token'
const USER_KEY = 'sellix.user'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function getStoredUser(): { id: string; email: string; fullName: string } | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as { id: string; email: string; fullName: string }
  } catch {
    return null
  }
}

export function persistSession(token: string, user: { id: string; email: string; fullName: string }): void {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
