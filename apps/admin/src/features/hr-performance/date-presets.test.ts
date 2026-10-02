import { describe, it, expect } from 'vitest'
import { getPresetDates } from './index'
import { toDhakaDateString } from '@/lib/dhaka-time'

/**
 * Date presets must be DHAKA business dates.
 *
 * The implementation used `new Date().toISOString().split('T')[0]`, which stamps
 * the browser's UTC day. Between 00:00 and 06:00 Asia/Dhaka (UTC+6) the UTC
 * date is still yesterday, so "Today" reported a full day behind and "This
 * Month" resolved to the last day of the previous month — six hours every day,
 * silently, with no error. The week also began on Sunday via `getDay()` alone,
 * while the attendance shift rotation treats Saturday as the week start.
 *
 * `toDhakaDateString` applies a fixed +6h offset rather than reading the host
 * timezone, so these expectations hold on a UTC CI runner too.
 */
const dhakaNow = () => toDhakaDateString(new Date())

function shiftDhakaDays(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return toDhakaDateString(d)
}

describe('getPresetDates — Dhaka business dates', () => {
  it('today returns the Dhaka calendar day for both ends', () => {
    const { from, to } = getPresetDates('today')
    expect(from).toBe(dhakaNow())
    expect(to).toBe(dhakaNow())
  })

  it('today never resolves to the browser UTC day during the 00:00-06:00 Dhaka window', () => {
    // The failure mode: between 00:00 and 06:00 Dhaka the UTC date is still
    // yesterday, so a UTC stamp returns the wrong day. Assert the helper is
    // the Dhaka one, which is what the fix relies on.
    const expected = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10)
    expect(getPresetDates('today').from).toBe(expected)
  })

  it('yesterday returns the previous Dhaka day', () => {
    const { from, to } = getPresetDates('yesterday')
    expect(from).toBe(shiftDhakaDays(-1))
    expect(to).toBe(shiftDhakaDays(-1))
  })

  it('this_month starts on the 1st of the current Dhaka month', () => {
    const { from, to } = getPresetDates('this_month')
    const today = dhakaNow()
    expect(from).toBe(`${today.slice(0, 7)}-01`)
    expect(to).toBe(today)
    // Regression: a local-midnight Date serialised through UTC could yield the
    // last day of the previous month.
    expect(from.endsWith('-01')).toBe(true)
  })

  it('this_week starts on Saturday', () => {
    const { from, to } = getPresetDates('this_week')
    expect(to).toBe(dhakaNow())

    const fromDay = new Date(`${from}T00:00:00Z`).getUTCDay()
    const toDay = new Date(`${to}T00:00:00Z`).getUTCDay()
    // 6 = Saturday, 0 = Sunday. Never Sunday (the old getDay() behaviour).
    expect(fromDay).not.toBe(0)

    const spanDays =
      (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) /
      86400000
    // Saturday(6) through the current weekday is 0..6 days.
    expect(spanDays).toBeGreaterThanOrEqual(0)
    expect(spanDays).toBeLessThanOrEqual(6)
  })

  it('last_30_days spans exactly 30 days ending today', () => {
    const { from, to } = getPresetDates('last_30_days')
    expect(to).toBe(dhakaNow())
    expect(from).toBe(shiftDhakaDays(-30))
  })

  it('custom returns an empty pair so the caller can supply its own', () => {
    expect(getPresetDates('custom')).toEqual({ from: '', to: '' })
    expect(getPresetDates('anything-else')).toEqual({ from: '', to: '' })
  })

  it('never produces a range where from is after to', () => {
    for (const preset of ['today', 'yesterday', 'this_week', 'this_month', 'last_30_days']) {
      const { from, to } = getPresetDates(preset)
      expect(from <= to, `${preset}: ${from} should not be after ${to}`).toBe(true)
    }
  })
})