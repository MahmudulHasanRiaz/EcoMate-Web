import { describe, expect, it } from 'vitest'
import {
  TIMELINE_FILTER_STORAGE_KEY,
  countTimelineSources,
  filterTimeline,
  loadTimelineFilter,
  saveTimelineFilter,
  timelineSourceOf,
} from './timeline-filter'

const ENTRIES = [
  { status: 'Pending', note: 'Order created', source: 'system' },
  { type: 'courier', courier: 'pathao', source: 'courier' },
  { type: 'note', note: 'called', source: 'staff' },
  { type: 'note', note: 'auto', source: 'system' },
]

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => {
      data[k] = v
    },
    _data: data,
  }
}

describe('timelineSourceOf', () => {
  it('reads the server-attached source', () => {
    expect(timelineSourceOf({ source: 'staff' })).toBe('staff')
    expect(timelineSourceOf({ source: 'courier' })).toBe('courier')
    expect(timelineSourceOf({ source: 'system' })).toBe('system')
  })

  it('falls back to system for entries without a (valid) source', () => {
    expect(timelineSourceOf({})).toBe('system')
    expect(timelineSourceOf({ source: 'bogus' })).toBe('system')
    expect(timelineSourceOf(null)).toBe('system')
  })
})

describe('countTimelineSources', () => {
  it('counts all entries per bucket including All', () => {
    expect(countTimelineSources(ENTRIES)).toEqual({
      all: 4,
      staff: 1,
      courier: 1,
      system: 2,
    })
  })

  it('tolerates missing timelines', () => {
    expect(countTimelineSources(undefined)).toEqual({
      all: 0,
      staff: 0,
      courier: 0,
      system: 0,
    })
  })
})

describe('filterTimeline', () => {
  it('returns everything for All', () => {
    expect(filterTimeline(ENTRIES, 'all')).toHaveLength(4)
  })

  it('filters to a single source', () => {
    expect(filterTimeline(ENTRIES, 'courier')).toEqual([ENTRIES[1]])
    expect(filterTimeline(ENTRIES, 'staff')).toEqual([ENTRIES[2]])
    expect(filterTimeline(ENTRIES, 'system')).toEqual([ENTRIES[0], ENTRIES[3]])
  })
})

describe('loadTimelineFilter / saveTimelineFilter', () => {
  it('round-trips a valid filter', () => {
    const storage = memoryStorage()
    saveTimelineFilter('courier', storage)
    expect(storage._data[TIMELINE_FILTER_STORAGE_KEY]).toBe('courier')
    expect(loadTimelineFilter(storage)).toBe('courier')
  })

  it('defaults to all for missing or invalid stored values', () => {
    expect(loadTimelineFilter(memoryStorage())).toBe('all')
    expect(
      loadTimelineFilter(memoryStorage({ [TIMELINE_FILTER_STORAGE_KEY]: 'nope' })),
    ).toBe('all')
  })

  it('never throws when storage is unavailable', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadTimelineFilter(throwing)).toBe('all')
    expect(() => saveTimelineFilter('staff', throwing)).not.toThrow()
  })
})
