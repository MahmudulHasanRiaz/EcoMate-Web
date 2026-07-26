const configuredApiBase = import.meta.env.VITE_API_URL?.trim()

/**
 * POS API base used by both Axios and media URL resolution.
 *
 * Keep this as a build-time Vite value so a standalone POS deployment can
 * point at a dedicated API origin, while the default continues to use the
 * same-origin `/api` proxy.
 */
export const API_BASE_URL = (configuredApiBase || '/api').replace(/\/+$/, '')

export function apiUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE_URL}${normalizedPath}`
}

/**
 * Resolve backend-served static assets without accidentally keeping `/api`
 * in the pathname. Same-origin deployments keep the original root path.
 */
export function backendAssetUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  if (!/^https?:\/\//i.test(API_BASE_URL)) {
    return normalizedPath
  }

  try {
    const api = new URL(API_BASE_URL)
    const apiPath = api.pathname.replace(/\/api\/?$/i, '').replace(/\/+$/, '')
    return `${api.origin}${apiPath}${normalizedPath}`
  } catch {
    return normalizedPath
  }
}
