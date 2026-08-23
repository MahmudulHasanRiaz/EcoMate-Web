import type { PayslipStatus } from '../api'

export const PAYSLIP_STATUS_BADGE: Record<
  PayslipStatus,
  { label: string; className: string }
> = {
  draft: {
    label: 'Draft',
    className:
      'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
  },
  reviewed: {
    label: 'Reviewed',
    className:
      'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  },
  approved: {
    label: 'Approved',
    className:
      'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
  },
  partially_paid: {
    label: 'Partially Paid',
    className:
      'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  paid: {
    label: 'Paid',
    className:
      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  },
  cancelled: {
    label: 'Cancelled',
    className:
      'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  },
}
