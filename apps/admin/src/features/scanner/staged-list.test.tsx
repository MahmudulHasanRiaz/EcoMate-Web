import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from 'vitest-browser-react'
import { StagedList, type StagedRow } from './staged-list'

const rows: StagedRow[] = [
  {
    key: 'r1',
    orderId: 'ord-1',
    primary: 'RTN-261020-0001',
    secondary: 'ORD-261020-0007',
    customerName: 'Karim Uddin',
    phone: '01712345678',
    meta: '2 items',
    status: 'REQUESTED',
    searchText: 'rtn-261020-0001 ord-261020-0007 karim uddin 01712345678',
  },
  {
    key: 'r2',
    orderId: 'ord-2',
    primary: 'RTN-261020-0002',
    customerName: 'Ayesha',
    meta: '1 item',
    status: 'RESTOCKED',
    searchText: 'rtn-261020-0002 ayesha',
  },
]

const rowsWithExpand = (overrides: Partial<StagedRow> = {}): StagedRow[] => [
  {
    ...rows[0],
    expand: {
      heading: 'Returned: 2 of 3 items',
      note: undefined,
      items: [
        { name: 'Sky Tee', sub: 'Size: M · TEE-SKY-M', image: null, quantity: 2, price: '৳600' },
        { name: 'Printed Mug', sub: 'MUG-1', image: null, quantity: 1, price: '৳300' },
      ],
    },
    ...overrides,
  },
  rows[1],
]

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
})

async function renderList(props: { items?: StagedRow[]; openLabel?: (r: StagedRow) => string } = {}) {
  const onClear = vi.fn()
  const screen = await render(
    <StagedList
      title="Staged returns"
      items={props.items ?? rows}
      orderHref={(r) => (r.destKind === 'return' ? `/op/returns/${r.orderId}` : `/op/orders/${r.orderId}`)}
      onRemove={() => {}}
      onClear={onClear}
      openLabel={props.openLabel}
    />,
  )
  return { ...screen, onClear }
}

describe('StagedList phone + contact actions', () => {
  it('renders the phone as a tel: link plus a WhatsApp contact action', async () => {
    const { container } = await renderList()
    const tel = container.querySelectorAll('a[href^="tel:"]')
    expect(tel.length).toBe(1)
    expect(tel[0].getAttribute('href')).toBe('tel:01712345678')
    expect(container.querySelectorAll('a[href*="wa.me"]').length).toBe(1)
  })

  it('renders no phone affordances for rows without a phone', async () => {
    const { container } = await renderList({ items: rows.map((r) => ({ ...r, phone: undefined })) })
    expect(container.querySelector('a[href^="tel:"]')).toBeNull()
    expect(container.querySelector('a[href*="wa.me"]')).toBeNull()
  })
})

describe('StagedList chevron expansion', () => {
  it('toggles the expansion panel with heading + item name/qty', async () => {
    const { getByRole, getByText } = await renderList({ items: rowsWithExpand() })
    const chevron = getByRole('button', { name: /expand/i })
    await expect.element(chevron).toBeInTheDocument()
    await chevron.click()
    await expect.element(getByText('Returned: 2 of 3 items')).toBeInTheDocument()
    await expect.element(getByText('Sky Tee')).toBeInTheDocument()
    await expect.element(getByText('× 2')).toBeInTheDocument()
    // image thumb uses the item name as alt even with no URL
    const img = document.querySelector('img[alt="Sky Tee"]')
    expect(img).not.toBeNull()
  })

  it('shows the note text inside the panel when provided', async () => {
    const { getByRole, getByText } = await renderList({
      items: rowsWithExpand({ expand: { heading: 'Attention', note: 'Already received — stock restored earlier.', items: [] } }),
    })
    await getByRole('button', { name: /expand/i }).click()
    await expect.element(getByText('Attention')).toBeInTheDocument()
    await expect.element(getByText('Already received — stock restored earlier.')).toBeInTheDocument()
  })

  it('closes on outside click and on Escape', async () => {
    const { getByRole, container } = await renderList({ items: rowsWithExpand() })
    const chevron = getByRole('button', { name: /expand/i })
    await chevron.click()
    await vi.waitFor(() => expect(container.textContent).toContain('Sky Tee'))
    // outside click (header area is off-panel)
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await vi.waitFor(() => expect(container.textContent).not.toContain('Sky Tee'))
    // reopen, then Escape closes
    await chevron.click()
    await vi.waitFor(() => expect(container.textContent).toContain('Sky Tee'))
    container.ownerDocument.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await vi.waitFor(() => expect(container.textContent).not.toContain('Sky Tee'))
  })

  it('renders NO chevron when no row carries expand data', async () => {
    const { container } = await renderList()
    expect(container.querySelectorAll('button[aria-expanded]').length).toBe(0)
  })

  it('panel is a keyboard-reachable region (role + tabindex) so it can be scrolled without a pointer', async () => {
    const { getByRole, container } = await renderList({ items: rowsWithExpand() })
    await getByRole('button', { name: /expand/i }).click()
    await vi.waitFor(() => expect(container.textContent).toContain('Sky Tee'))
    const panel = container.querySelector('[data-staged-panel]') as HTMLElement
    expect(panel.getAttribute('role')).toBe('region')
    expect(panel.getAttribute('tabindex')).toBe('0')
  })

  it('defers Escape while a dialog is open — the dialog owns ESC, the panel stays until it closes', async () => {
    const { getByRole, container } = await renderList({ items: rowsWithExpand() })
    await getByRole('button', { name: /expand/i }).click()
    await vi.waitFor(() => expect(container.textContent).toContain('Sky Tee'))
    const dialog = document.createElement('div')
    dialog.setAttribute('role', 'dialog')
    dialog.setAttribute('data-state', 'open')
    document.body.appendChild(dialog)
    container.ownerDocument.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await new Promise((r) => setTimeout(r, 20))
    expect(container.textContent).toContain('Sky Tee') // still open — ESC belongs to the dialog
    dialog.remove()
    container.ownerDocument.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await vi.waitFor(() => expect(container.textContent).not.toContain('Sky Tee'))
  })

  it('honors the caller openLabel override for the external link', async () => {
    const { getByTitle, getByLabelText } = await renderList({
      openLabel: (r) => `Open return ${r.secondary ?? r.primary}`,
    })
    await expect.element(getByTitle('Open return ORD-261020-0007')).toBeInTheDocument()
    await expect.element(getByLabelText('Open return ORD-261020-0007 in a new tab')).toBeInTheDocument()
  })
})
