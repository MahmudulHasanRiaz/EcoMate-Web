import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { OthersInfoIconButton, canViewOthersInfo } from './others-info-icon-button'

describe('OthersInfoIconButton (Part 6 compact header)', () => {
  it('shows the icon-only control to admin and opens the dialog', async () => {
    const onOpen = vi.fn()
    const page = await render(<OthersInfoIconButton role='admin' onOpen={onOpen} />)
    const button = page.getByRole('button', { name: 'Others Information' })
    await expect.element(button).toBeInTheDocument()
    await userEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('shows the icon-only control to superadmin', async () => {
    const page = await render(<OthersInfoIconButton role='superadmin' onOpen={vi.fn()} />)
    await expect
      .element(page.getByRole('button', { name: 'Others Information' }))
      .toBeInTheDocument()
  })

  it('stays hidden for other roles', async () => {
    const page = await render(<OthersInfoIconButton role='manager' onOpen={vi.fn()} />)
    await expect
      .element(page.getByRole('button', { name: 'Others Information' }))
      .not.toBeInTheDocument()
    expect(canViewOthersInfo('manager')).toBe(false)
    expect(canViewOthersInfo('staff')).toBe(false)
    expect(canViewOthersInfo(null)).toBe(false)
  })
})
