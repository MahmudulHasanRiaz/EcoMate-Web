import { describe, it, expect } from 'vitest'
import { healthTone, capabilityNotices, type ProviderCapabilities } from './api'

const baseCaps: ProviderCapabilities = {
  products: true, variations: true, categories: true, media: true,
  delete: true, seo: true, costPrice: true, weight: true, dimensions: true,
  slug: true, orders: true, webhooks: true, orderStatusUpdate: true,
  orderStatusUpdateTargets: ['cancelled', 'completed'],
  stockStatusFidelity: 'faithful', contactCheckExposure: true,
  categoryModel: 'taxonomy', seoModel: 'native', mediaModel: 'url-fetch',
  combos: false, externalEditsDetectable: 'plugin',
}

describe('channels API helpers (P1)', () => {
  describe('healthTone', () => {
    it('maps the §12 health vocabulary to badge tones', () => {
      expect(healthTone('HEALTHY')).toBe('success')
      expect(healthTone('ATTENTION_REQUIRED')).toBe('warning')
      expect(healthTone('ERROR')).toBe('destructive')
      expect(healthTone('DISCONNECTED')).toBe('muted')
    })
  })

  describe('capabilityNotices', () => {
    it('returns no rows for a fully-capable provider', () => {
      expect(capabilityNotices({ ...baseCaps, combos: true })).toEqual([])
    })

    it('surfaces Shopify-style monitor-only stock as information, never failure', () => {
      const rows = capabilityNotices({ ...baseCaps, stockStatusFidelity: 'unsupported' })
      expect(rows.some(r => r.includes('monitor-only'))).toBe(true)
      expect(rows.some(r => r.toLowerCase().includes('fail'))).toBe(false)
    })

    it('always notes combos=false (BR-22) and missing SEO/dimensions', () => {
      const rows = capabilityNotices({ ...baseCaps, seo: false, dimensions: false })
      expect(rows.some(r => r.includes('BR-22'))).toBe(true)
      expect(rows.some(r => r.includes('companion plugin'))).toBe(true)
      expect(rows.some(r => r.includes('Dimensions'))).toBe(true)
    })

    it('handles null capabilities', () => {
      expect(capabilityNotices(null)).toEqual([])
      expect(capabilityNotices(undefined)).toEqual([])
    })
  })
})
