import { create } from 'zustand'

const FILTERS_KEY = 'ecomate_orders_filters_session'

export type OrderKindFilter = 'all' | 'SALE' | 'RETURN' | 'EXCHANGE'

export interface OrdersFilters {
  search: string
  statusFilter: string
  courierFilter: string
  assigneeFilter: string
  // P6 provenance filter: 'all' | 'native' | <storeId>. Full channel columns
  // (salesChannelType/showroomId/marketingChannel) land in P8.
  storeFilter: string
  sort: string
  order: 'asc' | 'desc'
  perPage: number
  /** All/Sales/Returns/Exchanges chips — lives in the store (not local
   *  useState) so resetFilters() clears it and the empty-state copy can
   *  tell a filtered-empty list from a truly empty workspace. */
  kindFilter: OrderKindFilter
}

export interface OrdersFilterStore extends OrdersFilters {
  setSearch: (v: string) => void
  setStatusFilter: (v: string) => void
  setCourierFilter: (v: string) => void
  setAssigneeFilter: (v: string) => void
  setStoreFilter: (v: string) => void
  setSort: (v: string) => void
  setOrder: (v: 'asc' | 'desc') => void
  setPerPage: (v: number) => void
  setKindFilter: (v: OrderKindFilter) => void
  resetFilters: () => void
}

export const ORDER_FILTER_DEFAULTS: OrdersFilters = {
  search: '',
  statusFilter: 'all',
  courierFilter: 'all',
  assigneeFilter: 'all',
  storeFilter: 'all',
  sort: 'createdAt',
  order: 'desc',
  perPage: 10,
  kindFilter: 'all',
}

function loadFilters(): OrdersFilters {
  try {
    const raw = sessionStorage.getItem(FILTERS_KEY)
    if (!raw) return ORDER_FILTER_DEFAULTS
    const parsed = JSON.parse(raw)
    const out: OrdersFilters = { ...ORDER_FILTER_DEFAULTS }
    if (typeof parsed === 'object' && parsed !== null) {
      for (const key of Object.keys(ORDER_FILTER_DEFAULTS) as (keyof OrdersFilters)[]) {
        const value = (parsed as Record<string, unknown>)[key]
        if (key === 'perPage') {
          if (typeof value === 'number' && Number.isFinite(value) && value > 0) out.perPage = Math.floor(value)
        } else if (key === 'order') {
          if (value === 'asc' || value === 'desc') out.order = value
        } else if (key === 'kindFilter') {
          if (value === 'all' || value === 'SALE' || value === 'RETURN' || value === 'EXCHANGE') out.kindFilter = value
        } else if (typeof value === 'string') {
          ;(out as unknown as Record<string, string>)[key] = value
        }
      }
    }
    return out
  } catch {
    return ORDER_FILTER_DEFAULTS
  }
}

function saveFilters(filters: OrdersFilters) {
  try {
    sessionStorage.setItem(FILTERS_KEY, JSON.stringify(filters))
  } catch { /* ignore */ }
}

export const useOrdersFilterStore = create<OrdersFilterStore>((set, get) => ({
  ...loadFilters(),
  setSearch: (search) => { set({ search }); saveFilters(get()) },
  setStatusFilter: (statusFilter) => { set({ statusFilter }); saveFilters(get()) },
  setCourierFilter: (courierFilter) => { set({ courierFilter }); saveFilters(get()) },
  setAssigneeFilter: (assigneeFilter) => { set({ assigneeFilter }); saveFilters(get()) },
  setStoreFilter: (storeFilter) => { set({ storeFilter }); saveFilters(get()) },
  setSort: (sort) => { set({ sort }); saveFilters(get()) },
  setOrder: (order) => { set({ order }); saveFilters(get()) },
  setPerPage: (perPage) => { set({ perPage }); saveFilters(get()) },
  setKindFilter: (kindFilter) => { set({ kindFilter }); saveFilters(get()) },
  resetFilters: () => { set(ORDER_FILTER_DEFAULTS); saveFilters(get()) },
}))