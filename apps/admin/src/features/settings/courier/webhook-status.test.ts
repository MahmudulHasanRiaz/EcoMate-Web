import { describe, it, expect } from 'vitest'
import { unconfiguredCouriers, webhookBannerCopy } from './webhook-status'

describe('unconfiguredCouriers', () => {
  it('returns [] when every courier verifies', () => {
    expect(
      unconfiguredCouriers({
        steadfast: { configured: true },
        pathao: { configured: true },
        redx: { configured: true },
        carrybee: { configured: true },
      }),
    ).toEqual([])
  })

  it('lists exactly the unverified couriers', () => {
    expect(
      unconfiguredCouriers({
        steadfast: { configured: true },
        pathao: { configured: false },
        redx: { configured: false },
        carrybee: { configured: true },
      }),
    ).toEqual(['pathao', 'redx'])
  })

  it('treats missing keys as unconfigured, ignores unknown keys', () => {
    expect(
      unconfiguredCouriers({
        steadfast: { configured: true },
        unknown: { configured: true },
      }),
    ).toEqual(['pathao', 'redx', 'carrybee'])
  })

  it('returns [] for null payload (loading state shows no banner)', () => {
    expect(unconfiguredCouriers(null)).toEqual([])
    expect(unconfiguredCouriers(undefined)).toEqual([])
  })
})

describe('webhookBannerCopy', () => {
  it('returns null when nothing is unconfigured', () => {
    expect(webhookBannerCopy([])).toBeNull()
  })

  it('names the unverified couriers and the unsigned-acceptance risk', () => {
    const copy = webhookBannerCopy(['pathao', 'redx'])
    expect(copy).toContain('Pathao')
    expect(copy).toContain('RedX')
    expect(copy).toContain('accepted without signature verification')
  })
})
