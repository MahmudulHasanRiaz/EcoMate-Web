import { describe, it, expect } from 'vitest'
import {
  dhakaTodayString,
  toDhakaDateString,
  parseDhakaDateString,
  formatDhakaDate,
  startOfDhakaDay,
  endOfDhakaDay,
} from './dhaka-time'

describe('dhaka-time (admin)', () => {
  it('dhakaTodayString returns the Dhaka calendar day even late in UTC day', () => {
    // 2026-08-18T23:30:00Z = 2026-08-19 05:30 Dhaka
    const realNow = viNow(23, 30)
    expect(toDhakaDateString(realNow)).toBe('2026-08-19')
  })

  it('dhakaTodayString matches toDhakaDateString(now)', () => {
    const real = new Date()
    expect(dhakaTodayString()).toBe(toDhakaDateString(real) || '')
  })

  it('startOfDhakaDay returns the Dhaka-midnight instant', () => {
    // 2026-08-18T00:30:00Z = 06:30 Dhaka Aug 18 → Dhaka midnight = 2026-08-17T18:00:00Z
    const s = startOfDhakaDay(new Date('2026-08-18T00:30:00.000Z'))
    expect(s.toISOString()).toBe('2026-08-17T18:00:00.000Z')
  })

  it('endOfDhakaDay spans exactly one Dhaka day', () => {
    const s = startOfDhakaDay(new Date('2026-08-18T00:30:00.000Z'))
    const e = endOfDhakaDay(new Date('2026-08-18T00:30:00.000Z'))
    expect(e.getTime() - s.getTime()).toBe(24 * 60 * 60 * 1000 - 1)
  })
})

function viNow(hours: number, minutes: number): Date {
  const d = new Date('2026-08-18T00:00:00.000Z')
  d.setUTCHours(hours, minutes, 0, 0)
  return d
}

/**
 * Part 3 — HR dates render one day early. A date-only value for Oct 22 must
 * render Oct 22 whether it arrives as a "YYYY-MM-DD" string, a UTC-midnight
 * instant (the storage convention) or a Dhaka-midnight instant. The third case
 * is the proof of the pin: a host-local or UTC-pinned render calls it Oct 21.
 * The format is pinned to Asia/Dhaka, so these hold on a UTC CI runner too.
 */
describe('formatDhakaDate — date-only acceptance', () => {
  it('renders the Dhaka calendar day under Asia/Dhaka and under UTC', () => {
    expect(formatDhakaDate('2026-10-22')).toBe('Oct 22, 2026')
    expect(formatDhakaDate('2026-10-22T00:00:00.000Z')).toBe('Oct 22, 2026')
    expect(formatDhakaDate('2026-10-21T18:00:00.000Z')).toBe('Oct 22, 2026')
    expect(formatDhakaDate(null)).toBe('—')
  })
})

describe('Dhaka date-only write round-trip', () => {
  it('serializes the picked calendar day without rolling back to UTC', () => {
    expect(toDhakaDateString(new Date(2026, 9, 22))).toBe('2026-10-22')
  })

  it('parses a "YYYY-MM-DD" back to the same Dhaka calendar day', () => {
    const parsed = parseDhakaDateString('2026-10-22')
    expect(parsed).toBeInstanceOf(Date)
    expect(toDhakaDateString(parsed!)).toBe('2026-10-22')
  })
})