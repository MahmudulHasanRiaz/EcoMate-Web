import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { useState } from 'react'
import { ReturnItemPicker } from './return-item-picker'

const items = [
  { id: 'oi-1', productId: 'p1', variantId: null, quantity: 3, product: { name: 'Widget' }, variant: null },
  { id: 'oi-2', productId: 'p2', variantId: null, quantity: 1, product: { name: 'Gadget' }, variant: null },
]

async function renderPicker(props?: { maxQty?: Record<string, number>; initial?: Record<string, number> }) {
  const onChange = vi.fn()
  const Harness = () => {
    const [value, setValue] = useState<Record<string, number>>(props?.initial ?? {})
    return (
      <ReturnItemPicker
        items={items}
        value={value}
        onChange={(v) => { setValue(v); onChange(v) }}
        maxQty={props?.maxQty}
      />
    )
  }
  const page = await render(<Harness />)
  return { page, onChange }
}

describe('ReturnItemPicker maxQty caps', () => {
  it('caps the stepper at the remaining quantity, not the ordered quantity', async () => {
    const { page } = await renderPicker({ maxQty: { 'oi-1': 1, 'oi-2': 1 } })
    await userEvent.click(page.getByRole('button', { name: 'Increase return quantity for Widget' }))
    // Already at the cap (1 of 3 ordered, 2 already returned) — a second
    // increase is refused.
    await expect
      .element(page.getByRole('button', { name: 'Increase return quantity for Widget' }))
      .toBeDisabled()
  })

  it('shows the capped remaining count per line', async () => {
    await renderPicker({ maxQty: { 'oi-1': 1, 'oi-2': 1 } })
    // Widget row: cap 1, picked 0 → the Remaining cell shows 1 (not the ordered 3).
    const row = Array.from(document.querySelectorAll('tr')).find((tr) =>
      tr.textContent?.includes('Widget'),
    )
    const cells = row?.querySelectorAll('td') ?? []
    expect(cells[cells.length - 1]?.textContent).toBe('1')
  })

  it('defaults to the ordered quantity when no cap is given (legacy behavior)', async () => {
    const { page } = await renderPicker()
    await userEvent.click(page.getByRole('button', { name: 'Increase return quantity for Widget' }))
    await userEvent.click(page.getByRole('button', { name: 'Increase return quantity for Widget' }))
    // 2 < 3 ordered → still enabled.
    await expect
      .element(page.getByRole('button', { name: 'Increase return quantity for Widget' }))
      .toBeEnabled()
  })
})
