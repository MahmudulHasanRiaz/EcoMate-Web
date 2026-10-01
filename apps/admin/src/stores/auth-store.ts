import { create } from 'zustand'
import { getCookie, setCookie, removeCookie } from '@/lib/cookies'

const ACCESS_TOKEN_KEY = 'eco_mate_access_token'
const USER_KEY = 'eco_mate_user'

function loadCachedUser(): AuthUser | null {
  // Prefetched /auth/me result (inline script fires it during bundle download)
  try {
    const raw = sessionStorage.getItem('admin_prefetch')
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed.authMe) {
        const u = parsed.authMe.user || parsed.authMe
        if (u && u.id) {
          return {
            id: u.id,
            email: u.email,
            role: u.role,
            permissions: u.permissions || [],
            firstName: u.firstName,
            lastName: u.lastName,
            username: u.username,
          }
        }
      }
    }
  } catch { /* fall through */ }
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

function saveCachedUser(user: AuthUser | null) {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
    else localStorage.removeItem(USER_KEY)
  } catch { /* ignore */ }
}

interface AuthUser {
  id: string
  email: string
  role: string
  permissions: string[]
  /** From /auth/me — the account holder's own profile name. */
  firstName?: string
  lastName?: string
  username?: string
}

interface AuthState {
  auth: {
    user: AuthUser | null
    setUser: (user: AuthUser | null) => void
    accessToken: string
    setAccessToken: (accessToken: string) => void
    resetAccessToken: () => void
    reset: () => void
  }
}

export const useAuthStore = create<AuthState>()((set) => {
  const initToken = getCookie(ACCESS_TOKEN_KEY) || ''
  return {
    auth: {
      // Cached user renders instantly on reload; /auth/me refreshes it.
      user: loadCachedUser(),
      setUser: (user) => {
        // The login response has no `permissions` key — normalise so every
        // consumer reads an array and never `undefined`.
        const next = user ? { ...user, permissions: user.permissions || [] } : user
        saveCachedUser(next)
        set((state) => ({ ...state, auth: { ...state.auth, user: next } }))
      },
      accessToken: initToken,
      setAccessToken: (accessToken) =>
        set((state) => {
          setCookie(ACCESS_TOKEN_KEY, accessToken)
          return { ...state, auth: { ...state.auth, accessToken } }
        }),
      resetAccessToken: () =>
        set((state) => {
          removeCookie(ACCESS_TOKEN_KEY)
          return { ...state, auth: { ...state.auth, accessToken: '' } }
        }),
      reset: () =>
        set((state) => {
          removeCookie(ACCESS_TOKEN_KEY)
          saveCachedUser(null)
          return {
            ...state,
            auth: { ...state.auth, user: null, accessToken: '' },
          }
        }),
    },
  }
})
