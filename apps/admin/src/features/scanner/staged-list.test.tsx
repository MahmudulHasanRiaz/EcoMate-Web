import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from 'vitest-browser-react'
import '@/styles/index.css'
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
    expect(tel.length).toBeGreaterThan(0)
    expect(tel[0].getAttribute('href')).toBe('tel:01712345678')
    expect(container.querySelectorAll('a[href*="wa.me"]').length).toBe(1)
  })

  it('renders no phone affordances for rows without a phone', async () => {
    const { container } = await renderList({ items: rows.map((r) => ({ ...r, phone: undefined })) })
    expect(container.querySelector('a[href^="tel:"]')).toBeNull()
    expect(container.querySelector('a[href*="wa.me"]')).toBeNull()
  })

  it('exposes call and WhatsApp as REAL buttons with ≥40px hit areas', async () => {
    const { container } = await renderList()
    const call = container.querySelector('a[aria-label^="Call "]') as HTMLElement
    const wa = container.querySelector('a[aria-label^="WhatsApp "]') as HTMLElement
    expect(call).not.toBeNull()
    expect(wa).not.toBeNull()
    expect(call.getBoundingClientRect().width).toBeGreaterThanOrEqual(40)
    expect(call.getBoundingClientRect().height).toBeGreaterThanOrEqual(40)
    expect(wa.getBoundingClientRect().width).toBeGreaterThanOrEqual(40)
    expect(wa.getBoundingClientRect().height).toBeGreaterThanOrEqual(40)
  })
})

describe('StagedList collapsed row (order-list style)', () => {
  it('leads with the item thumbnail and puts the customer name in the loudest slot', async () => {
    const { container, getByText } = await renderList({
      items: [
        {
          ...rows[0],
          thumbs: [{ image: '/uploads/tee.jpg', name: 'Sky Tee' }],
          thumbTotal: 3,
          unitCount: 4,
        },
      ],
    })
    const row = container.querySelector('[data-staged-row]') as HTMLElement
    const thumb = row.querySelector('[data-staged-thumb]') as HTMLElement
    expect(thumb).not.toBeNull()
    // The thumbnail is the FIRST thing in the row.
    expect(row.firstElementChild?.contains(thumb)).toBe(true)
    await expect.element(getByText('Karim Uddin')).toBeInTheDocument()
    // "+N" badge for the remaining lines.
    expect(row.textContent).toContain('+2')
    // Contents summary: total units on the row.
    expect(row.textContent).toContain('4 items')
  })

  it('shows the readiness state ON the row — green Ready vs amber Needs attention + reason', async () => {
    const { getByText, container } = await renderList({
      items: [
        { ...rows[0], ready: true, needsAttention: false },
        {
          ...rows[1],
          ready: false,
          needsAttention: true,
          reason: 'Already received — stock was restored earlier.',
        },
      ],
    })
    await expect.element(getByText('Ready', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Needs attention', { exact: true })).toBeInTheDocument()
    // The reason is READABLE, not a tooltip.
    expect(container.textContent).toContain('Already received — stock was restored earlier.')
  })

  it('keeps the lifecycle chip and drops the 01 index', async () => {
    const { container } = await renderList()
    const row = container.querySelector('[data-staged-row]') as HTMLElement
    expect(row.textContent).toContain('REQUESTED')
    // The zero-padded index is gone — the thumbnail takes its place.
    expect(row.textContent).not.toMatch(/^\s*\d{2}/)
  })

  it('gives the expand and remove actions ≥40px hit areas, separated from each other', async () => {
    const { container } = await renderList({ items: rowsWithExpand() })
    const chevron = container.querySelector('button[data-staged-chevron]') as HTMLElement
    const remove = container.querySelector('button[aria-label^="Remove "]') as HTMLElement
    expect(chevron.getBoundingClientRect().width).toBeGreaterThanOrEqual(40)
    expect(chevron.getBoundingClientRect().height).toBeGreaterThanOrEqual(40)
    expect(remove.getBoundingClientRect().width).toBeGreaterThanOrEqual(40)
    expect(remove.getBoundingClientRect().height).toBeGreaterThanOrEqual(40)
  })
})

describe('StagedList expansion — natural height, page scrolls', () => {
  it('has NO internal scroll box (no max-h / overflow-y) on the panel or the list', async () => {
    const { container, getByRole } = await renderList({ items: rowsWithExpand() })
    await getByRole('button', { name: /expand/i }).click()
    const panel = container.querySelector('[data-staged-panel]') as HTMLElement
    expect(panel).not.toBeNull()
    expect(panel.className).not.toMatch(/max-h/)
    expect(panel.className).not.toMatch(/overflow-y/)
    // The LIST itself is not a scroll box either.
    const list = container.querySelector('[role="list"]') as HTMLElement
    expect(list.className).not.toMatch(/max-h/)
    expect(list.className).not.toMatch(/overflow-y/)
  })

  it('shows comfortable item rows with a 56px thumbnail', async () => {
    const { container, getByRole } = await renderList({
      items: rowsWithExpand({
        expand: {
          heading: 'Returned items',
          items: [{ name: 'Sky Tee', sub: 'Size: M · TEE-SKY-M', image: '/uploads/tee.jpg', quantity: 2, price: '৳600' }],
        },
      }),
    })
    await getByRole('button', { name: /expand/i }).click()
    const panel = container.querySelector('[data-staged-panel]') as HTMLElement
    const img = panel.querySelector('img[alt="Sky Tee"]') as HTMLImageElement
    expect(img).not.toBeNull()
    expect(img.getBoundingClientRect().height).toBeGreaterThanOrEqual(56)
  })
})

describe('StagedList header actions', () => {
  it('gives Clear a real button (≥36px, visible outline) — not faint gray text', async () => {
    const { container } = await renderList()
    const clear = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('Clear'),
    ) as HTMLElement
    expect(clear).not.toBeNull()
    expect(clear.getBoundingClientRect().height).toBeGreaterThanOrEqual(36)
    expect(clear.className).toMatch(/border/)
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
