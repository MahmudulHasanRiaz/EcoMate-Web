import { AxiosError } from 'axios'
import { toast } from 'sonner'

/**
 * Global react-query error handler (wired as the QueryCache onError in
 * main.tsx).
 *
 * Until 2026-10-31 this handler also NAVIGATED THE WHOLE APP to the /500
 * page on any query 500. One transient or page-specific backend failure
 * therefore hijacked whatever the user was doing, and because the shell's
 * own queries refetch on return, the error appeared to "loop" across
 * unrelated pages (owner report from fixedplus: entered HR → Access
 * Presets once, then "Internal Server Error" kept appearing everywhere).
 * A failed background query is not a fatal app error: the affected page
 * shows its own empty/error state, and a single deduped toast names the
 * failing endpoint so a report identifies the exact request.
 */
export function handleQueryError(error: unknown) {
  if (import.meta.env.DEV) console.error('[Query Error]', error)

  if (error instanceof AxiosError) {
    if (error.response?.status === 401) {
      // The apiClient interceptor owns session expiry (refresh + redirect).
      return
    }
    if (error.response?.status === 500) {
      const url = error.config?.url
      toast.error(url ? `Internal Server Error — ${url}` : 'Internal Server Error!', {
        // A stable id: repeated failures of background queries refresh this
        // one toast instead of stacking a new one every refetch cycle.
        id: 'query-cache-500',
      })
    }
  }
}
