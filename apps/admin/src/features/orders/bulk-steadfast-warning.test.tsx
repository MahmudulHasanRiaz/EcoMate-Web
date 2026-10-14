import { describe, expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { BulkSteadfastDefaultWarning } from './bulk-steadfast-warning'

// MEDIUM bulk-silent: bulk books with the default Steadfast account —
// warn visibly only when steadfast is picked AND >1 sets exist.
describe('BulkSteadfastDefaultWarning', () => {
  it('shows the warning for steadfast with multiple sets', async () => {
    const ui = await render(
      <BulkSteadfastDefaultWarning courier='steadfast' setCount={2} />,
    )
    await expect
      .element(ui.getByText('Bulk books with the default Steadfast account'))
      .toBeInTheDocument()
  })

  it('hides the warning for a single set (zero friction)', async () => {
    await render(
      <BulkSteadfastDefaultWarning courier='steadfast' setCount={1} />,
    )
    await new Promise((r) => setTimeout(r, 100))
    expect(document.body.textContent || '').not.toMatch(/Bulk books with/)
  })

  it('hides the warning for other couriers', async () => {
    await render(<BulkSteadfastDefaultWarning courier='pathao' setCount={3} />)
    await new Promise((r) => setTimeout(r, 100))
    expect(document.body.textContent || '').not.toMatch(/Bulk books with/)
  })
})
