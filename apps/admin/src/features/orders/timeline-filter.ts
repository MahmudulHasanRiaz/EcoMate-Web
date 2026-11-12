export type TimelineFilter = 'all' | 'staff' | 'courier' | 'system'

export const TIMELINE_FILTER_STORAGE_KEY = 'ecomate:order-timeline-filter'

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function loadTimelineFilter(storage?: StorageLike | null): TimelineFilter {
  try {
    const raw = (storage ?? defaultStorage())?.getItem(TIMELINE_FILTER_STORAGE_KEY)
    return raw === 'staff' || raw === 'courier' || raw === 'system' ? raw : 'all'
  } catch {
    return 'all'
  }
}

export function saveTimelineFilter(
  filter: TimelineFilter,
  storage?: StorageLike | null,
): void {
  try {
    ;(storage ?? defaultStorage())?.setItem(TIMELINE_FILTER_STORAGE_KEY, filter)
  } catch {
    // Storage unavailable (private mode, quota) — the filter still works for the session.
  }
}

/**
 * The server attaches a read-time `source` to every timeline entry; entries
 * without one (older payloads) count as system so chips never silently drop
 * them from the System view.
 */
export function timelineSourceOf(entry: any): Exclude<TimelineFilter, 'all'> {
  const source = entry?.source
  return source === 'staff' || source === 'courier' || source === 'system'
    ? source
    : 'system'
}

export type TimelineActorBadge = 'courier' | 'auto' | 'customer' | 'staff' | 'none'

/**
 * Which actor badge a timeline entry gets. A named courier wins over the
 * generic "Auto" label: a courier-driven status change (performedBy 'system'
 * + a `courier` field stamped by the backend) shows the courier, never "Auto".
 * A bare 'system' (or a legacy literal 'auto') with no courier stays "Auto";
 * staff names still show as staff.
 */
export function timelineActorBadge(entry: any): TimelineActorBadge {
  const courier = typeof entry?.courier === 'string' ? entry.courier.trim() : ''
  if (courier) return 'courier'
  const performer = entry?.performedBy || entry?.performer || ''
  const lower = String(performer).toLowerCase()
  if (lower === 'system' || lower === 'auto') return 'auto'
  if (lower === 'customer') return 'customer'
  return performer ? 'staff' : 'none'
}

export function countTimelineSources(
  entries: any[] | null | undefined,
): Record<TimelineFilter, number> {
  const list = Array.isArray(entries) ? entries : []
  const counts: Record<TimelineFilter, number> = {
    all: list.length,
    staff: 0,
    courier: 0,
    system: 0,
  }
  for (const entry of list) counts[timelineSourceOf(entry)]++
  return counts
}

export function filterTimeline(
  entries: any[] | null | undefined,
  filter: TimelineFilter,
): any[] {
  const list = Array.isArray(entries) ? entries : []
  return filter === 'all'
    ? list
    : list.filter((entry) => timelineSourceOf(entry) === filter)
}
