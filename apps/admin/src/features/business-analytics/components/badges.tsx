'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { CostState } from '../types'

const COST_STATE_VARIANT = {
  actual: 'success',
  estimated: 'warning',
  unavailable: 'danger',
  not_applicable: 'outline',
} as const

const COST_STATE_LABEL: Record<CostState, string> = {
  actual: 'Actual',
  estimated: 'Estimated',
  unavailable: 'Unavailable',
  not_applicable: 'N/A',
}

/**
 * Per-line cost provenance (§2.3). not_applicable renders muted "N/A",
 * visually distinct from unavailable. The reason (when present) is a
 * tap-friendly tooltip on a real button — keyboard accessible, no title=.
 */
export function CostStateBadge({ state, reason }: { state: CostState; reason?: string }) {
  const [open, setOpen] = useState(false)
  const badge = <Badge variant={COST_STATE_VARIANT[state]}>{COST_STATE_LABEL[state]}</Badge>
  if (!reason) return badge
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`${COST_STATE_LABEL[state]}: ${reason}`}
          onClick={() => setOpen((v) => !v)}
          className="cursor-pointer rounded-full transition-opacity duration-150 hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {badge}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px] text-xs">{reason}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Missing-input counts that drill to their fix-list (§4.2 coverage badges).
 * Renders a link badge when an href is wired; reserves header space (h-6)
 * when zero so the header never shifts between loading and loaded.
 */
export function DataCoverageBadge({
  missing,
  label,
  title,
  href,
}: {
  missing: number
  label: string
  title?: string
  href?: string
}) {
  if (missing <= 0) return <span aria-hidden="true" className="inline-flex h-6" />
  const badge = (
    <Badge variant="warning">
      {label}: {missing} missing
    </Badge>
  )
  const a11y = title ? `${label}: ${missing} missing. ${title}` : `${label}: ${missing} missing`
  if (!href) {
    if (!title) return badge
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} aria-label={a11y} className="inline-flex rounded-full focus-visible:outline-2 focus-visible:outline-offset-2">
            {badge}
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[240px] text-xs">{title}</TooltipContent>
      </Tooltip>
    )
  }
  const link = (
    <a
      href={href}
      aria-label={a11y}
      className="inline-flex cursor-pointer rounded-full transition-opacity duration-150 hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {badge}
    </a>
  )
  if (!title) return link
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent className="max-w-[240px] text-xs">{title}</TooltipContent>
    </Tooltip>
  )
}

/** A metric with no admissible figure — renders words, never ৳0 (§6 empty-vs-zero). */
export function MetricUnavailable({ reason, compact }: { reason?: string; compact?: boolean }) {
  return (
    <div className={compact ? 'text-xs text-muted-foreground' : 'text-sm text-muted-foreground'}>
      <span className="font-medium text-danger/90">Unavailable</span>
      {reason ? <span className="block text-xs mt-0.5">{reason}</span> : null}
    </div>
  )
}
