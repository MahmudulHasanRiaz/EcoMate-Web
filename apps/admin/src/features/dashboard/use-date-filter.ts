import { useCallback, useMemo } from 'react'
import { useNavigate, useLocation } from '@tanstack/react-router'
import type { DatePresetKey, DateRange } from './types'
import { DATE_PRESETS } from './constants'

export function useDateFilter() {
  const location = useLocation()
  const navigate = useNavigate()

  const params = useMemo(() => new URLSearchParams(location.searchStr), [location.searchStr])

  const preset = (params.get('preset') as DatePresetKey) || 'last_30_days'
  const customStart = params.get('start') || undefined
  const customEnd = params.get('end') || undefined

  const dateRange: DateRange = useMemo(() => {
    if (preset === 'custom' && customStart && customEnd) {
      return { start: new Date(customStart), end: new Date(customEnd + 'T23:59:59') }
    }
    const found = DATE_PRESETS.find(p => p.key === preset)
    return found ? found.getRange() : DATE_PRESETS[0].getRange()
  }, [preset, customStart, customEnd])

  const setPreset = useCallback((key: DatePresetKey) => {
    navigate({
      search: ((prev: any) => {
        const next = { ...prev }
        next.preset = key
        if (key !== 'custom') {
          delete next.start
          delete next.end
        }
        return next
      }) as any,
      replace: true,
    })
  }, [navigate])

  const setCustomRange = useCallback((start: string, end: string) => {
    navigate({
      search: ((prev: any) => ({ ...prev, preset: 'custom', start, end })) as any,
      replace: true,
    })
  }, [navigate])

  const formatParam = useCallback((d: Date) => d.toISOString().split('T')[0], [])

  return { preset, dateRange, setPreset, setCustomRange, formatParam }
}
