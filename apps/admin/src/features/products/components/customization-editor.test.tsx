import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { CustomizationEditor } from './customization-editor'
import type { CustomizationGroupDef } from '@/lib/customization'

/**
 * Regression (staging E2E 2026-10-23): the group/option key auto-derivation
 * ran `key || slug(label)` on every keystroke, so the key froze at the slug
 * of the FIRST typed character ("G" → "g") and every group ended up keyed
 * "g". The key must follow the label until the user edits the key by hand.
 */

function Harness({ initial }: { initial: CustomizationGroupDef[] }) {
  const [value, setValue] = useState<CustomizationGroupDef[]>(initial)
  return (
    <div>
      <CustomizationEditor value={value} onChange={setValue} />
      <output data-testid='state'>{JSON.stringify(value)}</output>
    </div>
  )
}

const emptyGroup: CustomizationGroupDef = {
  key: '',
  label: '',
  type: 'single',
  required: false,
  options: [{ key: '', label: '', priceDelta: 0, costDelta: 0, pricingKind: 'per_unit' }],
} as CustomizationGroupDef

describe('CustomizationEditor key derivation', () => {
  it('derives the group key from the FULL label, not the first character', async () => {
    const { getByPlaceholder, getByTestId } = await render(<Harness initial={[emptyGroup]} />)
    await userEvent.type(getByPlaceholder(/Name Engraving/), 'Gift wrap')
    const state = JSON.parse(getByTestId('state').element().textContent || '[]')
    expect(state[0].label).toBe('Gift wrap')
    expect(state[0].key).toBe('gift_wrap')
  })

  it('derives the option key from the full option label', async () => {
    const { getByPlaceholder, getByTestId } = await render(<Harness initial={[emptyGroup]} />)
    await userEvent.type(getByPlaceholder(/Gold Foil/), 'Premium wrap')
    const state = JSON.parse(getByTestId('state').element().textContent || '[]')
    expect(state[0].options[0].key).toBe('premium_wrap')
  })

  it('never overwrites a hand-edited key when the label changes', async () => {
    const preset: CustomizationGroupDef = {
      ...emptyGroup,
      key: 'my-custom-key',
      label: 'Gift',
    } as CustomizationGroupDef
    const { getByPlaceholder, getByTestId } = await render(<Harness initial={[preset]} />)
    await userEvent.fill(getByPlaceholder(/Name Engraving/), 'Gift wrap')
    const state = JSON.parse(getByTestId('state').element().textContent || '[]')
    expect(state[0].label).toBe('Gift wrap')
    expect(state[0].key).toBe('my-custom-key')
  })
})
