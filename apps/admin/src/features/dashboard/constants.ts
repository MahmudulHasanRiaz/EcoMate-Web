import type { RoleKey, DatePreset, DateRange } from './types'
import { startOfDhakaDay, endOfDhakaDay } from '@/lib/dhaka-time'

export const ROLE_HIERARCHY: Record<RoleKey, number> = {
  superadmin: 100,
  admin: 80,
  manager: 60,
  moderator: 40,
  sales_executive: 20,
  cashier: 10,
  customer: 0,
}

export function canAccess(userRole: RoleKey, minRole: RoleKey): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[minRole] ?? 0)
}

const DAY_MS = 24 * 60 * 60 * 1000

export const DATE_PRESETS: DatePreset[] = [
  { key: 'today', label: 'Today', getRange: () => ({ start: startOfDhakaDay(), end: new Date() }) },
  {
    key: 'yesterday', label: 'Yesterday',
    getRange: () => {
      const t = new Date(Date.now() - DAY_MS)
      return { start: startOfDhakaDay(t), end: endOfDhakaDay(t) }
    },
  },
  {
    key: 'last_7_days', label: 'Last 7 days',
    getRange: () => ({ start: startOfDhakaDay(new Date(Date.now() - 6 * DAY_MS)), end: new Date() }),
  },
  {
    key: 'last_30_days', label: 'Last 30 days',
    getRange: () => ({ start: startOfDhakaDay(new Date(Date.now() - 29 * DAY_MS)), end: new Date() }),
  },
  {
    key: 'this_month', label: 'This Month',
    getRange: () => {
      const s = startOfDhakaDay()
      s.setUTCDate(1)
      return { start: s, end: new Date() }
    },
  },
  {
    key: 'last_month', label: 'Last Month',
    getRange: () => {
      const s = startOfDhakaDay()
      s.setUTCDate(1)
      const end = new Date(s.getTime() - 1)
      s.setUTCMonth(s.getUTCMonth() - 1)
      return { start: s, end }
    },
  },
  {
    key: 'this_quarter', label: 'This Quarter',
    getRange: () => {
      const s = startOfDhakaDay()
      s.setUTCDate(1)
      s.setUTCMonth(Math.floor(s.getUTCMonth() / 3) * 3)
      return { start: s, end: new Date() }
    },
  },
  {
    key: 'this_year', label: 'This Year',
    getRange: () => {
      const s = startOfDhakaDay()
      s.setUTCMonth(0, 1)
      return { start: s, end: new Date() }
    },
  },
  {
    key: 'all_time', label: 'All Time',
    getRange: () => ({ start: new Date(Date.UTC(2020, 0, 1) - 6 * 60 * 60 * 1000), end: new Date() }),
  },
]
