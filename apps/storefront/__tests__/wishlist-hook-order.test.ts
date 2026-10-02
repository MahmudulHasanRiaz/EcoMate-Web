/**
 * Structural regression guard for the wishlist hook-order crash.
 *
 * The page used to declare five hooks BELOW its licence early-return. The
 * storefront config loads asynchronously, so the first render always took the
 * "Not Available" branch and the second took the full path — React rejects a
 * hook-count change and the page crashed. This asserts the ordering holds by
 * reading the component source: every hook must appear before the first
 * top-level `return`.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = resolve(__dirname, '../app/(main)/wishlist/page.tsx')

describe('WishlistPage — hook ordering', () => {
  it('declares no hook after the licence early-return', () => {
    const text = readFileSync(SRC, 'utf8')

    const start = text.indexOf('export default function WishlistPage')
    expect(start).toBeGreaterThan(-1)
    const body = text.slice(start)

    const guardAt = body.indexOf(
      "if (!config.licenseFeatures?.includes('storefront_wishlist')) {",
    )
    expect(guardAt).toBeGreaterThan(-1)

    const hooks = [
      'useState<Product[]>',
      'useState<Record<string, boolean>>',
      'useState(true)',
      'useCatalogImageStyle',
      'useEffect(',
    ]
    for (const hook of hooks) {
      const at = body.indexOf(hook)
      expect(at, `${hook} must be declared`).toBeGreaterThan(-1)
      expect(
        at,
        `${hook} must be declared BEFORE the licence early-return (guard at ${guardAt}, hook at ${at})`,
      ).toBeLessThan(guardAt)
    }
  })
})
