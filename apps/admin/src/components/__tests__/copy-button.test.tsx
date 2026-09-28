import { describe, it, expect } from 'vitest'
import { render } from 'vitest-browser-react'
import { CopyButton } from '@/components/copy-button'

describe('CopyButton', () => {
  it('renders a subtle copy button with an accessible label', async () => {
    const { getByRole } = await render(<CopyButton text='ORD-260818-0013' label='Order ID' />)
    await expect.element(getByRole('button', { name: 'Copy Order ID' })).toBeInTheDocument()
  })

  it('renders nothing when there is no text to copy', async () => {
    await render(<CopyButton text='' label='Order ID' />)
    expect(document.querySelector('button[aria-label]')).toBeNull()
  })

  it('swaps to a green check for 1.5s after copying', async () => {
    const { getByRole } = await render(<CopyButton text='+8801712121213' label='Phone' />)
    const button = getByRole('button', { name: 'Copy Phone' })
    await button.click()
    expect(document.querySelector('svg.text-emerald-500')).not.toBeNull()
    await expect.element(button).toBeInTheDocument()
  })
})
