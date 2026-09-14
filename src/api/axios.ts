import axios, { AxiosError } from 'axios'
import { clearSession, getToken } from '../utils/session'
import { ApiError } from '../utils/errors'

const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'https://10.0.2.2:7130',
  headers: {
    'Content-Type': 'application/json',
  },
})

client.interceptors.request.use((config) => {
  const token = getToken()

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }

  return config
})

client.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string }>) => {
    const status = error.response?.status ?? 0

    const message =
      error.response?.data?.message ||
      (status === 0
        ? 'Unable to reach the server. Check your connection and try again.'
        : 'Request failed. Please try again.')

    if (
      status === 401 &&
      !window.location.pathname.startsWith('/login')
    ) {
      clearSession()
      window.location.assign('/login')
    }

    return Promise.reject(new ApiError(message, status))
  },
)

export default client