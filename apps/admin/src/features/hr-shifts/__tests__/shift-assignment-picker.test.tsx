import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vitest/browser'
import { useState } from 'react'
import {
  ShiftAssignmentPicker,
  DEFAULT_SHIFT_VALUE,
  type ShiftSelectionValue,
} from '../components/shift-assignment-picker'

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn((url: string) => {
      if (url === '/hr/shifts') {
        return Promise.resolve({
          data: [
            {
              id: 'preset-morning',
              name: 'Morning Shift',
              code: 'MORN',
              startTime: '08:00',
              endTime: '17:00',
              graceMinutes: 15,
              breakMinutes: 60,
              standardMinutes: 480,
              overnight: false,
              isActive: true,
              notes: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              assignments: [],
            },
            {
              id: 'preset-evening',
              name: 'Evening Shift',
              code: 'EVE',
              startTime: '14:00',
              endTime: '22:00',
              graceMinutes: 10,
              breakMinutes: 45,
              standardMinutes: 435,
              overnight: false,
              isActive: true,
              notes: null,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
              assignments: [],
            },
          ],
        })
      }
      return Promise.resolve({ data: [] })
    }),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

function TestWrapper() {
  const [val, setVal] = useState<ShiftSelectionValue>(DEFAULT_SHIFT_VALUE)
  return (
    <div>
      <div data-testid='current-mode'>{val.mode}</div>
      <div data-testid='current-preset'>{val.presetId}</div>
      <div data-testid='template-days'>{val.templateDays.join(',')}</div>
      <ShiftAssignmentPicker value={val} onChange={setVal} />
    </div>
  )
}

describe('ShiftAssignmentPicker', () => {
  it('renders and auto-selects first active preset', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { getByTestId, getByText } = await render(
      <QueryClientProvider client={qc}>
        <TestWrapper />
      </QueryClientProvider>,
    )

    await vi.waitFor(() => {
      expect(getByTestId('current-preset').element().textContent).toBe('preset-morning')
    })
    await expect.element(getByText(/Shift & Schedule Assignment/)).toBeInTheDocument()
    await expect.element(getByText('Preset Template')).toBeInTheDocument()
    await expect.element(getByText('Custom Hours')).toBeInTheDocument()
    await expect.element(getByText('Day-by-Day')).toBeInTheDocument()
  })

  it('switches between Preset, Custom, and Day-by-Day tabs', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { getByRole, getByTestId, getByText } = await render(
      <QueryClientProvider client={qc}>
        <TestWrapper />
      </QueryClientProvider>,
    )

    // Switch to Custom Hours
    await userEvent.click(getByRole('tab', { name: /Custom Hours/ }))
    await expect.element(getByTestId('current-mode')).toHaveTextContent('custom')
    await expect.element(getByText('Start Time')).toBeInTheDocument()
    await expect.element(getByText('End Time')).toBeInTheDocument()

    // Switch to Day-by-Day
    await userEvent.click(getByRole('tab', { name: /Day-by-Day/ }))
    await expect.element(getByTestId('current-mode')).toHaveTextContent('rotation')
    await expect.element(getByText('Sunday')).toBeInTheDocument()
    await expect.element(getByText('Monday')).toBeInTheDocument()
  })

  it('seeds the default preset exactly ONCE, not on every re-render', async () => {
    // The effect previously listed `activePresets` (a fresh array each render)
    // and depended on `value`, so it fired on every keystroke and called
    // onChange repeatedly — which marked the edit dialog dirty on open and made
    // Save quick-assign a shift nobody picked.
    const changes: ShiftSelectionValue[] = []

    function CountingWrapper() {
      const [val, setVal] = useState<ShiftSelectionValue>(DEFAULT_SHIFT_VALUE)
      return (
        <div>
          <div data-testid='current-preset'>{val.presetId}</div>
          <div data-testid='change-count'>{changes.length}</div>
          <ShiftAssignmentPicker
            value={val}
            onChange={(v) => {
              changes.push(v)
              setVal(v)
            }}
          />
        </div>
      )
    }

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { getByTestId } = await render(
      <QueryClientProvider client={qc}>
        <CountingWrapper />
      </QueryClientProvider>,
    )

    await vi.waitFor(() => {
      expect(getByTestId('current-preset').element().textContent).toBe('preset-morning')
    })
    // Let any lingering effect run.
    await new Promise((r) => setTimeout(r, 300))
    expect(getByTestId('change-count').element().textContent).toBe('1')
  })
})
