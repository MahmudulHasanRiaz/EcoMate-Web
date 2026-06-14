import type { RoleKey, DatePreset, DateRange } from './types'

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

export const DATE_PRESETS: DatePreset[] = [
  { key: 'today', label: 'Today', getRange: () => { const s = new Date(); s.setHours(0,0,0,0); const e = new Date(); return { start: s, end: e } } },
  { key: 'yesterday', label: 'Yesterday', getRange: () => { const s = new Date(); s.setDate(s.getDate()-1); s.setHours(0,0,0,0); const e = new Date(); e.setDate(e.getDate()-1); e.setHours(23,59,59,999); return { start: s, end: e } } },
  { key: 'last_7_days', label: 'Last 7 days', getRange: () => { const s = new Date(); s.setDate(s.getDate()-7); s.setHours(0,0,0,0); return { start: s, end: new Date() } } },
  { key: 'last_30_days', label: 'Last 30 days', getRange: () => { const s = new Date(); s.setDate(s.getDate()-30); s.setHours(0,0,0,0); return { start: s, end: new Date() } } },
  { key: 'this_month', label: 'This Month', getRange: () => { const s = new Date(); s.setDate(1); s.setHours(0,0,0,0); return { start: s, end: new Date() } } },
  { key: 'last_month', label: 'Last Month', getRange: () => { const s = new Date(); s.setMonth(s.getMonth()-1); s.setDate(1); s.setHours(0,0,0,0); const e = new Date(); e.setDate(0); e.setHours(23,59,59,999); return { start: s, end: e } } },
  { key: 'this_quarter', label: 'This Quarter', getRange: () => { const s = new Date(); s.setMonth(Math.floor(s.getMonth()/3)*3, 1); s.setHours(0,0,0,0); return { start: s, end: new Date() } } },
  { key: 'this_year', label: 'This Year', getRange: () => { const s = new Date(); s.setMonth(0, 1); s.setHours(0,0,0,0); return { start: s, end: new Date() } } },
  { key: 'all_time', label: 'All Time', getRange: () => { const s = new Date(2020, 0, 1); return { start: s, end: new Date() } } },
]
