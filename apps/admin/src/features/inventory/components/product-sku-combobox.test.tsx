import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ProductSkuCombobox, type LookupRow } from './product-sku-combobox'

const mockGet = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

// The camera lifecycle lives in the packing feature's hardened helper. Stub it
// so these tests exercise this component's scan HANDLING (decode → exact SKU
// match → select) without a real camera stream.
const mockScannerStart = vi.hoisted(() => vi.fn())
vi.mock('@/features/packing/scanner-controller', () => ({
  createScanner: (
    _elementId: string,
    _config: unknown,
    callbacks: { onScan: (text: string) => void; onError?: (err: unknown) => void },
  ) => {
    ;(globalThis as any).__emitScan = callbacks.onScan
    return {
      start: mockScannerStart,
      stop: vi.fn().mockResolvedValue(undefined),
      dispose: vi.fn().mockResolvedValue(undefined),
      getState: () => 'idle',
    }
  },
  pickDefaultCamera: (devices: Array<{ id: string }>) => devices[0]?.id ?? '',
}))

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: Object.assign(function Html5QrcodeStub() {}, {
    getCameras: vi.fn().mockResolvedValue([{ id: 'cam-1', label: 'Back Camera' }]),
  }),
}))

/** Variant-level rows exactly as GET /inventory/product-lookup returns them. */
const shirtSmall: LookupRow = {
  productId: 'prod-shirt',
  productName: 'Cotton Shirt',
  variantId: 'var-shirt-s',
  variantName: 'S / Cotton',
  sku: 'SHIRT-S',
  type: 'variant',
  available: 10,
}
const shirtMedium: LookupRow = {
  productId: 'prod-shirt',
  productName: 'Cotton Shirt',
  variantId: 'var-shirt-m',
  variantName: 'M',
  sku: 'SHIRT-M',
  type: 'variant',
  available: 4,
}
const mug: LookupRow = {
  productId: 'prod-mug',
  productName: 'Clay Mug',
  variantId: null,
  variantName: null,
  sku: 'MUG-001',
  type: 'product',
  available: 35,
}

const LOOKUP_URL = '/inventory/product-lookup'

function mockLookup(rows: LookupRow[] = [shirtSmall, shirtMedium, mug]) {
  mockGet.mockImplementation((url: string) => {
    if (url === LOOKUP_URL) {
      return Promise.resolve({ data: { data: rows, meta: { total: rows.length, perPage: 25 } } })
    }
    return Promise.reject(new Error(`Unexpected URL ${url}`))
  })
}

const lookupTerms = () =>
  mockGet.mock.calls.filter(([url]: [string]) => url === LOOKUP_URL).map(([, cfg]: [string, any]) => cfg?.params?.q)

const INPUT_PLACEHOLDER = 'Type name or SKU...'

type Screen = Awaited<ReturnType<typeof renderCombobox>>

/** The selectable lookup rows (role="option"), in render order. */
const optionRows = (screen: Screen) => screen.getByRole('option').elements()

async function renderCombobox(props: Partial<React.ComponentProps<typeof ProductSkuCombobox>> = {}) {
  const onSelect = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = await render(
    <QueryClientProvider client={client}>
      <ProductSkuCombobox selected={null} onSelect={onSelect} {...props} />
    </QueryClientProvider>,
  )
  return { ...view, onSelect }
}

/** cmdk only mounts list items once the popover is open, so open it first. */
async function openPicker(props?: Partial<React.ComponentProps<typeof ProductSkuCombobox>>) {
  const screen = await renderCombobox(props)
  await userEvent.click(screen.getByRole('combobox', { name: 'Product' }))
  return screen
}

const inputOf = (screen: Awaited<ReturnType<typeof openPicker>>) =>
  screen.getByPlaceholder(INPUT_PLACEHOLDER).element() as HTMLInputElement

/**
 * Type `text` into the combobox input the way a person does, with no artificial
 * delay so the whole burst lands well inside the 300 ms debounce window.
 */
async function type(screen: Awaited<ReturnType<typeof openPicker>>, text: string) {
  const input = inputOf(screen)
  await userEvent.click(input)
  await userEvent.fill(input, '')
  await userEvent.type(input, text, { delay: 0 })
}

/**
 * A hardware scanner emits the code as ordinary keydowns on whatever has focus
 * and then presses Enter. Dispatched on <body>, which is what "nothing in the
 * picker is focused" looks like: the events reach window (where the component
 * listens) but no text field claims them.
 */
function pressWedge(code: string) {
  for (const key of code) {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  }
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
}

describe('ProductSkuCombobox', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete (globalThis as any).__emitScan
    mockScannerStart.mockResolvedValue(undefined)
    mockLookup()
  })

  it('debounces the lookup — a whole typed word fires ONE request, not four', async () => {
    const screen = await openPicker()
    await type(screen, 'sock')

    await vi.waitFor(() => expect(lookupTerms()).toContain('sock'), { timeout: 2000 })
    // Nothing fired per keystroke, and the final term fired exactly once.
    expect(lookupTerms()).not.toContain('s')
    expect(lookupTerms()).not.toContain('so')
    expect(lookupTerms().filter((t: string) => t === 'sock')).toHaveLength(1)
  })

  it('keeps filtering server-side (shouldFilter={false}) so returned rows survive the query text', async () => {
    // The regression that made the transfers picker permanently read
    // "No product found.": cmdk re-filtered the server's list against a UUID
    // `value`, so a search that the server had already answered correctly was
    // thrown away client-side.
    const screen = await openPicker()
    await type(screen, 'sock')

    await vi.waitFor(() => expect(screen.getByText('SHIRT-S').elements()).toHaveLength(1), {
      timeout: 2000,
    })
    // Every returned row is rendered, including the ones whose text does not
    // contain "sock" — proof the client is not re-filtering.
    await expect.element(screen.getByText('SHIRT-M')).toBeInTheDocument()
    await expect.element(screen.getByText('MUG-001')).toBeInTheDocument()
  })

  it('renders one selectable row per variant with product, variant and SKU', async () => {
    mockLookup([shirtSmall, shirtMedium])
    const screen = await openPicker()
    await type(screen, 'shirt')

    await vi.waitFor(() => expect(optionRows(screen)).toHaveLength(2), { timeout: 2000 })
    await expect.element(screen.getByText('Cotton Shirt', { exact: false }).first()).toBeInTheDocument()
    await expect.element(screen.getByText('S / Cotton', { exact: false })).toBeInTheDocument()
    await expect.element(screen.getByText('SHIRT-S')).toBeInTheDocument()
    await expect.element(screen.getByText('SHIRT-M')).toBeInTheDocument()
  })

  it('never offers a variable product parent as selectable', async () => {
    mockLookup([shirtSmall, shirtMedium])
    const screen = await openPicker()
    await type(screen, 'SHIRT')

    await vi.waitFor(() => expect(optionRows(screen)).toHaveLength(2), { timeout: 2000 })

    // Two variants of ONE variable product, each its own selectable stock unit.
    // There is no row for the parent itself — no row with an empty
    // data-variant-id — which is exactly the row that silently moved
    // product-level stock before.
    expect(optionRows(screen).map((el) => el.getAttribute('data-variant-id'))).toEqual([
      'var-shirt-s',
      'var-shirt-m',
    ])
    expect(optionRows(screen).some((el) => !el.getAttribute('data-variant-id'))).toBe(false)

    // The group heading is a real group label, never a selectable item, so a
    // variable product cannot be chosen at parent level by keyboard either.
    expect(
      Array.from(document.querySelectorAll('[cmdk-group-heading]')).map((h) => h.textContent),
    ).toContain('Products and variants')
  })

  it('selects a simple product as a variantId-null row', async () => {
    mockLookup([mug])
    const screen = await openPicker()
    await type(screen, 'MUG')

    await vi.waitFor(() => expect(optionRows(screen)).toHaveLength(1), { timeout: 2000 })
    await userEvent.click(screen.getByRole('option', { name: /Clay Mug/ }))
    expect(screen.onSelect).toHaveBeenCalledWith(mug)
  })

  it('selects the camera-scanned row whose SKU matches the decoded text exactly', async () => {
    const screen = await openPicker()
    // Scan against a POPULATED list: the code must match a row the operator can
    // see, not a SKU that only ever existed in another search.
    await type(screen, 'shirt')
    await vi.waitFor(() => expect(optionRows(screen)).toHaveLength(3), { timeout: 2000 })
    await userEvent.click(screen.getByRole('button', { name: 'Scan barcode' }))

    await vi.waitFor(() => expect((globalThis as any).__emitScan).toBeTypeOf('function'))
    ;(globalThis as any).__emitScan('SHIRT-M')

    expect(screen.onSelect).toHaveBeenCalledWith(shirtMedium)
  })

  it('ignores a partial or wrong-case scan code instead of picking the wrong row', async () => {
    const screen = await openPicker()
    await userEvent.click(screen.getByRole('button', { name: 'Scan barcode' }))
    await vi.waitFor(() => expect((globalThis as any).__emitScan).toBeTypeOf('function'))

    ;(globalThis as any).__emitScan('SHIRT') // a parent code with no own row
    ;(globalThis as any).__emitScan('shirt-m') // case mismatch
    expect(screen.onSelect).not.toHaveBeenCalled()
  })

  it('re-runs the lookup for a scanned code that is not in the current rows', async () => {
    mockLookup([mug])
    const screen = await openPicker()
    await userEvent.click(screen.getByRole('button', { name: 'Scan barcode' }))
    await vi.waitFor(() => expect((globalThis as any).__emitScan).toBeTypeOf('function'))

    ;(globalThis as any).__emitScan('SHIRT-M')
    // Nothing matched, so the decoded code becomes the search term.
    await vi.waitFor(() => expect(lookupTerms()).toContain('SHIRT-M'), { timeout: 2000 })
    expect(screen.onSelect).not.toHaveBeenCalled()
  })

  it('picks up a USB/keyboard-wedge scan once a product is selected', async () => {
    mockLookup([mug])
    const screen = await openPicker({ selected: mug })
    await type(screen, 'MUG')
    // Wait for the row itself, not for the request: the request firing does not
    // mean the list has rendered.
    await vi.waitFor(
      () => expect(document.querySelectorAll('[data-sku="MUG-001"]').length).toBe(1),
      { timeout: 2000 },
    )

    // Searching leaves focus in the input, and a focused text field owns every
    // keystroke — so the wedge is (correctly) ignored. Dismiss the popover first,
    // the way an operator does once the right product is on screen.
    await userEvent.keyboard('{Escape}')
    await vi.waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Product' }).element().getAttribute('aria-expanded')).toBe('false'),
    )

    pressWedge('MUG-001')

    await vi.waitFor(() => expect(screen.onSelect).toHaveBeenCalledWith(mug))
  })

  it('ignores a wedge scan while the search input has focus', async () => {
    mockLookup([mug])
    const screen = await openPicker({ selected: mug })
    const input = inputOf(screen)
    await userEvent.click(input)
    await userEvent.keyboard('MUG-001{Enter}')

    expect(screen.onSelect).not.toHaveBeenCalled()
  })

  it('shows an empty state when nothing matches', async () => {
    mockLookup([])
    const screen = await openPicker()
    await type(screen, 'zzzz')
    await expect.element(screen.getByText('No products found.')).toBeInTheDocument()
  })

  it('surfaces the server message when the lookup fails', async () => {
    mockGet.mockImplementation((url: string) =>
      url === LOOKUP_URL
        ? Promise.reject({ response: { data: { message: 'Insufficient permissions' } } })
        : Promise.reject(new Error(`Unexpected URL ${url}`)),
    )
    const screen = await openPicker()
    await type(screen, 'boom')

    await expect
      .element(screen.getByText('Insufficient permissions', { exact: false }))
      .toBeInTheDocument()
  })
})