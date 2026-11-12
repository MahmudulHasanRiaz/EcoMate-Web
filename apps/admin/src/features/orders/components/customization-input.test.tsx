import { describe, it, expect } from 'vitest'
import { render } from 'vitest-browser-react'
import { CustomizationInput } from './customization-input'

/**
 * Regression tests for the P0 stale-bundle round (2026-11-12):
 * corrupt legacy / direct-DB customization data must never crash the
 * order-create page. The old `(g.options || []).map(...)` threw when
 * `options` was a truthy non-array (an object or a string) — `.map`
 * does not exist on it — and the old `definition || []` threw on a
 * non-array definition (`groups.map` / `groups.length` on a string).
 * Both now normalise with Array.isArray at the boundary.
 */
describe('CustomizationInput — corrupt-definition guard', () => {
  const noop = () => {}

  it('renders a single-choice group with a valid options array', async () => {
    const { getByText } = await render(
      <CustomizationInput
        definition={[
          {
            key: 'g',
            label: 'G',
            type: 'single',
            required: false,
            options: [
              { key: 'a', label: 'Option A', priceDelta: 0, costDelta: 0, pricingKind: 'per_unit' },
            ],
          },
        ]}
        value={undefined}
        onChange={noop}
      />,
    )
    await expect.element(getByText('Option A')).toBeInTheDocument()
  })

  it('renders without throwing when options is a non-array object', async () => {
    const { getByText, getByRole } = await render(
      <CustomizationInput
        definition={
          [{ key: 'g', label: 'G', type: 'single', options: { not: 'array' } }] as any
        }
        value={undefined}
        onChange={noop}
      />,
    )
    // Group renders with an empty option list (only the None choice).
    await expect.element(getByText('G')).toBeInTheDocument()
    await expect.element(getByRole('button', { name: 'None' })).toBeInTheDocument()
  })

  it('renders without throwing when options is a string (multi group)', async () => {
    const { getByText } = await render(
      <CustomizationInput
        definition={
          [{ key: 'g', label: 'G', type: 'multi', options: 'not-an-array' }] as any
        }
        value={undefined}
        onChange={noop}
      />,
    )
    await expect.element(getByText('G')).toBeInTheDocument()
  })

  it('renders without throwing when the definition itself is a string', async () => {
    await render(
      <CustomizationInput definition={'not-an-array' as any} value={undefined} onChange={noop} />,
    )
    expect(document.querySelector('.space-y-3')).toBeNull()
  })

  it('renders without throwing when the definition is undefined', async () => {
    await render(
      <CustomizationInput definition={undefined as any} value={undefined} onChange={noop} />,
    )
    expect(document.querySelector('.space-y-3')).toBeNull()
  })
})
