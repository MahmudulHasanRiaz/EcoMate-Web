import { describe, expect, it } from 'vitest'
import { pendingEffectiveFrom } from '../lib/pending-structure'

const PAST = '2026-06-01T00:00:00.000Z'
const FUTURE = '2026-12-01T00:00:00.000Z'

// Dhaka midnight for a fixed instant well inside Aug 2026.
function nowInAug2026(): Date {
  return new Date('2026-08-24T08:00:00.000Z') // 14:00 Dhaka on Aug 24
}

describe('pendingEffectiveFrom (G-31)', () => {
  it('returns the latest structure effectiveFrom when it is after today (Dhaka)', () => {
    // History is ordered effectiveFrom desc — index 0 is the newest.
    const history = [{ effectiveFrom: FUTURE }, { effectiveFrom: PAST }]
    expect(pendingEffectiveFrom(history, nowInAug2026())).toBe(FUTURE)
  })

  it('returns undefined when the latest structure is already in effect', () => {
    const history = [{ effectiveFrom: PAST }]
    expect(pendingEffectiveFrom(history, nowInAug2026())).toBeUndefined()
  })

  it('returns undefined when there is no history', () => {
    expect(pendingEffectiveFrom([], nowInAug2026())).toBeUndefined()
  })
})
