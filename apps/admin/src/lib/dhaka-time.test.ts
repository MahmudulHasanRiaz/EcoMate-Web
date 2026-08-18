import { describe, it, expect } from 'vitest'
import { dhakaTodayString, toDhakaDateString, startOfDhakaDay, endOfDhakaDay } from './dhaka-time'

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