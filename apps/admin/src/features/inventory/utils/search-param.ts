/**
 * Sanitize one raw route-search value for the Stock page.
 *
 * ROOT CAUSE (2026-11-12, literal "null" in the Stock search box):
 * TanStack Router's default search codec JSON-round-trips values
 * (@tanstack/router-core 1.171.30, `searchParams.js` + `qss.js`):
 * - `defaultParseSearch` JSON-parses `?q=null` to the REAL null, and
 *   `?q=%22null%22` back to the STRING "null".
 * - `defaultStringifySearch` / `qss.encode` only skips `undefined`; a real
 *   null is written by `URLSearchParams.set` as the literal `?q=null`.
 * The old `validateSearch` (`routes/_authenticated/op/inventory/index.tsx`)
 * blind-cast `search.q as string | undefined`, so a parsed null — or a
 * number / boolean / array from `?q=123` etc. — reached the typed search
 * object, the `useState(() => routeSearch?.q ?? '')` initializer passed the
 * STRING "null" straight into the search box (only real null/undefined were
 * caught by `??`), and the write-back navigate re-emitted it, so a poisoned
 * URL kept the box showing "null" across reloads and tab restores — while a
 * fresh tab (clean URL) never reproduced it.
 *
 * This helper is the single gate both call sites use: `validateSearch`
 * (URL -> typed search) and the `useState` initializer (typed search ->
 * input state). Anything that is not a real, non-empty, non-literal-null
 * string is absent. No genuine product name/SKU query is the bare word
 * "null" / "undefined", so dropping it loses nothing; values that merely
 * contain those words ("nullify", "nullable hoodie") pass through.
 */
export function sanitizeSearchParam(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const lowered = trimmed.toLowerCase()
  if (lowered === 'null' || lowered === 'undefined') return undefined
  return value
}

/** Initializer form: an absent value sanitizes to the empty search string. */
export function sanitizeSearchState(value: unknown): string {
  return sanitizeSearchParam(value) ?? ''
}
