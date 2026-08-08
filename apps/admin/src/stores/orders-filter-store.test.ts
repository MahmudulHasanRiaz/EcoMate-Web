import { beforeEach, describe, expect, it, vi } from 'vitest'

const FILTERS_KEY = 'ecomate_orders_filters_session'

async function importFilterStore() {
  const { useOrdersFilterStore, ORDER_FILTER_DEFAULTS } = await import('./orders-filter-store')
  return { useOrdersFilterStore, ORDER_FILTER_DEFAULTS }
}

describe('useOrdersFilterStore', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.resetModules()
  })

  it('starts with defaults when nothing is persisted', async () => {
    const { useOrdersFilterStore, ORDER_FILTER_DEFAULTS } = await importFilterStore()
    const s = useOrdersFilterStore.getState()
    expect(s.search).toBe('')
    expect(s.statusFilter).toBe('all')
    expect(s.courierFilter).toBe('all')
    expect(s.assigneeFilter).toBe('all')
    expect(s.sort).toBe('createdAt')
    expect(s.order).toBe('desc')
    expect(s.perPage).toBe(10)
    expect(JSON.stringify(ORDER_FILTER_DEFAULTS)).toBe(JSON.stringify(ORDER_FILTER_DEFAULTS))
  })

  it('persists filters so a new store instance reads them back', async () => {
    const { useOrdersFilterStore } = await importFilterStore()
    useOrdersFilterStore.getState().setSearch('ORD-123')
    useOrdersFilterStore.getState().setStatusFilter('st-9')
    useOrdersFilterStore.getState().setCourierFilter('steadfast')
    useOrdersFilterStore.getState().setAssigneeFilter('u-7')
    useOrdersFilterStore.getState().setSort('total')
    useOrdersFilterStore.getState().setOrder('asc')
    useOrdersFilterStore.getState().setPerPage(50)

    const raw = sessionStorage.getItem(FILTERS_KEY)
    expect(raw).toBeTruthy()

    vi.resetModules()
    const { useOrdersFilterStore: afterReload } = await importFilterStore()
    const s = afterReload.getState()
    expect(s.search).toBe('ORD-123')
    expect(s.statusFilter).toBe('st-9')
    expect(s.courierFilter).toBe('steadfast')
    expect(s.assigneeFilter).toBe('u-7')
    expect(s.sort).toBe('total')
    expect(s.order).toBe('asc')
    expect(s.perPage).toBe(50)
  })

  it('resetFilters clears everything back to defaults', async () => {
    const { useOrdersFilterStore } = await importFilterStore()
    useOrdersFilterStore.getState().setSearch('x')
    useOrdersFilterStore.getState().setStatusFilter('st-1')
    useOrdersFilterStore.getState().resetFilters()
    const s = useOrdersFilterStore.getState()
    expect(s.search).toBe('')
    expect(s.statusFilter).toBe('all')
    expect(s.courierFilter).toBe('all')
    expect(s.assigneeFilter).toBe('all')
    expect(s.sort).toBe('createdAt')
    expect(s.order).toBe('desc')
    expect(s.perPage).toBe(10)
  })

  it('sanitizes corrupted persisted payloads', async () => {
    sessionStorage.setItem(FILTERS_KEY, JSON.stringify({ search: 123, order: 'sideways', perPage: -5 }))
    vi.resetModules()
    const { useOrdersFilterStore } = await importFilterStore()
    const s = useOrdersFilterStore.getState()
    expect(s.search).toBe('')
    expect(s.order).toBe('desc')
    expect(s.perPage).toBe(10)
  })
})