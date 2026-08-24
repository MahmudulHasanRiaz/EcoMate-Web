import { describe, expect, it } from 'vitest'
import { dhakaToday, dhakaTodayDate, toDateKey } from '../api'

describe('attendance Dhaka business-date helpers (UI == server helper)', () => {
  it('dhakaToday matches the server helper at the Dhaka midnight boundary', () => {
    // UTC 18:30 = 00:30 next Dhaka day
    expect(dhakaToday(new Date('2026-08-24T18:30:00.000Z'))).toBe('2026-08-25')
    expect(dhakaToday(new Date('2026-08-24T17:59:59.000Z'))).toBe('2026-08-24')
  })

  it('dhakaTodayDate + toDateKey round-trips to the same Dhaka date string', () => {
    const d = dhakaTodayDate(new Date('2026-08-24T18:30:00.000Z'))
    expect(toDateKey(d)).toBe('2026-08-25')
  })

  it('renders as YYYY-MM-DD for the real now', () => {
    expect(dhakaToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})
