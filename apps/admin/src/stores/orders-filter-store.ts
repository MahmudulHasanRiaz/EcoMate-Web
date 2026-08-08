import { create } from 'zustand'

const FILTERS_KEY = 'ecomate_orders_filters_session'

export interface OrdersFilters {
  search: string
  statusFilter: string
  courierFilter: string
  assigneeFilter: string
  sort: string
  order: 'asc' | 'desc'
  perPage: number
}

export interface OrdersFilterStore extends OrdersFilters {
  setSearch: (v: string) => void
  setStatusFilter: (v: string) => void
  setCourierFilter: (v: string) => void
  setAssigneeFilter: (v: string) => void
  setSort: (v: string) => void
  setOrder: (v: 'asc' | 'desc') => void
  setPerPage: (v: number) => void
  resetFilters: () => void
}

export const ORDER_FILTER_DEFAULTS: OrdersFilters = {
  search: '',
  statusFilter: 'all',
  courierFilter: 'all',
  assigneeFilter: 'all',
  sort: 'createdAt',
  order: 'desc',
  perPage: 10,
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
  setSort: (sort) => { set({ sort }); saveFilters(get()) },
  setOrder: (order) => { set({ order }); saveFilters(get()) },
  setPerPage: (perPage) => { set({ perPage }); saveFilters(get()) },
  resetFilters: () => { set(ORDER_FILTER_DEFAULTS); saveFilters(get()) },
}))