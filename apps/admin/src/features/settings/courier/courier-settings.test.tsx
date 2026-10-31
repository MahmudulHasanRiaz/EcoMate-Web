import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CourierSettings } from './courier-settings'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/stores/license-store', () => ({
  useLicenseStore: (sel: (s: { hasFeature: (key: string) => boolean }) => unknown) =>
    sel({ hasFeature: () => true }),
}))

// The sets manager runs its own CRUD queries; the parent label only needs the
// list query (mocked through apiClient).
vi.mock('@/features/settings/courier/steadfast-sets-manager', () => ({
  SteadfastSetsManager: () => null,
}))

const getMock = vi.mocked(apiClient.get)
const putMock = vi.mocked(apiClient.put)
const patchMock = vi.mocked(apiClient.patch)

type CourierRow = Record<string, unknown>

const credentialRow = (courier: string, overrides: CourierRow = {}): CourierRow => ({
  courier,
  enabled: false,
  mode: 'sandbox',
  apiKey: '',
  secretKey: '',
  username: '',
  password: '',
  clientId: '',
  clientSecret: '',
  clientContext: '',
  storeId: '',
  shopId: '',
  webhookSecret: '',
  pathaoIntegrationSecret: '',
  credentials: {},
  ...overrides,
})

function mockGets(creds: CourierRow[]) {
  getMock.mockImplementation(async (url: string) => {
    if (url === '/couriers/credentials') return { data: creds } as never
    if (url === '/couriers/credentials/steadfast/reveal') {
      return { data: { courier: 'steadfast', values: { apiKey: 'saved-key-123', secretKey: 'saved-secret-456' } } } as never
    }
    if (url === '/couriers/default-note') return { data: { note: '' } } as never
    if (url === '/couriers/webhook-status') {
      return {
        data: {
          steadfast: { configured: true },
          pathao: { configured: true },
          redx: { configured: true },
          carrybee: { configured: true },
        },
      } as never
    }
    if (url === '/couriers/credential-sets') return { data: [] } as never
    throw new Error(`unexpected GET ${url}`)
  })
}

function renderSettings() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <CourierSettings />
    </QueryClientProvider>,
  )
}

describe('CourierSettings — D1 enable toggle persists on its own', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('persists the enable toggle immediately with a dedicated payload (no Save Credentials click)', async () => {
    mockGets([credentialRow('steadfast', { apiKey: 'test-key', secretKey: 'test-secret' })])
    patchMock.mockResolvedValue({ data: { courier: 'steadfast', enabled: true } } as never)
    const screen = await renderSettings()

    const toggle = screen.getByRole('switch', { name: 'Steadfast courier enabled' })
    await expect.element(toggle).not.toBeChecked()
    await userEvent.click(toggle)

    await vi.waitFor(() => {
      expect(patchMock).toHaveBeenCalledWith('/couriers/credentials/steadfast/enabled', { enabled: true })
    })
    await expect.element(toggle).toBeChecked()
    // The credential form is untouched: no PUT / Save Credentials was involved.
    expect(putMock).not.toHaveBeenCalled()
  })

  it('updates optimistically but disables the switch while the write is in flight', async () => {
    mockGets([credentialRow('steadfast', { apiKey: 'test-key', secretKey: 'test-secret' })])
    let resolvePatch: (value: unknown) => void = () => {}
    patchMock.mockImplementation(() => new Promise((resolve) => { resolvePatch = resolve }) as never)
    const screen = await renderSettings()

    const toggle = screen.getByRole('switch', { name: 'Steadfast courier enabled' })
    await userEvent.click(toggle)

    await expect.element(toggle).toBeChecked()
    await expect.element(toggle).toBeDisabled()
    expect(toast.success).not.toHaveBeenCalled()

    resolvePatch({ data: { courier: 'steadfast', enabled: true } })
    await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Steadfast enabled'))
  })

  it('rolls back the optimistic state and reports the error when the write fails', async () => {
    mockGets([credentialRow('steadfast', { apiKey: 'test-key', secretKey: 'test-secret' })])
    patchMock.mockRejectedValue(new Error('Network Error'))
    const screen = await renderSettings()

    const toggle = screen.getByRole('switch', { name: 'Steadfast courier enabled' })
    await userEvent.click(toggle)

    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledWith('Network Error'))
    await expect.element(toggle).not.toBeChecked()
    await expect.element(toggle).not.toBeDisabled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('warns instead of claiming a usable courier when enabled without credentials', async () => {
    mockGets([
      credentialRow('pathao', { enabled: false }),
    ])
    patchMock.mockResolvedValue({ data: { courier: 'pathao', enabled: true } } as never)
    const screen = await renderSettings()

    const toggle = screen.getByRole('switch', { name: 'Pathao courier enabled' })
    await userEvent.click(toggle)

    await vi.waitFor(() => {
      expect(patchMock).toHaveBeenCalledWith('/couriers/credentials/pathao/enabled', { enabled: true })
      expect(toast.warning).toHaveBeenCalledWith(
        'Pathao enabled — credentials missing (Client ID, Client Secret, Username, Password). Dispatch will fail until they are added.',
      )
    })
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('CourierSettings — D2 truthful connection label', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows all three distinct label states, never "Connected" for empty credentials', async () => {
    mockGets([
      credentialRow('steadfast', { apiKey: 'test-key', secretKey: 'test-secret' }),
      credentialRow('pathao', { enabled: true }),
      credentialRow('redx', { enabled: true, apiKey: 'test-key' }),
    ])
    const screen = await renderSettings()

    await expect.element(screen.getByText('Disabled')).toBeInTheDocument()
    await expect.element(screen.getByText('Enabled — credentials missing')).toBeInTheDocument()
    await expect.element(screen.getByText('Connected')).toBeInTheDocument()
    // Exactly one card truly counts as connected.
    expect(screen.getByText('Connected').elements()).toHaveLength(1)
  })

  it('treats whitespace-only credentials as missing', async () => {
    mockGets([
      credentialRow('steadfast', { enabled: true, apiKey: '   ', secretKey: 'test-secret' }),
    ])
    const screen = await renderSettings()

    await expect.element(screen.getByText('Enabled — credentials missing')).toBeInTheDocument()
  })
})

describe('CourierSettings — credential eye reveal (2026-10-31)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('eye toggle fetches the saved value once and displays it as selectable text; form state stays blank so Save still sends blank (= keep)', async () => {
    mockGets([
      credentialRow('steadfast', { fieldsPresent: ['apiKey', 'secretKey'] }),
    ])
    putMock.mockResolvedValue({ data: {} } as never)
    const screen = await renderSettings()

    const eye = screen.getByRole('button', { name: 'Show saved API Key' })
    await expect.element(eye).toBeInTheDocument()
    await userEvent.click(eye)

    await vi.waitFor(() => {
      expect(getMock).toHaveBeenCalledWith('/couriers/credentials/steadfast/reveal')
    })
    // The revealed value is rendered in the field (selectable text).
    await vi.waitFor(() => {
      const inputs = Array.from(document.querySelectorAll('input'))
      expect(inputs.some((i) => (i as HTMLInputElement).value === 'saved-key-123')).toBe(true)
    })
    // No copy buttons were added for credential fields.
    expect(screen.getByRole('button', { name: /copy/i }).elements()).toHaveLength(0)

    // Saving without typing must still send blank for the field (backend
    // blank = keep): revealing must not write the value into form state.
    await userEvent.click(screen.getByRole('button', { name: /Save Credentials/i }))
    await vi.waitFor(() => expect(putMock).toHaveBeenCalled())
    const payload = putMock.mock.calls[0][1] as Record<string, unknown>
    expect(payload.apiKey).toBe('')
    expect(payload.secretKey).toBe('')
  })
})
