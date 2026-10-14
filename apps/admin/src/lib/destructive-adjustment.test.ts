import { describe, it, expect } from 'vitest'
import {
  DESTRUCTIVE_ADJUSTMENT_CODE,
  DESTRUCTIVE_CONFIRM_MESSAGE,
  isDestructiveAdjustmentError,
} from './destructive-adjustment'

describe('destructive-adjustment guard wiring (Fix 3)', () => {
  it('matches the server guard by code, never by English text', () => {
    expect(DESTRUCTIVE_ADJUSTMENT_CODE).toBe('DESTRUCTIVE_ADJUSTMENT')
    expect(
      isDestructiveAdjustmentError({
        response: { data: { code: 'DESTRUCTIVE_ADJUSTMENT', message: 'whatever English text' } },
      }),
    ).toBe(true)
  })

  it('rejects plain-string guard errors (no code)', () => {
    expect(
      isDestructiveAdjustmentError({
        response: { data: { message: 'This adjustment would remove 1 of 1' } },
      }),
    ).toBe(false)
  })

  it('rejects unrelated errors and empty shapes', () => {
    expect(isDestructiveAdjustmentError(null)).toBe(false)
    expect(isDestructiveAdjustmentError(undefined)).toBe(false)
    expect(isDestructiveAdjustmentError({})).toBe(false)
    expect(
      isDestructiveAdjustmentError({ response: { data: { code: 'SOME_OTHER_CODE' } } }),
    ).toBe(false)
  })

  it('confirm copy is the exact Bengali string', () => {
    expect(DESTRUCTIVE_CONFIRM_MESSAGE).toBe(
      'এই location-এর শেষ ১ পিস সরিয়ে ফেলা হবে (স্টক শূন্য হবে) — নিশ্চিত?',
    )
  })
})
