import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { PhysicalStockConfirmHelp } from './physical-stock-confirm-help'
import type { PhysicalStockConfirmError } from '../physical-stock-confirm-error'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    search,
    ...rest
  }: {
    children?: React.ReactNode
    to: string
    search?: Record<string, string>
  }) => {
    const qs = search
      ? `?${new URLSearchParams(search).toString()}`
      : ''
    return (
      <a href={`${to}${qs}`} {...rest}>
        {children}
      </a>
    )
  },
}))

/**
 * Confirm-gate physical-stock help (2026-11-24 inventory fix round,
 * Issue 4): the status dialog must show the failure reason AND a direct
 * path to add physical stock for that product — not a bare error.
 */
describe('PhysicalStockConfirmHelp', () => {
  const reason =
    'Insufficient physical stock for "Eco Bag". Available: 1, needed: 3.'

  it('renders nothing without an error', async () => {
    const page = await render(<PhysicalStockConfirmHelp error={null} />)
    await expect
      .element(page.getByTestId('physical-stock-confirm-help'))
      .not.toBeInTheDocument()
  })

  it('deep-links a simple product to its inventory detail page (Adjust lives there)', async () => {
    const error: PhysicalStockConfirmError = {
      message: reason,
      productName: 'Eco Bag',
      productId: 'p1',
      variantId: null,
    }
    const page = await render(<PhysicalStockConfirmHelp error={error} />)

    await expect
      .element(page.getByTestId('physical-stock-confirm-help'))
      .toBeInTheDocument()
    await expect.element(page.getByText(/Cannot confirm yet/)).toBeInTheDocument()
    await expect.element(page.getByText(/Insufficient physical stock/)).toBeInTheDocument()
    const addLink = page.getByRole('link', { name: /Add physical stock/ })
    await expect.element(addLink).toBeInTheDocument()
    await expect
      .element(addLink)
      .toHaveAttribute('href', '/op/inventory/detail?productId=p1')
    await expect
      .element(page.getByRole('link', { name: /or create a purchase order/ }))
      .toHaveAttribute('href', '/op/purchases')
  })

  it('sends a variant line to the purchase path (no Adjust on the detail page for variable products)', async () => {
    const error: PhysicalStockConfirmError = {
      message:
        '"Cotton Tee" এর Physical Stock অপর্যাপ্ত। Available: 1, Needed: 3। Inventory Management চালু থাকলে Physical Stock ছাড়া Order Confirm করা যাবে না।',
      productName: 'Cotton Tee',
      productId: 'p2',
      variantId: 'v2',
    }
    const page = await render(<PhysicalStockConfirmHelp error={error} />)

    const purchaseLink = page.getByRole('link', {
      name: /Create purchase order/,
    })
    await expect.element(purchaseLink).toBeInTheDocument()
    await expect
      .element(purchaseLink)
      .toHaveAttribute('href', '/op/purchases')
    // Still offers the inventory page as a view-only secondary link.
    await expect
      .element(page.getByRole('link', { name: /View inventory/ }))
      .toHaveAttribute('href', '/op/inventory/detail?productId=p2')
  })

  it('offers the purchase path when no product could be resolved', async () => {
    const error: PhysicalStockConfirmError = {
      message: 'Insufficient physical stock. No physical inventory record found.',
    }
    const page = await render(<PhysicalStockConfirmHelp error={error} />)

    await expect
      .element(page.getByRole('link', { name: /Create purchase order/ }))
      .toHaveAttribute('href', '/op/purchases')
    await expect
      .element(page.getByRole('link', { name: /Add physical stock/ }))
      .not.toBeInTheDocument()
  })
})
