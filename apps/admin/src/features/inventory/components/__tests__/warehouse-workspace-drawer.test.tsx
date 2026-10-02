import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { WarehouseWorkspaceDrawer } from '../warehouse-workspace-drawer'

vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn().mockResolvedValue({ data: [] }), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// The drawer renders <Link> and route-search links; stub the router so the
// component mounts without a RouterProvider. The test only cares about hook
// ordering, not navigation.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: { children?: React.ReactNode }) => <a href="#" {...rest}>{children}</a>,
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
  useSearch: () => ({}),
}))
// Radix primitives need these contexts; the test only cares about hook order.
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  SheetFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

const WAREHOUSE = {
  id: 'wh-1',
  name: 'Main Warehouse',
  type: 'main',
  isActive: true,
  address: 'Dhaka',
  city: 'Dhaka',
  phone: '01700000000',
  email: 'wh@ecomate.com',
  _count: { binLocations: 0 },
}

/**
 * Regression guard for "Rendered more hooks than during the previous render".
 *
 * Four drawer queries sat BELOW `if (!warehouse) return null`. Rendering with no
 * warehouse ran 4 hooks; rendering again with a warehouse ran 8, and React
 * rejected the change — the drawer crashed on a cold open from the warehouse
 * list. The hook count must now stay constant across that transition.
 */
describe('WarehouseWorkspaceDrawer — hook ordering', () => {
  const errors: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    errors.length = 0
    // React reports the hook-count violation asynchronously, after the render
    // has already been attempted, so it never rejects the awaited assertions.
    // Capture it here instead.
    const onError = (e: ErrorEvent) => {
      errors.push(e.message)
      e.preventDefault()
    }
    globalThis.addEventListener?.('error', onError as EventListener)
  })

  it('survives the no-warehouse → warehouse transition', async () => {
    function Harness() {
      const [warehouse, setWarehouse] = useState<typeof WAREHOUSE | null>(null)
      return (
        <div>
          <button type='button' onClick={() => setWarehouse(WAREHOUSE)}>
            load warehouse
          </button>
          <WarehouseWorkspaceDrawer
            open={!!warehouse}
            onOpenChange={() => {}}
            warehouse={warehouse as never}
          />
        </div>
      )
    }

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { getByText } = await render(
      <QueryClientProvider client={qc}>
        <Harness />
      </QueryClientProvider>,
    )

    // First render: no warehouse ⇒ the early-return branch.
    await getByText('load warehouse')
    // Now supply one. This is the transition that used to throw.
    await getByText('load warehouse').click()
    await new Promise((r) => setTimeout(r, 500))

    const hookError =
      errors.find((e) => /more hooks than during/i.test(e)) ??
      (/more hooks than during/i.test(document.body.textContent || '')
        ? 'hook-count violation rendered into the document'
        : undefined)

    expect(
      hookError,
      `drawer must keep a constant hook count across the transition${
        hookError ? ` (React reported: ${hookError})` : ''
      }`,
    ).toBeUndefined()
  })
})