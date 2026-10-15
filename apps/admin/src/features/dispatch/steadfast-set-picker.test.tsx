import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SteadfastSetPicker } from './steadfast-set-picker'

const mockGet = vi.hoisted(() => vi.fn())

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: mockGet, post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}))

function renderPicker(onChange = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <SteadfastSetPicker value='' onChange={onChange} />
    </QueryClientProvider>,
  )
}

// Task 8: order-level picker shows ONLY when >1 set is configured (labels
// shown, keys NEVER shown); hidden for a single set (zero friction).
describe('SteadfastSetPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('hides the picker when a single set is configured', async () => {
    mockGet.mockResolvedValue({
      data: [{ id: 'a', label: 'Main Shop', isDefault: true, hasApiKey: true }],
    })
    await renderPicker()
    await vi.waitFor(() => {
      expect(mockGet).toHaveBeenCalled()
    })
    // Let the query settle, then assert nothing rendered.
    await new Promise((r) => setTimeout(r, 200))
    expect(document.body.textContent || '').not.toMatch(/Main Shop/)
    expect(document.querySelector('select')).toBeNull()
  })

  it('shows labels (never keys) when multiple sets exist', async () => {
    mockGet.mockResolvedValue({
      data: [
        { id: 'a', label: 'Dhaka Shop', isDefault: true, hasApiKey: true },
        { id: 'b', label: 'CTG Shop', isDefault: false, hasApiKey: true },
      ],
    })
    const ui = await renderPicker()
    await userEvent.click(ui.getByText('Default account'))
    await expect.element(ui.getByText('Dhaka Shop (default)')).toBeInTheDocument()
    await expect.element(ui.getByText('CTG Shop')).toBeInTheDocument()
    const body = document.body.innerHTML
    expect(body).not.toContain('live-key')
    expect(body).not.toContain('Api-Key')
  })
})
