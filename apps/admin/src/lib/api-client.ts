import axios from 'axios'
import { useAuthStore } from '@/stores/auth-store'
import { getCookie } from '@/lib/cookies'

const ACCESS_TOKEN_KEY = 'eco_mate_access_token'

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

// Shared promise to deduplicate concurrent refresh calls within the same tab
let refreshPromise: Promise<{ accessToken: string }> | null = null

// Retry delays for refresh: 2s + 4s + 8s + 16s = 30s total coverage.
// Covers typical backend deployment/restart windows (5-30s) and transient issues.
// The first attempt is immediate (delay 0), so the full sequence covers
// 0s + 2s + 4s + 8s + 16s = 30s from the initial 401.
const REFRESH_RETRY_DELAYS = [0, 2000, 4000, 8000, 16000]
const MAX_REFRESH_RETRIES = REFRESH_RETRY_DELAYS.length

apiClient.interceptors.request.use((config) => {
  const store = useAuthStore.getState().auth

  // Sync access token from cookie if it changed (cross-tab sync).
  // Prevents multi-tab race: if another tab refreshed, this tab gets the new token
  // before making the request, avoiding the 401→refresh cycle entirely.
  const cookieToken = getCookie(ACCESS_TOKEN_KEY) || ''
  // Use the cookie token if store doesn't have one or cookie differs from store
  let token = store.accessToken
  if (cookieToken && cookieToken !== token) {
    store.setAccessToken(cookieToken)
    token = cookieToken
  }

  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  if (config.data instanceof FormData) {
    if (config.headers) {
      delete config.headers['Content-Type']
      delete config.headers['content-type']
    }
  }
  return config
})

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config

    // Never retry refresh or login endpoints
    const isAuthPath =
      originalRequest.url?.includes('/auth/login') ||
      originalRequest.url?.includes('/auth/refresh')
    if (isAuthPath) {
      return Promise.reject(error)
    }

    // Only handle 401 responses
    if (error.response?.status !== 401) {
      return Promise.reject(error)
    }

    // If this request was already retried, give up
    if (originalRequest._retry) {
      return Promise.reject(error)
    }
    originalRequest._retry = true

    // If a refresh is already in flight, wait for it and retry the original request
    if (refreshPromise) {
      try {
        const { accessToken } = await refreshPromise
        originalRequest.headers.Authorization = `Bearer ${accessToken}`
        return apiClient(originalRequest)
      } catch {
        return Promise.reject(error)
      }
    }

    // Exponential backoff: retry refresh up to MAX_REFRESH_RETRIES times
    for (let attempt = 0; attempt < MAX_REFRESH_RETRIES; attempt++) {
      const delay = REFRESH_RETRY_DELAYS[attempt]
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      try {
        refreshPromise = axios
          .post<{ accessToken: string }>(
            `${API_BASE_URL}/auth/refresh`,
            {},
            { withCredentials: true },
          )
          .then((res) => res.data)

        const data = await refreshPromise
        useAuthStore.getState().auth.setAccessToken(data.accessToken)
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`
        return apiClient(originalRequest)
      } catch {
        // Refresh attempt failed — continue to next retry
        refreshPromise = null
      }
    }

    // All refresh retries exhausted. Clear auth and redirect to sign-in,
    // preserving the current URL so the user can return after logging in.
    useAuthStore.getState().auth.reset()

    // Build a router-relative redirect URL (strip /admin/ base from pathname).
    // TanStack Router's navigate() resolves paths relative to the route tree,
    // not the Vite base path, so we need just /op/products/... not /admin/op/...
    let returnPath = window.location.pathname + window.location.search
    if (returnPath.startsWith('/admin/')) {
      returnPath = '/' + returnPath.slice(7)
    }
    const returnUrl = encodeURIComponent(returnPath)
    window.location.href = `/admin/sign-in?redirect=${returnUrl}`
    return Promise.reject(error)
  },
)
