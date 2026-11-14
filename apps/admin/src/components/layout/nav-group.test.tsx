import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import type { NavItem } from './types'

const hrefState = vi.hoisted(() => ({ href: '/op/overview' }))
const setOpenMobile = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: any) => (
    <a href={to as string} {...rest}>
      {children}
    </a>
  ),
  useLocation: () => hrefState.href,
}))

vi.mock('@/components/ui/sidebar', () => ({
  SidebarGroup: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SidebarGroupLabel: ({ children, ...props }: any) => <div {...props}>{children}</div>,
  SidebarMenu: ({ children, ...props }: any) => <ul {...props}>{children}</ul>,
  SidebarMenuButton: ({ children, isActive, tooltip, asChild, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  SidebarMenuItem: ({ children, ...props }: any) => <li {...props}>{children}</li>,
  SidebarMenuSub: ({ children, ...props }: any) => <ul {...props}>{children}</ul>,
  // The real SubButton uses asChild (Slot), so the <a> IS the button — no
  // extra button role. Render children directly for the same shape.
  SidebarMenuSubButton: ({ children }: any) => <>{children}</>,
  SidebarMenuSubItem: ({ children, ...props }: any) => <li {...props}>{children}</li>,
  useSidebar: () => ({ state: 'expanded', isMobile: false, setOpenMobile }),
}))

import { NavGroup } from './nav-group'

const ITEMS: NavItem[] = [
  { title: 'Dashboard', url: '/op/overview' },
  {
    title: 'Orders',
    items: [
      { title: 'All Orders', url: '/op/orders' },
      { title: 'Returns', url: '/op/returns' },
    ],
  },
  {
    title: 'Products',
    items: [
      { title: 'All Products', url: '/op/products' },
      { title: 'Categories', url: '/op/categories' },
    ],
  },
  {
    title: 'Settings',
    items: [
      { title: 'General', url: '/op/settings/general' },
      { title: 'Payment', url: '/op/settings/payment' },
    ],
  },
]

function trigger(screen: any, name: string) {
  // Playwright name matching is substring by default; exact keeps 'Orders'
  // from also matching the 'All Orders' sub-item.
  return screen.getByRole('button', { name, exact: true })
}

describe('NavGroup smart accordion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hrefState.href = '/op/overview'
  })

  it('opens the group holding the current route on first load and keeps the others closed', async () => {
    hrefState.href = '/op/orders'
    const screen = await render(<NavGroup title="" items={ITEMS} />)

    await expect.element(trigger(screen, 'Orders')).toHaveAttribute('aria-expanded', 'true')
    await expect.element(trigger(screen, 'Products')).toHaveAttribute('aria-expanded', 'false')
    await expect.element(trigger(screen, 'Settings')).toHaveAttribute('aria-expanded', 'false')
    await expect.element(screen.getByRole('link', { name: 'All Orders' })).toBeVisible()
  })

  it('keeps every group closed when the route belongs to none of them', async () => {
    const screen = await render(<NavGroup title="" items={ITEMS} />)

    await expect.element(trigger(screen, 'Orders')).toHaveAttribute('aria-expanded', 'false')
    await expect.element(trigger(screen, 'Products')).toHaveAttribute('aria-expanded', 'false')
    await expect.element(trigger(screen, 'Settings')).toHaveAttribute('aria-expanded', 'false')
  })

  it('opening one group closes the previously open one (accordion)', async () => {
    hrefState.href = '/op/orders'
    const screen = await render(<NavGroup title="" items={ITEMS} />)

    await expect.element(trigger(screen, 'Orders')).toHaveAttribute('aria-expanded', 'true')

    await userEvent.click(trigger(screen, 'Products'))

    await expect.element(trigger(screen, 'Products')).toHaveAttribute('aria-expanded', 'true')
    await expect.element(trigger(screen, 'Orders')).toHaveAttribute('aria-expanded', 'false')
    await expect.element(trigger(screen, 'Settings')).toHaveAttribute('aria-expanded', 'false')
    await expect.element(screen.getByRole('link', { name: 'All Products' })).toBeVisible()
  })

  it('clicking the open group closes it manually', async () => {
    hrefState.href = '/op/orders'
    const screen = await render(<NavGroup title="" items={ITEMS} />)

    await userEvent.click(trigger(screen, 'Orders'))

    await expect.element(trigger(screen, 'Orders')).toHaveAttribute('aria-expanded', 'false')
  })

  it('auto-opens the new active group on navigation and closes the previous one', async () => {
    hrefState.href = '/op/orders'
    const screen = await render(<NavGroup title="" items={ITEMS} />)
    await expect.element(trigger(screen, 'Orders')).toHaveAttribute('aria-expanded', 'true')

    hrefState.href = '/op/settings/payment'
    await screen.rerender(<NavGroup title="" items={ITEMS} />)

    await expect.element(trigger(screen, 'Settings')).toHaveAttribute('aria-expanded', 'true')
    await expect.element(trigger(screen, 'Orders')).toHaveAttribute('aria-expanded', 'false')
    await expect.element(trigger(screen, 'Products')).toHaveAttribute('aria-expanded', 'false')
  })

  it('a manually closed active group stays closed until the next navigation', async () => {
    hrefState.href = '/op/orders'
    const screen = await render(<NavGroup title="" items={ITEMS} />)

    await userEvent.click(trigger(screen, 'Orders'))
    await expect.element(trigger(screen, 'Orders')).toHaveAttribute('aria-expanded', 'false')

    // Same route re-render must not yank the manual close back open.
    await screen.rerender(<NavGroup title="" items={ITEMS} />)
    await expect.element(trigger(screen, 'Orders')).toHaveAttribute('aria-expanded', 'false')

    // Navigating elsewhere and back re-opens the active group.
    hrefState.href = '/op/products'
    await screen.rerender(<NavGroup title="" items={ITEMS} />)
    await expect.element(trigger(screen, 'Products')).toHaveAttribute('aria-expanded', 'true')

    hrefState.href = '/op/orders'
    await screen.rerender(<NavGroup title="" items={ITEMS} />)
    await expect.element(trigger(screen, 'Orders')).toHaveAttribute('aria-expanded', 'true')
  })

  it('a route with a query string still opens its group', async () => {
    hrefState.href = '/op/orders?status=pending'
    const screen = await render(<NavGroup title="" items={ITEMS} />)

    await expect.element(trigger(screen, 'Orders')).toHaveAttribute('aria-expanded', 'true')
    await expect.element(trigger(screen, 'Products')).toHaveAttribute('aria-expanded', 'false')
  })
})
