import axios from 'axios'
import { useAuthStore } from '@/stores/auth-store'
import { getCookie } from '@/lib/cookies'

const ACCESS_TOKEN_KEY = 'eco_mate_access_token'

function resolveApiUrl(): string {
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL
  return '/api'
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

/**
 * Sign-in redirect used when a session can no longer be refreshed.
 * `expired=1` lets the sign-in page surface a friendly "session expired"
 * banner instead of a silent bounce. The current admin route is preserved
 * (stripped of the /admin base) so the user can return after logging in.
 */
export function buildSessionExpiredRedirect(pathname: string, search: string): string {
  let returnPath = pathname + search
  if (returnPath.startsWith('/admin/')) {
    returnPath = '/' + returnPath.slice(7)
  }
  const returnUrl = encodeURIComponent(returnPath)
  return `/admin/sign-in?redirect=${returnUrl}&expired=1`
}

/**
 * Only redirect on an expired session when there WAS an authenticated session.
 * A bare 401 with no token while already on the sign-in page is just a failed
 * anonymous call — bouncing there again would loop forever.
 */
export function shouldRedirectOnSessionExpiry(hadToken: boolean, pathname: string): boolean {
  return hadToken || pathname !== '/admin/sign-in'
}

/**
 * Injectable navigation seam. Tests replace `assign` so the exhausted-refresh
 * path can be asserted without navigating the test browser away.
 */
export const sessionRedirect = {
  assign: (url: string) => window.location.assign(url),
}

// Shared promise to deduplicate concurrent refresh calls within the same tab.
// It must be reset after every settlement (success or failure): the backend
// rotates the httpOnly refresh cookie on each /auth/refresh, so reusing the
// token captured by an earlier refresh would silently fail once THAT token
// expires — the exact "logged in, but Authentication required" symptom.
let refreshPromise: Promise<{ accessToken: string }> | null = null

// Retry delays for refresh: 2s + 4s + 8s + 16s = 30s total coverage.
// Covers typical backend deployment/restart windows (5-30s) and transient issues.
// The first attempt is immediate (delay 0), so the full sequence covers
// 0s + 2s + 4s + 8s + 16s = 30s from the initial 401.
const REFRESH_RETRY_DELAYS = [0, 2000, 4000, 8000, 16000]
const MAX_REFRESH_RETRIES = REFRESH_RETRY_DELAYS.length

function performRefresh(): Promise<{ accessToken: string }> {
  if (!refreshPromise) {
    refreshPromise = axios
      .post<{ accessToken: string }>(
        `${API_BASE_URL}/auth/refresh`,
        {},
        { withCredentials: true },
      )
      .then((res) => {
        // Persist the rotated token to the shared cookie + store so THIS and
        // other tabs all use the fresh token for the next request instead of
        // replaying a stale one until the session dies.
        useAuthStore.getState().auth.setAccessToken(res.data.accessToken)
        return res.data
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

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

    // 401 → refresh with backoff, then replay the original request once with
    // the fresh token. performRefresh() dedupes concurrent 401s and always
    // stores the rotated token, so a long-lived workflow keeps working.
    for (let attempt = 0; attempt < MAX_REFRESH_RETRIES; attempt++) {
      const delay = REFRESH_RETRY_DELAYS[attempt]
      if (delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, delay))
      }

      try {
        const { accessToken } = await performRefresh()
        originalRequest.headers.Authorization = `Bearer ${accessToken}`
        return apiClient(originalRequest)
      } catch {
        // Refresh attempt failed (backend restart / network blip) — retry with backoff
      }
    }

    // All refresh retries exhausted. Clear auth (token + user) so any other
    // in-flight request / protected UI sees a logged-out state immediately.
    useAuthStore.getState().auth.reset()

    // Attach ?expired=1 so the sign-in page can show a "session expired" banner.
    const hadToken = !!originalRequest.headers?.Authorization
    if (shouldRedirectOnSessionExpiry(hadToken, window.location.pathname)) {
      sessionRedirect.assign(
        buildSessionExpiredRedirect(window.location.pathname, window.location.search),
      )
    }
    return Promise.reject(error)
  },
)
