import { describe, it, expect, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { CustomerContactActions } from '@/components/customer-contact-actions'

const PHONE = '+8801712121213'

describe('CustomerContactActions', () => {
  it('renders a copy action and no call action (the number itself is the call link)', async () => {
    const { container, getByRole } = await render(<CustomerContactActions phone={PHONE} />)

    await expect.element(getByRole('button', { name: `Copy phone ${PHONE}` })).toBeInTheDocument()
    // The caller renders the number as a `tel:` link — this component must not
    // add a second call affordance next to it.
    expect(container.querySelectorAll('a[href^="tel:"]').length).toBe(0)
    expect(container.querySelectorAll('a[href*="wa.me"]').length).toBe(1)
  })

  it('copies the phone number to the clipboard on click', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const { getByRole } = await render(<CustomerContactActions phone={PHONE} />)
    await getByRole('button', { name: `Copy phone ${PHONE}` }).click()

    expect(writeText).toHaveBeenCalledWith(PHONE)
  })

  it('renders nothing without a phone number', async () => {
    const { container } = await render(<CustomerContactActions phone={null} />)
    expect(container.querySelector('button[aria-label]')).toBeNull()
  })
})
