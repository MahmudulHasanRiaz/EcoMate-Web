'use client'

import { Activity, Network } from 'lucide-react'
import type { DashboardView } from '../types'

interface ViewSwitchProps {
  view: DashboardView
  onChange: (view: DashboardView) => void
}

const OPTIONS: Array<{
  key: DashboardView
  label: string
  title: string
  Icon: typeof Activity
}> = [
  { key: 'activity', label: 'Activity', title: 'What happened in the selected period', Icon: Activity },
  { key: 'pipeline', label: 'Pipeline', title: 'Where orders created in the selected period stand now', Icon: Network },
]

export function ViewSwitch({ view, onChange }: ViewSwitchProps) {
  return (
    <div
      role="group"
      aria-label="Dashboard view"
      className="inline-flex min-h-10 items-center rounded-xl bg-muted p-1 text-muted-foreground border border-border/50"
    >
      {OPTIONS.map(({ key, label, title, Icon }) => {
        const isActive = view === key
        return (
          <button
            key={key}
            type="button"
            role="button"
            aria-pressed={isActive}
            title={title}
            onClick={() => onChange(key)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 min-h-8 text-xs font-bold transition-all duration-200 ${
              isActive
                ? 'bg-background text-foreground shadow-sm'
                : 'hover:bg-background/40 hover:text-foreground/90'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}
