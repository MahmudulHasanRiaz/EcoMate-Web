import { describe, expect, it } from 'vitest'
import type { GatewayConfig } from '@/features/gateways/api'
import { gatewayKey, normalizeLegacyGatewayCode } from './gateway-normalize'

/** Gateway shapes mirroring the seeded configuration. */
function gateway(over: Partial<GatewayConfig> & { code: string }): GatewayConfig {
  return {
    id: `gw-${over.code}`,
    name: over.code,
    type: 'manual',
    paymentOptionType: 'FULL_PAYMENT',
    paymentOptionName: 'Full Payment',
    paymentOptionEnabled: true,
    enabled: true,
    mode: 'personal',
    phoneNumber: null,
    credentials: {},
    sortOrder: 1,
    ...over,
  } as GatewayConfig
}

const cash = gateway({
  code: 'cash',
  name: 'Cash',
  type: 'cash',
  paymentOptionType: 'CASH_ON_DELIVERY',
  sortOrder: 1,
})
const bkash = gateway({ code: 'bkash', name: 'bKash (Manual)', sortOrder: 2 })
const nagad = gateway({ code: 'nagad', name: 'Nagad (Manual)', sortOrder: 3 })
const bkashPgw = gateway({
  code: 'bkash_pgw',
  name: 'bKash PGW (API)',
  type: 'api',
  sortOrder: 4,
})

const all = [cash, bkash, nagad, bkashPgw]

describe('gatewayKey', () => {
  it('lowercases and drops separators', () => {
    expect(gatewayKey('CASH_ON_DELIVERY')).toBe('cashondelivery')
    expect(gatewayKey('bKash PGW (API)')).toBe('bkashpgwapi')
    expect(gatewayKey(null)).toBe('')
    expect(gatewayKey(undefined)).toBe('')
  })
})

describe('normalizeLegacyGatewayCode', () => {
  it('resolves every cash-on-delivery spelling to the configured COD gateway', () => {
    for (const raw of ['CASH_ON_DELIVERY', 'cash_on_delivery', 'cash', 'cod', 'COD', ' Cash ']) {
      expect(normalizeLegacyGatewayCode(raw, all)).toBe('cash')
    }
  })

  it('keeps a value that already is a configured gateway code', () => {
    expect(normalizeLegacyGatewayCode('bkash', all)).toBe('bkash')
    expect(normalizeLegacyGatewayCode('nagad', all)).toBe('nagad')
    expect(normalizeLegacyGatewayCode('bkash_pgw', all)).toBe('bkash_pgw')
  })

  it('matches a configured gateway by name, ignoring case and separators', () => {
    expect(normalizeLegacyGatewayCode('BKASH', all)).toBe('bkash')
    expect(normalizeLegacyGatewayCode('bKash (Manual)', all)).toBe('bkash')
    expect(normalizeLegacyGatewayCode('bKash PGW (API)', all)).toBe('bkash_pgw')
  })

  it('follows a gateway renamed in configuration', () => {
    const renamed = [
      cash,
      gateway({ code: 'bkash', name: 'bKash Business API', sortOrder: 2 }),
    ]
    expect(normalizeLegacyGatewayCode('bkash', renamed)).toBe('bkash')
    expect(normalizeLegacyGatewayCode('bKash Business API', renamed)).toBe('bkash')
  })

  it('falls back to the COD gateway for an unknown or empty value', () => {
    expect(normalizeLegacyGatewayCode('mystery_pay', all)).toBe('cash')
    expect(normalizeLegacyGatewayCode('', all)).toBe('cash')
    expect(normalizeLegacyGatewayCode(null, all)).toBe('cash')
    expect(normalizeLegacyGatewayCode(undefined, all)).toBe('cash')
  })

  it('falls back to the first enabled gateway when no COD gateway is enabled', () => {
    const noCod = [bkash, nagad].map((g) => ({ ...g }))
    expect(normalizeLegacyGatewayCode('CASH_ON_DELIVERY', noCod)).toBe('bkash')
    expect(normalizeLegacyGatewayCode('anything', noCod)).toBe('bkash')
  })

  it('ignores disabled gateways', () => {
    const onlyBkashEnabled = [
      { ...cash, enabled: false },
      { ...bkash, enabled: true },
    ]
    expect(normalizeLegacyGatewayCode('cod', onlyBkashEnabled)).toBe('bkash')
  })

  it('returns an empty code when nothing is configured or loaded', () => {
    expect(normalizeLegacyGatewayCode('cod', [])).toBe('')
    expect(normalizeLegacyGatewayCode('cod', undefined)).toBe('')
  })
})
