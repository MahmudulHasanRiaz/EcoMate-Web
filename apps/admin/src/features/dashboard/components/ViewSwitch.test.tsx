import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { ViewSwitch } from './ViewSwitch'

describe('ViewSwitch', () => {
  it('renders both views with the active one unambiguously marked', async () => {
    const view = await render(<ViewSwitch view='activity' onChange={() => {}} />)

    await expect.element(view.getByText('Activity', { exact: true })).toBeInTheDocument()
    await expect.element(view.getByText('Pipeline', { exact: true })).toBeInTheDocument()

    // Active view is exposed to sighted users AND assistive tech.
    await expect.element(view.getByRole('button', { name: /Activity/ })).toHaveAttribute('aria-pressed', 'true')
    await expect.element(view.getByRole('button', { name: /Pipeline/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('marks Pipeline active when it is the current view', async () => {
    const view = await render(<ViewSwitch view='pipeline' onChange={() => {}} />)

    await expect.element(view.getByRole('button', { name: /Pipeline/ })).toHaveAttribute('aria-pressed', 'true')
    await expect.element(view.getByRole('button', { name: /Activity/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('notifies with the other view when its button is clicked', async () => {
    const onChange = vi.fn()
    const view = await render(<ViewSwitch view='activity' onChange={onChange} />)

    await view.getByRole('button', { name: /Pipeline/ }).click()

    expect(onChange).toHaveBeenCalledWith('pipeline')
  })

  it('explains each view purpose via tooltip', async () => {
    const view = await render(<ViewSwitch view='activity' onChange={() => {}} />)

    await expect
      .element(view.getByRole('button', { name: /Activity/ }))
      .toHaveAttribute('title', 'What happened in the selected period')
    await expect
      .element(view.getByRole('button', { name: /Pipeline/ }))
      .toHaveAttribute('title', 'Where orders created in the selected period stand now')
  })
})
