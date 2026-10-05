import { useAuthStore } from '@/stores/auth-store'

/**
 * Single reader for the signed-in user's permission keys.
 *
 * Every `useAuthStore((s) => s.auth.user?.permissions) ?? []` +
 * `permissions.includes(...)` pair is an easy place to let a gate silently
 * fail open (a typo'd key, a check that never matches), so all of them go
 * through these helpers instead.
 *
 * Deny by default: a missing user, a missing permission list, or a missing key
 * all read as "no access". The backend is still the authority — these helpers
 * only stop the UI from offering actions the API will reject with a 403.
 */

/** Module-level constant so selectors returning `[]` stay referentially stable. */
const NO_PERMISSIONS: string[] = []

/** True when `permissions` contains `key`. Undefined/null list ⇒ deny. */
export function hasPermission(permissions: string[] | undefined, key: string): boolean {
  return Array.isArray(permissions) && permissions.includes(key)
}

/** True when `permissions` contains at least one of `keys`. Empty list ⇒ deny. */
export function hasAnyPermission(permissions: string[] | undefined, keys: string[]): boolean {
  if (!Array.isArray(permissions) || permissions.length === 0 || keys.length === 0) return false
  return keys.some((key) => permissions.includes(key))
}

/** True when the signed-in user holds `key`. */
export function usePermission(key: string): boolean {
  const permissions = useAuthStore((s) => s.auth.user?.permissions)
  return hasPermission(permissions, key)
}

/**
 * True when the signed-in user holds at least one of `keys`.
 *
 * `keys` is read through a stable empty array when empty so a caller that
 * builds the list inline (`useAnyPermission(CAPS.map(c => c.key))`) does not
 * re-render on every store update.
 */
export function useAnyPermission(keys: string[]): boolean {
  const permissions = useAuthStore((s) => s.auth.user?.permissions)
  const list = keys.length > 0 ? keys : NO_PERMISSIONS
  return hasAnyPermission(permissions, list)
}