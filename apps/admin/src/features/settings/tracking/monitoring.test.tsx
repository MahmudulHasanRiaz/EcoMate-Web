import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { userEvent } from 'vitest/browser'
import { TrackingMonitoring } from '@/features/settings/tracking/monitoring'
import { monitoringApi } from '@/features/settings/tracking/monitoring-api'

vi.mock('@/features/settings/tracking/monitoring-api', () => ({
  monitoringApi: {
    overview: vi.fn(),
    failures: vi.fn(),
    freshness: vi.fn(),
    dedup: vi.fn(),
    timeline: vi.fn(),
  },
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children?: React.ReactNode; className?: string }) => (
    <a href={to} className={className}>{children}</a>
  ),
  useLocation: () => ({ pathname: '/mon/settings/tracking/monitoring' }),
}))

const MOCK_OVERVIEW = {
  volumeByEventType: [
    { eventType: 'Purchase', count: 42 },
    { eventType: 'AddToCart', count: 17 },
  ],
  dispatchFunnel: {
    meta: { pending: 1, sending: 0, sent: 30, retry: 2, failed: 1, dead: 0, skipped: 0, deduped: 5 },
    tiktok: { pending: 0, sending: 0, sent: 20, retry: 0, failed: 0, dead: 0, skipped: 0, deduped: 0 },
  },
  deadStats: { deadCount: 3, dlqDepth: 2 },
}

const MOCK_FAILURES = {
  topFailures: [{ errorMsg: 'timeout contacting meta', count: 7 }],
  retryHistogram: [
    { attemptCount: 1, count: 3 },
    { attemptCount: 2, count: 1 },
  ],
}

const MOCK_FRESHNESS = { avgCaptureToDispatchSec: 1.5, p95CaptureToDispatchSec: 4.2 }

const MOCK_DEDUP = {
  keyUsage: [
    { key: 'event_id', events: 40 },
    { key: 'external_id', events: 10 },
    { key: 'fbp', events: 5 },
    { key: 'fbc', events: 2 },
  ],
}

const MOCK_TIMELINE = {
  eventType: 'InitiateCheckout',
  status: 'SENT',
  events: [
    {
      id: 'e1',
      snapshotId: 's1',
      eventId: 'evt-123',
      orderId: 'o1',
      ctxId: null,
      provider: 'meta',
      queueJobId: 'q1',
      fromStatus: 'PENDING',
      toStatus: 'SENT',
      attempt: 1,
      message: null,
      createdAt: '2026-08-02T10:00:00.000Z',
    },
    {
      id: 'e2',
      snapshotId: 's1',
      eventId: 'evt-123',
      orderId: 'o1',
      ctxId: null,
      provider: 'meta',
      queueJobId: 'q1',
      fromStatus: 'SENDING',
      toStatus: 'RETRY',
      attempt: 2,
      message: 'timeout',
      createdAt: '2026-08-02T10:00:05.000Z',
    },
  ],
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TrackingMonitoring />
    </QueryClientProvider>
  )
}

describe('TrackingMonitoring page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(monitoringApi.overview).mockResolvedValue(MOCK_OVERVIEW as any)
    vi.mocked(monitoringApi.failures).mockResolvedValue(MOCK_FAILURES as any)
    vi.mocked(monitoringApi.freshness).mockResolvedValue(MOCK_FRESHNESS as any)
    vi.mocked(monitoringApi.dedup).mockResolvedValue(MOCK_DEDUP as any)
    vi.mocked(monitoringApi.timeline).mockResolvedValue(MOCK_TIMELINE as any)
  })

  it('renders the page heading and KPI section headings', async () => {
    const screen = await renderPage()

    await expect.element(screen.getByRole('heading', { name: 'Tracking Monitoring' })).toBeInTheDocument()
    await expect.element(screen.getByText('Volume by Event Type')).toBeInTheDocument()
    await expect.element(screen.getByText('Dispatch Funnel')).toBeInTheDocument()
    await expect.element(screen.getByText('Top Failures')).toBeInTheDocument()
    await expect.element(screen.getByText('Retry Histogram')).toBeInTheDocument()
    await expect.element(screen.getByText('Freshness')).toBeInTheDocument()
    await expect.element(screen.getByText('Dedup Keys')).toBeInTheDocument()
    await expect.element(screen.getByText('Event Timeline')).toBeInTheDocument()
  })

  it('renders volume by event type with counts', async () => {
    const screen = await renderPage()

    await expect.element(screen.getByText('Purchase')).toBeInTheDocument()
    await expect.element(screen.getByText('42', { exact: true })).toBeInTheDocument()
    await expect.element(screen.getByText('AddToCart')).toBeInTheDocument()
    await expect.element(screen.getByText('17', { exact: true })).toBeInTheDocument()
  })

  it('renders per-provider dispatch funnel rows and DEAD/DLQ stats', async () => {
    const screen = await renderPage()

    await expect.element(screen.getByRole('cell', { name: 'meta' })).toBeInTheDocument()
    await expect.element(screen.getByRole('cell', { name: 'tiktok' })).toBeInTheDocument()
    await expect.element(screen.getByText('Dead', { exact: true })).toBeInTheDocument()
    await expect.element(screen.getByText('Skipped', { exact: true })).toBeInTheDocument()
    await expect.element(screen.getByText('Deduped', { exact: true })).toBeInTheDocument()
    // DEAD count + DLQ depth
    await expect.element(screen.getByText('DEAD events')).toBeInTheDocument()
    await expect.element(screen.getByText('DLQ depth')).toBeInTheDocument()
  })

  it('renders top failures and the retry histogram', async () => {
    const screen = await renderPage()

    await expect.element(screen.getByText('timeout contacting meta')).toBeInTheDocument()
    await expect.element(screen.getByText('7', { exact: true })).toBeInTheDocument()
    await expect.element(screen.getByText('2 attempts · 1 event')).toBeInTheDocument()
  })

  it('renders freshness avg + p95', async () => {
    const screen = await renderPage()

    await expect.element(screen.getByText('Average')).toBeInTheDocument()
    await expect.element(screen.getByText('P95')).toBeInTheDocument()
    await expect.element(screen.getByText('1.5s')).toBeInTheDocument()
    await expect.element(screen.getByText('4.2s')).toBeInTheDocument()
  })

  it('renders dedup key usage counts', async () => {
    const screen = await renderPage()

    await expect.element(screen.getByText('event_id')).toBeInTheDocument()
    await expect.element(screen.getByText('external_id')).toBeInTheDocument()
    await expect.element(screen.getByText('fbp')).toBeInTheDocument()
    await expect.element(screen.getByText('fbc')).toBeInTheDocument()
  })

  it('searches an eventId and renders the timeline rows', async () => {
    const screen = await renderPage()

    const input = screen.getByPlaceholder(/event id/i)
    await userEvent.fill(input, 'evt-123')
    await userEvent.click(screen.getByRole('button', { name: /search/i }))

    await vi.waitFor(() => expect(monitoringApi.timeline).toHaveBeenCalledWith('evt-123'))
    await expect.element(screen.getByText('evt-123')).toBeInTheDocument()
    await expect.element(screen.getByText('InitiateCheckout')).toBeInTheDocument()
    await expect.element(screen.getByRole('cell', { name: 'SENT', exact: true })).toBeInTheDocument()
    await expect.element(screen.getByRole('cell', { name: 'RETRY', exact: true })).toBeInTheDocument()
  })
})
