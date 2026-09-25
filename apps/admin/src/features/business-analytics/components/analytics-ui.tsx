'use client'

import { useState, type ReactNode } from 'react'
import { Info, type LucideIcon } from 'lucide-react'
import { CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * Wave-1 shared analytics primitives.
 *
 * Theme tokens only, no new palette. Semantic colour solely for states.
 * NOTE on TooltipProvider: the shadcn `Tooltip` below self-wraps a Provider
 * per instance, so no app-level provider is needed for this feature.
 */

const INFO_BUTTON_CLASS =
  'inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-md p-0 text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2'

function InfoButton({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} className={INFO_BUTTON_CLASS}>
      <Info className="h-3.5 w-3.5" aria-hidden />
    </button>
  )
}

/**
 * Tap-friendly short hint (≤2 lines): controlled tooltip — hover/focus shows,
 * tap/click toggles, Escape closes. Never hover-only, never native title=.
 */
export function HintTooltip({ label, text, contentTestId }: { label: string; text: string; contentTestId?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0">
          <InfoButton label={label} onClick={() => setOpen((v) => !v)} />
        </span>
      </TooltipTrigger>
      <TooltipContent data-testid={contentTestId} className="max-w-[240px] text-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Progressive disclosure for metric metadata (reason, date basis, formula,
 * estimated reference). Short content → HintTooltip; longer → Popover.
 * Renders nothing when there is nothing to disclose.
 */
export function InfoDisclosure({
  label,
  lines,
  contentTestId,
}: {
  label: string
  lines: (string | null | undefined | false)[]
  contentTestId?: string
}) {
  const items = lines.filter((l): l is string => Boolean(l))
  if (items.length === 0) return null
  if (items.length <= 2 && items.join(' · ').length <= 140) {
    return <HintTooltip label={label} text={items.join(' · ')} contentTestId={contentTestId} />
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span className="inline-flex shrink-0">
          <InfoButton label={label} />
        </span>
      </PopoverTrigger>
      <PopoverContent data-testid={contentTestId} className="max-w-[280px] text-xs" align="end">
        <p className="mb-1 font-medium text-foreground">{label}</p>
        <ul className="space-y-1 text-muted-foreground">
          {items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/** Page header: icon + H1 + optional one-line subtitle. */
export function AnalyticsPageHeader({
  icon: Icon,
  title,
  subtitle,
  tileClassName,
}: {
  icon: LucideIcon
  title: string
  subtitle?: string
  tileClassName?: string
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn('chart-card-header-icon border', tileClassName)}>
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
    </div>
  )
}

/** Why-heading section wrapper — heading + optional subtext + children, never a Card. */
export function AnalyticsSection({
  title,
  subtext,
  children,
}: {
  title: string
  subtext?: string
  children: ReactNode
}) {
  return (
    <section aria-label={title} className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {subtext ? <p className="mt-0.5 text-xs text-muted-foreground">{subtext}</p> : null}
      </div>
      {children}
    </section>
  )
}

/** Icon + title (+ optional subtext/action) row for chart/table blocks. */
export function SectionHeader({
  icon: Icon,
  title,
  subtext,
  action,
  tileClassName,
}: {
  icon: LucideIcon
  title: string
  subtext?: ReactNode
  action?: ReactNode
  tileClassName?: string
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <span className={cn('chart-card-header-icon border', tileClassName)}>
          <Icon className="h-4 w-4" aria-hidden />
        </span>
        <div>
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {subtext ? <div className="text-[11px] text-muted-foreground">{subtext}</div> : null}
        </div>
      </div>
      {action ? <div className="flex flex-wrap items-center gap-1.5">{action}</div> : null}
    </div>
  )
}

/** The single footer metadata line — one instance per page. */
export function MetricMetaFooter({
  formulaVersion,
  dataAsOf,
  dateBasis,
  ladderState,
  periodDays,
}: {
  formulaVersion: string
  dataAsOf: string
  dateBasis: string
  ladderState: string
  periodDays: number
}) {
  return (
    <p className="text-[11px] text-muted-foreground">
      Formula {formulaVersion} · Data as of {dataAsOf} · {dateBasis} · Ladder state: {ladderState} · Period{' '}
      {periodDays} day(s)
    </p>
  )
}

/** Unified empty state — words, never a bare gap. */
export function EmptyState({ message = 'No data', className }: { message?: string; className?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-6 text-sm text-muted-foreground', className)}>
      {message}
    </div>
  )
}
