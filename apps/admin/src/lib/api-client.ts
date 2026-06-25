import axios from 'axios'
import { useAuthStore } from '@/stores/auth-store'

function resolveApiUrl(): string {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL
  return 'http://localhost:4000/api'
}

const API_BASE_URL = resolveApiUrl()

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
})

let refreshPromise: Promise<{ accessToken: string }> | null = null

apiClient.interceptors.request.use((config) => {
  const token = useAuthStore.getState().auth.accessToken
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    const skipRefresh = originalRequest.url?.includes('/auth/login') || originalRequest.url?.includes('/auth/refresh');
    if (error.response?.status === 401 && !originalRequest._retry && !skipRefresh) {
      originalRequest._retry = true

      if (refreshPromise) {
        try {
          const { accessToken } = await refreshPromise
          originalRequest.headers.Authorization = `Bearer ${accessToken}`
          return apiClient(originalRequest)
        } catch {
          return Promise.reject(error)
        }
      }

      refreshPromise = axios
        .post<{ accessToken: string }>(
          `${API_BASE_URL}/auth/refresh`,
          {},
          { withCredentials: true },
        )
        .then((res) => res.data)

      try {
        const data = await refreshPromise
        useAuthStore.getState().auth.setAccessToken(data.accessToken)
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`
        return apiClient(originalRequest)
      } catch (refreshError) {
        useAuthStore.getState().auth.reset()
        window.location.href = '/admin/sign-in'
        return Promise.reject(refreshError)
      } finally {
        refreshPromise = null
      }
    }

    return Promise.reject(error)
  },
)
