import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'

/**
 * Courier city list for the order-create / customer-edit forms (finding 2).
 *
 * The list comes from the LIVE courier API (Pathao, else Carrybee) — there
 * is no local city table, and the ids are the courier's own city_ids, sent
 * back verbatim at dispatch, so a static fallback list would corrupt
 * consignments. Two failure modes, handled differently:
 *
 *  (a) NO courier account enabled → the backend answers 200 with
 *      `{ cities: [], courierConfigured: false }`. That is NOT an error:
 *      no toast, the city field stays usable without a city, and the form
 *      shows a plain hint instead. (The old backend threw 400 here, so
 *      every tenant without Pathao/Carrybee saw 'Failed to fetch cities'
 *      on every order create.)
 *  (b) Courier enabled but the fetch fails (slow network, courier API
 *      down) → TRANSIENT. No error toast either: the query retries twice
 *      with backoff, keeps serving the last-good list (React Query cache
 *      + localStorage, so it survives a reload), and the field shows a
 *      subtle retry hint. A failed fetch never again leaves the field
 *      permanently empty for the whole form session — the old code did one
 *      fire-and-forget fetch on mount with no retry, no cache and no
 *      loading state, so on a slow connection staff opened the city
 *      dropdown before the (up to 30s server-side: token refresh + city
 *      list, vs the 15s axios timeout) round-trip finished and saw an
 *      empty list with no spinner — the intermittent 'loads empty' staff
 *      reported on slow networks / mobile-desktop-mode.
 */

export interface CourierCity {
  id: string | number
  name: string
}

export interface CourierCitiesData {
  cities: CourierCity[]
  courierConfigured: boolean
  source: 'pathao' | 'carrybee' | null
}

export const COURIER_CITIES_QUERY_KEY = ['courier-cities']
export const COURIER_CITIES_LAST_GOOD_KEY = 'eco_courier_cities_v1'
/** City lists change rarely; 10 min keeps the form instant across opens. */
const STALE_TIME_MS = 10 * 60_000

function toCity(raw: any): CourierCity | null {
  if (raw == null || raw.id == null || raw.name == null) return null
  return { id: raw.id, name: String(raw.name) }
}

/**
 * Normalises both the current envelope `{ cities, courierConfigured,
 * source }` and the legacy bare-array body (pre-envelope backend), so a
 * backend deploy lagging the admin bundle still works.
 */
export function normalizeCourierCities(body: unknown): CourierCitiesData {
  if (Array.isArray(body)) {
    const cities = body.map(toCity).filter((c): c is CourierCity => c !== null)
    return { cities, courierConfigured: true, source: null }
  }
  const b = (body ?? {}) as any
  // `{ data: [...] }` envelope (same shape normalizeShippingZones /
  // normalizeSourcePlatforms already unwrap): previously degraded to
  // [] — safe, but silently empty. Unwrap it like the siblings.
  const list = Array.isArray(b.cities)
    ? b.cities
    : Array.isArray(b.data)
      ? b.data
      : []
  const cities = list
    .map(toCity)
    .filter((c: any): c is CourierCity => c !== null)
  return {
    cities,
    courierConfigured:
      typeof b.courierConfigured === 'boolean'
        ? b.courierConfigured
        : cities.length > 0,
    source: b.source ?? null,
  }
}

/**
 * Zones share the envelope (`{ zones, courierConfigured, source }`) and
 * the legacy bare-array body. Transient zone failures stay silent — the
 * zone select is disabled until a city is picked anyway, and re-picking
 * the city refetches.
 */
export function normalizeCourierZones(body: unknown): CourierCity[] {
  if (Array.isArray(body)) {
    return body.map(toCity).filter((c): c is CourierCity => c !== null)
  }
  const b = (body ?? {}) as any
  // `{ data: [...] }` envelope — see normalizeCourierCities above.
  const list = Array.isArray(b.zones)
    ? b.zones
    : Array.isArray(b.data)
      ? b.data
      : []
  return list
    .map(toCity)
    .filter((c: any): c is CourierCity => c !== null)
}

export function readLastGoodCities(): CourierCitiesData | undefined {
  return readLastGoodEntry()?.data
}

/**
 * The persisted last-good entry with the timestamp it was saved, so the
 * query can treat a days-old cached list as STALE (background refetch on
 * mount) instead of fresh — otherwise `initialData` would stamp it 'now'
 * and suppress the refresh for the whole staleTime.
 */
export function readLastGoodEntry():
  | { data: CourierCitiesData; updatedAt: number }
  | undefined {
  try {
    const raw = localStorage.getItem(COURIER_CITIES_LAST_GOOD_KEY)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as CourierCitiesData & {
      updatedAt?: number
    }
    if (!Array.isArray(parsed?.cities) || parsed.cities.length === 0) {
      return undefined
    }
    return {
      data: {
        cities: parsed.cities
          .map(toCity)
          .filter((c): c is CourierCity => c !== null),
        courierConfigured: true,
        source: parsed.source ?? null,
      },
      updatedAt:
        typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
  } catch {
    return undefined
  }
}

function persistLastGoodCities(data: CourierCitiesData) {
  try {
    if (data.courierConfigured && data.cities.length > 0) {
      localStorage.setItem(
        COURIER_CITIES_LAST_GOOD_KEY,
        JSON.stringify({ ...data, updatedAt: Date.now() }),
      )
    } else if (!data.courierConfigured) {
      // Courier was disconnected: a cached list would carry dead courier
      // ids into orders, so drop it instead of serving it.
      localStorage.removeItem(COURIER_CITIES_LAST_GOOD_KEY)
    }
  } catch {
    // Storage full / private mode — the in-memory query cache still works.
  }
}

export interface CourierCitiesState {
  /** Last-good list (cached or freshly fetched); [] while never loaded. */
  cities: CourierCity[]
  /** False only once the server has said no courier is configured. */
  courierConfigured: boolean | undefined
  /** True while the first load is still in flight with nothing to show. */
  citiesLoading: boolean
  /** True when the latest attempt failed AND no last-good list exists. */
  citiesLoadFailed: boolean
  /** True when showing a stale last-good list after a failed refresh. */
  showingStaleList: boolean
  /** True once the first load has settled (success or final failure) — or
   * immediately when a last-good list was restored. The edit-hydration
   * gate waits on this so a stored city name can be resolved to an id. */
  citiesSettled: boolean
  retryCities: () => void
}

export function useCourierCities(): CourierCitiesState {
  // Restored once per mount: the last-good list shows instantly, and its
  // real age (initialDataUpdatedAt) decides whether a background refresh
  // fires — a days-old list is stale on mount, so it refetches behind it.
  const [lastGood] = useState(() => readLastGoodEntry())
  const query = useQuery({
    queryKey: COURIER_CITIES_QUERY_KEY,
    queryFn: async (): Promise<CourierCitiesData> => {
      const r = await apiClient.get('/couriers/cities')
      const data = normalizeCourierCities(r.data)
      persistLastGoodCities(data)
      return data
    },
    // Serve the last-good list instantly; refetch in the background when
    // it is older than staleTime. A failed fetch retries twice (backoff)
    // and leaves the last-good data in place — it never blanks the field.
    staleTime: STALE_TIME_MS,
    retry: 2,
    retryDelay: attempt => Math.min(1000 * 2 ** attempt, 5000),
    initialData: lastGood?.data,
    initialDataUpdatedAt: lastGood?.updatedAt,
  })

  const cities = query.data?.cities ?? []
  const hasSettled = query.isFetched || query.isError
  return {
    cities,
    courierConfigured: query.data?.courierConfigured,
    citiesLoading: query.isFetching && cities.length === 0,
    citiesLoadFailed: hasSettled && query.isError && cities.length === 0,
    showingStaleList: hasSettled && query.isError && cities.length > 0,
    citiesSettled: hasSettled,
    retryCities: () => {
      void query.refetch()
    },
  }
}
