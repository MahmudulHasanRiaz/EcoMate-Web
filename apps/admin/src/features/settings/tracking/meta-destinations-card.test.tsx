import { describe, expect, it } from 'vitest'
import {
  hasConfiguredDestinations,
  parseDestinations,
  validateDrafts,
} from '@/features/settings/tracking/meta-destinations-card'

/**
 * Step 3 — destination form validation.
 *
 * The admin API redacts stored tokens (accessToken comes back '' with
 * hasAccessToken: true), so validation must accept a populated Pixel ID plus a
 * masked token as complete — errors are only legitimate for genuinely empty
 * fields (e.g. a freshly added destination).
 */
describe('meta-destinations-card validation', () => {
  const serverPayload = JSON.stringify([
    {
      id: 'primary',
      label: 'Main Pixel',
      pixelId: '123456789012345',
      accessToken: '',
      hasAccessToken: true,
      enabled: true,
      browserPixelEnabled: true,
      testEventCode: '',
      testMode: false,
    },
  ])

  it('accepts a server-redacted destination (populated pixel id + masked token)', () => {
    const drafts = parseDestinations(serverPayload)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].pixelId).toBe('123456789012345')
    expect(drafts[0].hasAccessToken).toBe(true)
    expect(validateDrafts(drafts)).toEqual([])
  })

  it('flags a freshly added destination with genuinely empty fields', () => {
    const drafts = parseDestinations(
      JSON.stringify([
        { id: 'pixel-abc123', label: 'Pixel 1', pixelId: '', accessToken: '', enabled: true },
      ]),
    )
    const errors = validateDrafts(drafts)
    expect(errors.some((e) => e.includes('pixel id is required'))).toBe(true)
    expect(errors.some((e) => e.includes('access token is required'))).toBe(true)
  })

  it('does not require a token for a disabled destination', () => {
    const drafts = parseDestinations(
      JSON.stringify([{ id: 'a', pixelId: '111', accessToken: '', enabled: false }]),
    )
    expect(validateDrafts(drafts)).toEqual([])
  })

  it('does not require pixel id or token for a soft-removed destination', () => {
    const drafts = parseDestinations(
      JSON.stringify([{ id: 'a', removedAt: new Date().toISOString(), enabled: false }]),
    )
    expect(validateDrafts(drafts)).toEqual([])
  })

  it('revalidates clean on a fresh server value (reseed must clear stale errors)', () => {
    // Simulates the reseed path: pre-save drafts were invalid, but the adopted
    // server value validates clean — errors must be recomputed, not linger.
    expect(validateDrafts(parseDestinations(serverPayload))).toEqual([])
  })
})

describe('hasConfiguredDestinations (legacy fallback visibility)', () => {
  it('is false when no destination array is stored', () => {
    expect(hasConfiguredDestinations('')).toBe(false)
    expect(hasConfiguredDestinations(undefined)).toBe(false)
    expect(hasConfiguredDestinations('[]')).toBe(false)
  })

  it('is false for malformed stored values (legacy fallback stays active)', () => {
    expect(hasConfiguredDestinations('{not json')).toBe(false)
  })

  it('is true once at least one destination entry exists', () => {
    expect(
      hasConfiguredDestinations(
        JSON.stringify([{ id: 'a', pixelId: '111', accessToken: 't' }]),
      ),
    ).toBe(true)
  })
})
