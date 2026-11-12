import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PurgeAllCacheButton } from '../components/purge-all-cache-button'
import type { PurgeAllResult } from '../api'

/**
 * "Purge all cache" button tests (P0 stale-bundle round, 2026-11-12):
 * superadmin-only visibility, confirmation required before any purge,
 * and per-layer result reporting — including the Cloudflare layer
 * reporting "Not configured" when the owner-held token is not set,
 * never a silent success.
 */

const mockPost = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api-client', () => ({
  apiClient: { get: vi.fn(), post: mockPost, put: vi.fn(), delete: vi.fn() },
}))

const authState = vi.hoisted(() => ({ role: 'superadmin' as string }))
vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (s: any) => unknown) =>
    selector({ auth: { user: { role: authState.role } } }),
}))

const toastError = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: toastError, warning: vi.fn() },
}))

const RESULT: PurgeAllResult = {
  purgedAt: '2026-11-12T16:00:00.000Z',
  version: '1794501000000',
  storefrontUrl: 'https://shop.example.com',
  layers: {
    backendCache: {
      status: 'purged',
      detail: 'Cleared 12 in-memory entries and deleted 34 shared-cache (Redis) keys.',
    },
    cloudflare: {
      status: 'not_configured',
      detail:
        'Cloudflare is not configured for this tenant — set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID. The Cloudflare edge cache was NOT purged.',
    },
    storefront: {
      status: 'purged',
      detail: 'Asked the storefront to revalidate the products and config caches.',
    },
    versionBump: {
      status: 'purged',
      detail: 'Cache version is now 1794501000000. Devices running the latest admin bundle will reload on their next visit.',
    },
  },
}

function renderButton() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <PurgeAllCacheButton />
    </QueryClientProvider>,
  )
}

describe('PurgeAllCacheButton', () => {
  beforeEach(() => {
    authState.role = 'superadmin'
    mockPost.mockReset()
    toastError.mockReset()
  })

  it('is hidden for non-superadmin roles', async () => {
    authState.role = 'admin'
    renderButton()
    await expect
      .element(page.getByRole('button', { name: /Purge all cache/i }))
      .not.toBeInTheDocument()
  })

  it('renders for superadmin and asks for confirmation before purging', async () => {
    renderButton()
    await expect
      .element(page.getByRole('button', { name: /Purge all cache/i }))
      .toBeInTheDocument()
    await userEvent.click(page.getByRole('button', { name: /Purge all cache/i }))
    await expect
      .element(page.getByText('Purge all cache?'))
      .toBeInTheDocument()
    // The boundary: a server button cannot clear a specific phone's cache.
    await expect
      .element(
        page.getByText(
          /cannot clear the cache on any specific phone or browser directly/i,
        ),
      )
      .toBeInTheDocument()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('does not purge when the confirmation is cancelled', async () => {
    renderButton()
    await userEvent.click(page.getByRole('button', { name: /Purge all cache/i }))
    await userEvent.click(page.getByRole('button', { name: 'Cancel' }))
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('purges on confirm and reports every layer, including Cloudflare not configured', async () => {
    mockPost.mockResolvedValueOnce({ data: RESULT })
    renderButton()
    await userEvent.click(page.getByRole('button', { name: /Purge all cache/i }))
    await userEvent.click(
      page
        .getByRole('button', { name: 'Purge all cache', exact: true })
        .last(),
    )
    expect(mockPost).toHaveBeenCalledWith(
      '/cache-purge',
      {},
      { timeout: 120_000 },
    )
    await expect.element(page.getByText('Cache purged')).toBeInTheDocument()
    await expect.element(page.getByText('Backend cache')).toBeInTheDocument()
    await expect
      .element(page.getByText('Cloudflare edge cache', { exact: true }))
      .toBeInTheDocument()
    await expect.element(page.getByText('Storefront pages')).toBeInTheDocument()
    await expect.element(page.getByText('Cache version', { exact: true })).toBeInTheDocument()
    // Per-layer statuses: purged + the honest not-configured.
    await expect.element(page.getByText('Purged').first()).toBeInTheDocument()
    await expect
      .element(page.getByText('Not configured', { exact: true }))
      .toBeInTheDocument()
    await expect
      .element(page.getByText(/CLOUDFLARE_API_TOKEN/))
      .toBeInTheDocument()
    // Reload offer, and the boundary note for still-stale devices.
    await expect
      .element(page.getByRole('button', { name: /Reload this page now/i }))
      .toBeInTheDocument()
    await expect
      .element(page.getByText(/close its admin tabs completely/i))
      .toBeInTheDocument()
  })

  it('titles the result as a problem when a layer failed', async () => {
    mockPost.mockResolvedValueOnce({
      data: {
        ...RESULT,
        layers: {
          ...RESULT.layers,
          storefront: {
            status: 'failed',
            detail: 'Storefront revalidation failed: connect ECONNREFUSED',
          },
        },
      },
    })
    renderButton()
    await userEvent.click(page.getByRole('button', { name: /Purge all cache/i }))
    await userEvent.click(
      page
        .getByRole('button', { name: 'Purge all cache', exact: true })
        .last(),
    )
    await expect
      .element(page.getByText('Cache purge finished with problems'))
      .toBeInTheDocument()
    await expect
      .element(page.getByText('Failed', { exact: true }))
      .toBeInTheDocument()
  })

  it('shows an error toast and no result when the purge request itself fails', async () => {
    mockPost.mockRejectedValueOnce(new Error('network down'))
    renderButton()
    await userEvent.click(page.getByRole('button', { name: /Purge all cache/i }))
    await userEvent.click(
      page
        .getByRole('button', { name: 'Purge all cache', exact: true })
        .last(),
    )
    // The confirm dialog closing signals the error path ran.
    await expect
      .element(page.getByText('Purge all cache?'))
      .not.toBeInTheDocument()
    await expect.element(page.getByText('Cache purged')).not.toBeInTheDocument()
    expect(toastError).toHaveBeenCalled()
  })
})
