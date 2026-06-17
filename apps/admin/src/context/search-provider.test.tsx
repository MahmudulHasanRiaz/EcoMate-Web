import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { SearchProvider } from '@/context/search-provider'

const COMMAND_PALETTE_PLACEHOLDER = 'Type a command or search...'

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  setTheme: vi.fn(),
  apiGet: vi.fn(),
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  }
})

vi.mock('@/context/theme-provider', () => ({
  useTheme: () => ({ setTheme: mocks.setTheme }),
}))

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mocks.apiGet },
}))

type ShortcutModifier = 'Control' | 'Meta'

async function renderWithSearchProvider() {
  return await render(<SearchProvider>{null}</SearchProvider>)
}

async function openCommandPalette(
  screen: ReturnType<typeof render>,
  modifier: ShortcutModifier = 'Control',
) {
  await vi.waitFor(
    async () => {
      const isOpen =
        document.querySelector(
          `[placeholder="${COMMAND_PALETTE_PLACEHOLDER}"]`,
        ) !== null

      if (!isOpen) {
        await userEvent.keyboard(`{${modifier}>}k{/${modifier}}`)
      }

      await expect
        .element(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER))
        .toBeInTheDocument()
    },
    { interval: 50, timeout: 5000 },
  )
}

describe('SearchProvider and CommandPalette', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('renders the command palette when opened via shortcut', async () => {
    const screen = await renderWithSearchProvider()
    await openCommandPalette(screen)
    await expect
      .element(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER))
      .toBeInTheDocument()
    await expect.element(screen.getByText('Theme')).toBeInTheDocument()
    await expect.element(screen.getByText('Tasks')).toBeInTheDocument()
  })

  it('does not show the dialog content when search is closed', async () => {
    const screen = await renderWithSearchProvider()
    await expect
      .element(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER))
      .not.toBeInTheDocument()
  })

  it.each([
    ['Ctrl', 'Control'],
    ['Cmd', 'Meta'],
  ] as const)(
    'opens the command menu when %s + K is pressed',
    async (_label, modifier) => {
      const screen = await renderWithSearchProvider()
      await expect
        .element(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER))
        .not.toBeInTheDocument()
      await openCommandPalette(screen, modifier)
      await expect
        .element(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER))
        .toBeInTheDocument()
    },
  )

  it('navigates to a top-level route on nav item select', async () => {
    const screen = await renderWithSearchProvider()
    await openCommandPalette(screen)
    await userEvent.click(screen.getByText('Tasks'))
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/op/tasks' })
    await expect
      .element(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER))
      .not.toBeInTheDocument()
  })

  it('applies theme on theme command select', async () => {
    const screen = await renderWithSearchProvider()
    await openCommandPalette(screen)
    await userEvent.click(screen.getByText('Dark'))
    expect(mocks.setTheme).toHaveBeenCalledWith('dark')
    await expect
      .element(screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER))
      .not.toBeInTheDocument()
  })

  it('calls API when user types a search query', async () => {
    mocks.apiGet.mockResolvedValue({
      data: { orders: [], products: [], customers: [] },
    })
    const screen = await renderWithSearchProvider()
    await openCommandPalette(screen)
    const input = screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER)
    await userEvent.fill(input, 'te')
    await vi.waitFor(() => {
      expect(mocks.apiGet).toHaveBeenCalledWith(
        '/admin/search',
        expect.any(Object),
      )
    })
  })

  it('shows API results in categorized sections', async () => {
    mocks.apiGet.mockResolvedValue({
      data: {
        orders: [
          {
            id: '1',
            displayId: 'ORD-1',
            total: 100,
            status: 'Pending',
            customerName: 'Test',
            phone: null,
          },
        ],
        products: [
          { id: '2', name: 'Phone', sku: 'PH-1', price: 500 },
        ],
        customers: [
          { id: '3', name: 'John', phone: '017...', email: 'j@t.com' },
        ],
      },
    })
    const screen = await renderWithSearchProvider()
    await openCommandPalette(screen)
    await userEvent.fill(
      screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER),
      'test',
    )
    await vi.waitFor(() =>
      expect(screen.getByText('#ORD-1')).toBeInTheDocument(),
    )
    await expect.element(screen.getByText('Phone')).toBeInTheDocument()
    await expect.element(screen.getByText('John')).toBeInTheDocument()
  })

  it('shows empty state when API returns nothing', async () => {
    mocks.apiGet.mockResolvedValue({
      data: { orders: [], products: [], customers: [] },
    })
    const screen = await renderWithSearchProvider()
    await openCommandPalette(screen)
    await userEvent.fill(
      screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER),
      'zzzzz',
    )
    await vi.waitFor(() =>
      expect(screen.getByText(/No results found/)).toBeInTheDocument(),
    )
  })

  it('shows error state on API failure', async () => {
    mocks.apiGet.mockRejectedValue(new Error('Network error'))
    const screen = await renderWithSearchProvider()
    await openCommandPalette(screen)
    await userEvent.fill(
      screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER),
      'test',
    )
    await vi.waitFor(() =>
      expect(screen.getByText('Search unavailable')).toBeInTheDocument(),
    )
  })

  it('does not call API for queries shorter than 2 characters', async () => {
    const screen = await renderWithSearchProvider()
    await openCommandPalette(screen)
    await userEvent.fill(
      screen.getByPlaceholder(COMMAND_PALETTE_PLACEHOLDER),
      'a',
    )
    await vi.waitFor(() => {
      expect(mocks.apiGet).not.toHaveBeenCalled()
    })
  })
})
