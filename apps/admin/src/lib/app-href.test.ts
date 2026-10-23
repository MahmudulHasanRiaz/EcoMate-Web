import { describe, expect, it } from 'vitest'
import { APP_BASEPATH, appHref } from './app-href'

describe('appHref (D8: raw anchors must carry the router basepath)', () => {
  it('prefixes app-relative paths with the basepath', () => {
    expect(appHref('/mon/analytics/products')).toBe('/admin/mon/analytics/products')
    expect(appHref('/op/orders/abc?view=ladder')).toBe('/admin/op/orders/abc?view=ladder')
    expect(appHref('/mon/analytics/marketing#fixlist')).toBe('/admin/mon/analytics/marketing#fixlist')
  })

  it('is idempotent for already-prefixed paths', () => {
    expect(appHref('/admin/op/print/invoice/1')).toBe('/admin/op/print/invoice/1')
    expect(appHref(APP_BASEPATH)).toBe(APP_BASEPATH)
  })

  it('leaves non-path values untouched', () => {
    expect(appHref('https://example.com/x')).toBe('https://example.com/x')
    expect(appHref('tel:+8801700000000')).toBe('tel:+8801700000000')
  })
})
