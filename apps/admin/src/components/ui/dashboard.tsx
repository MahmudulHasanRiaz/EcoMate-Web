'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Coins,
  CreditCard,
  Info,
  Layers,
  Minus,
  Package,
  PiggyBank,
  Receipt,
  ShoppingCart,
  Tag,
  TrendingDown,
  TrendingUp,
  Truck,
  Users,
  Wallet,
  XCircle,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export type StatusTone = 'success' | 'danger' | 'warning' | 'info' | 'violet' | 'cyan' | 'pink' | 'neutral'

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'bg-success-soft text-success border-success/25',
  danger: 'bg-danger-soft text-danger border-danger/25',
  warning: 'bg-warning-soft text-warning border-warning/25',
  info: 'bg-info-soft text-info border-info/25',
  violet: 'bg-accent-violet-soft text-accent-violet border-accent-violet/25',
  cyan: 'bg-accent-cyan-soft text-accent-cyan border-accent-cyan/25',
  pink: 'bg-accent-pink-soft text-accent-pink border-accent-pink/25',
  neutral: 'bg-muted text-muted-foreground border-border',
}

const TONE_ICONS: Record<StatusTone, LucideIcon> = {
  success: CheckCircle2,
  danger: XCircle,
  warning: AlertTriangle,
  info: Info,
  violet: Layers,
  cyan: Users,
  pink: Tag,
  neutral: Minus,
}

/** Soft badge swatch (bg + text + border) for icon tiles — no pill shape. */
export const TONE_SOFT_BADGE: Record<StatusTone, string> = {
  success: 'bg-success-soft text-success border-success/25',
  danger: 'bg-danger-soft text-danger border-danger/25',
  warning: 'bg-warning-soft text-warning border-warning/25',
  info: 'bg-info-soft text-info border-info/25',
  violet: 'bg-accent-violet-soft text-accent-violet border-accent-violet/25',
  cyan: 'bg-accent-cyan-soft text-accent-cyan border-accent-cyan/25',
  pink: 'bg-accent-pink-soft text-accent-pink border-accent-pink/25',
  neutral: 'bg-muted text-muted-foreground border-border',
}

/**
 * Status pill: color + icon + text together (Paid/Delivered green,
 * Pending amber, Cancelled/Due red, Processing blue). Token colors only.
 */
export function StatusBadge({
  tone,
  icon,
  children,
  className,
}: {
  tone: StatusTone
  icon?: LucideIcon | null
  children: ReactNode
  className?: string
}) {
  const Icon = icon === null ? null : (icon ?? TONE_ICONS[tone])
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {Icon ? <Icon className="h-3 w-3 shrink-0" aria-hidden /> : null}
      {children}
    </span>
  )
}

/** Order/payment status name → StatusTone (same buckets everywhere). */
export function orderStatusTone(statusName: string): StatusTone {
  const normalized = statusName.toLowerCase()
  if (normalized.includes('pending') || normalized.includes('awaiting')) return 'warning'
  if (normalized.includes('delivered') || normalized === 'paid') return 'success'
  if (
    normalized.includes('refund') ||
    normalized.includes('cancelled') ||
    normalized.includes('fail') ||
    normalized.includes('damage') ||
    normalized.includes('due') ||
    normalized === 'returned'
  )
    return 'danger'
  if (normalized.includes('process')) return 'info'
  if (normalized.includes('confirm')) return 'violet'
  return 'neutral'
}

/** Trend chip: ▲ green / ▼ red with %, plus flat-neutral. */
export function TrendChip({
  direction,
  children,
  className,
}: {
  direction: 'up' | 'down' | 'flat'
  children: ReactNode
  className?: string
}) {
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Minus
  const tone = direction === 'up' ? 'success' : direction === 'down' ? 'danger' : 'neutral'
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold tabular-nums whitespace-nowrap',
        TONE_CLASSES[tone],
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {children}
    </span>
  )
}

/**
 * Animated number (~0.8s ease-out). Purely presentational: renders the final
 * formatted value when reduced-motion is preferred or under test runners, so
 * assertions always see the settled text.
 */
export function CountUp({
  value,
  format,
  duration = 800,
  className,
}: {
  value: number
  format: (v: number) => string
  duration?: number
  className?: string
}) {
  const reduceMotion =
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const isTestEnv = typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test'
  const staticRender = reduceMotion || isTestEnv || duration <= 0
  const [display, setDisplay] = useState(value)
  const raf = useRef(0)

  useEffect(() => {
    if (staticRender) {
      setDisplay(value)
      return
    }
    setDisplay(0)
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(value * eased)
      if (t < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf.current)
  }, [value, duration, staticRender])

  return <span className={cn('tabular-nums', className)}>{format(display)}</span>
}

export type KpiAccent = 'success' | 'danger' | 'warning' | 'info' | 'violet' | 'cyan' | 'pink'

/** KPI title → accent color bucket (presentational only, data untouched). */
export function kpiAccentForTitle(title: string): KpiAccent {
  const t = title.toLowerCase()
  if (/pending|awaiting|hold|pipeline|unclassified|missing|gap|budget|not yet|in fulfil|undated|unavailable/.test(t)) return 'warning'
  if (/expense|cost|loss|refund|return|due|cancel|spend/.test(t)) return 'danger'
  if (/customer|cohort|segment|retention|visitor|traffic/.test(t)) return 'cyan'
  if (/stock|inventory|warehouse/.test(t)) return 'violet'
  if (/profit|revenue|sales|cash|collect|income|paid|deliver|booked|recognis|aov|margin|growth/.test(t)) return 'success'
  if (/order|payment|channel|source|categor/.test(t)) return 'info'
  return 'info'
}

const KPI_ICONS: { re: RegExp; icon: LucideIcon }[] = [
  { re: /cash|collect|revenue|payment/, icon: Coins },
  { re: /profit/, icon: PiggyBank },
  { re: /sales|booked|aov|order/, icon: ShoppingCart },
  { re: /customer|segment|visitor/, icon: Users },
  { re: /stock|inventory/, icon: Package },
  { re: /deliver|ship|fulfil/, icon: Truck },
  { re: /expense|cost|spend|fee/, icon: Receipt },
  { re: /refund|return|due|budget|wallet/, icon: Wallet },
  { re: /card|gateway|credit/, icon: CreditCard },
]

/** KPI title → topic icon (presentational only). */
export function kpiIconForTitle(title: string): LucideIcon {
  const t = title.toLowerCase()
  for (const { re, icon } of KPI_ICONS) {
    if (re.test(t)) return icon
  }
  return Banknote
}

/** Shared chart palette — at most ~6 hues per screen, token-backed. */
export const CHART_PALETTE = [
  'var(--success)',
  'var(--info)',
  'var(--warning)',
  'var(--danger)',
  'var(--accent-violet)',
  'var(--accent-pink)',
  'var(--accent-cyan)',
]

/** Status/category name → chart fill (income green, cost red, same everywhere). */
export function chartFillForName(name: string, index: number): string {
  const n = name.toLowerCase()
  if (/deliver|paid|collect|revenue|profit|success|actual|online|booked/.test(n)) return 'var(--success)'
  if (/pending|await|hold|unclassified|missing|unpaid|partial/.test(n)) return 'var(--warning)'
  if (/cancel|fail|return|refund|damage|due|loss|critical/.test(n)) return 'var(--danger)'
  if (/process|ship|transit|pick|confirm|dispatch/.test(n)) return 'var(--info)'
  if (/violet|hold/.test(n)) return 'var(--accent-violet)'
  return CHART_PALETTE[index % CHART_PALETTE.length]
}

/** Stagger helper for page-load rise (50-80ms steps). */
export function riseStyle(index: number, step = 60): CSSProperties {
  return { '--rise-delay': `${index * step}ms` } as CSSProperties
}
