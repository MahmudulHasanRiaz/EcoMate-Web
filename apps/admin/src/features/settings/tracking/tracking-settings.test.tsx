import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vitest/browser'
import { TrackingSettings } from '@/features/settings/tracking/tracking-settings'
import { systemSettingsApi } from '@/features/settings/storage-api'

vi.mock('@/features/settings/storage-api', () => ({
  systemSettingsApi: {
    getAll: vi.fn(),
    set: vi.fn(),
  },
}))

vi.mock('@/features/order-statuses/api', () => ({
  orderStatusApi: {
    list: vi.fn().mockResolvedValue({ data: [{ id: 's1', name: 'Confirmed' }] }),
  },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children?: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
  useLocation: () => ({ pathname: '/mon/settings/tracking' }),
}))

const BASE_SETTINGS = {
  tracking_meta_enabled: 'true',
  tracking_meta_pixel_id: '',
  tracking_meta_access_token: '',
  tracking_meta_test_code: '',
  tracking_meta_test_mode: 'false',
  tracking_meta_purchase_mode: 'instant',
  tracking_meta_validated_status: '',
  tracking_tiktok_enabled: 'false',
  tracking_tiktok_pixel_code: '',
  tracking_tiktok_access_token: '',
  tracking_tiktok_test_code: '',
  tracking_tiktok_test_mode: 'false',
  tracking_tiktok_purchase_mode: 'instant',
  tracking_tiktok_validated_status: '',
  tracking_relay_enabled: 'true',
  tracking_meta_destinations: '',
}

async function renderSettings(settings: Record<string, string> = {}) {
  vi.mocked(systemSettingsApi.getAll).mockResolvedValue({
    data: { ...BASE_SETTINGS, ...settings },
  } as any)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TrackingSettings />
    </QueryClientProvider>,
  )
}

describe('TrackingSettings provider navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders Meta, TikTok, and GA4 provider tabs with Meta selected by default', async () => {
    const screen = await renderSettings()
    await expect.element(screen.getByRole('tab', { name: /meta/i })).toBeVisible()
    await expect.element(screen.getByRole('tab', { name: /tiktok/i })).toBeVisible()
    await expect.element(screen.getByRole('tab', { name: /ga4/i })).toBeVisible()
    // Meta content visible; other providers hidden until selected.
    await expect.element(screen.getByText('Meta Destinations (Pixels)')).toBeVisible()
    await expect.element(screen.getByText('TikTok Events API', { exact: true })).not.toBeInTheDocument()
  })

  it('shows only the selected provider panel when switching tabs', async () => {
    const screen = await renderSettings()
    await expect.element(screen.getByText('Meta Destinations (Pixels)')).toBeVisible()
    await userEvent.click(screen.getByRole('tab', { name: /tiktok/i }))
    await expect.element(screen.getByText('TikTok Events API', { exact: true })).toBeVisible()
    await expect.element(screen.getByText('Meta Destinations (Pixels)')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /ga4/i }))
    await expect.element(screen.getByText(/Google Analytics 4/)).toBeVisible()
    await expect.element(screen.getByText('TikTok Events API', { exact: true })).not.toBeInTheDocument()
  })

  it('does not offer Add Destination on the TikTok tab (single connection only)', async () => {
    const screen = await renderSettings()
    await userEvent.click(screen.getByRole('tab', { name: /tiktok/i }))
    await expect.element(screen.getByText('TikTok Events API', { exact: true })).toBeVisible()
    await expect.element(screen.getByText(/single pixel connection/i)).toBeVisible()
    await expect.element(screen.getByRole('button', { name: /add destination/i })).not.toBeInTheDocument()
  })

  it('keeps provider-level Meta purchase mode without per-destination mode UI', async () => {
    const screen = await renderSettings()
    await expect.element(screen.getByText('Purchase Event Mode')).toBeVisible()
  })
})

describe('TrackingSettings legacy fallback section', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps legacy fields accessible when no destinations exist', async () => {
    const screen = await renderSettings({ tracking_meta_destinations: '' })
    await expect.element(screen.getByText('Legacy Meta Configuration')).toBeVisible()
    // Expanded by default: credential fields reachable.
    await expect.element(screen.getByLabelText('Pixel ID')).toBeVisible()
  })

  it('collapses legacy fields once a destination exists, with fallback-only notice', async () => {
    const screen = await renderSettings({
      tracking_meta_destinations: JSON.stringify([
        { id: 'primary', label: 'Main Pixel', pixelId: '111', accessToken: '', hasAccessToken: true, enabled: true },
      ]),
    })
    await expect.element(screen.getByText('Legacy Meta Configuration')).toBeVisible()
    await expect.element(screen.getByText('Fallback only')).toBeVisible()
    await expect.element(screen.getByText(/not used while meta destinations exist/i)).toBeVisible()
    // Collapsed: credential inputs hidden until expanded.
    await expect.element(screen.getByLabelText('Pixel ID')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /show/i }))
    await expect.element(screen.getByLabelText('Pixel ID')).toBeVisible()
  })
})

describe('TrackingSettings Meta destination rows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a compact row per destination and expands details on Edit', async () => {
    const screen = await renderSettings({
      tracking_meta_destinations: JSON.stringify([
        { id: 'primary', label: 'Main Pixel', pixelId: '123456789012345', accessToken: '', hasAccessToken: true, enabled: true, browserPixelEnabled: true, testMode: false },
      ]),
    })
    // Compact row shows label + pixel id without opening the full form.
    await expect.element(screen.getByText('Main Pixel')).toBeVisible()
    await expect.element(screen.getByText('123456789012345')).toBeVisible()
    // Detail fields hidden until Edit (this fixture has a stored token, so the
    // masked placeholder is the marker for the open detail form).
    await expect.element(screen.getByPlaceholder('•••••••• (stored)')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /edit destination main pixel/i }))
    await expect.element(screen.getByPlaceholder('•••••••• (stored)')).toBeVisible()
  })

  it('opens the detail form immediately for a newly added destination', async () => {
    const screen = await renderSettings({ tracking_meta_destinations: '' })
    await userEvent.click(screen.getByRole('button', { name: /add destination/i }))
    // New row has empty required fields and starts expanded.
    await expect.element(screen.getByPlaceholder('123456789012345')).toBeVisible()
  })

  it('masks the stored token (placeholder only, never a value)', async () => {
    const screen = await renderSettings({
      tracking_meta_destinations: JSON.stringify([
        { id: 'primary', label: 'Main Pixel', pixelId: '111', accessToken: '', hasAccessToken: true, enabled: true },
      ]),
    })
    await userEvent.click(screen.getByRole('button', { name: /edit destination main pixel/i }))
    const tokenInput = screen.getByPlaceholder('•••••••• (stored)')
    await expect.element(tokenInput).toBeVisible()
    await expect.element(tokenInput).toHaveValue('')
  })
})
