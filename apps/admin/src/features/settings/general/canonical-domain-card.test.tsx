import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent, page } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CanonicalDomainCard } from './canonical-domain-card'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'

vi.mock('@/lib/api-client', () => ({
  apiClient: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const mockAuthState = vi.hoisted(() => ({
  user: {
    id: 'u1',
    email: 'su@test.com',
    role: 'superadmin',
    permissions: [] as string[],
  },
}))

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: Object.assign(
    (selector: (s: any) => unknown) =>
      selector({
        auth: {
          accessToken: 'tok',
          user: mockAuthState.user,
          setUser: () => {},
          reset: () => {},
        },
      }),
    { getState: () => ({ auth: { user: mockAuthState.user } }) },
  ),
}))

const getMock = apiClient.get as Mock
const postMock = apiClient.post as Mock
const toastSuccess = toast.success as Mock
const toastError = toast.error as Mock

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <CanonicalDomainCard />
    </QueryClientProvider>,
  )
}

function mockSettings(saved: string, effective?: string) {
  getMock.mockImplementation((url: string) => {
    if (url === '/system-settings')
      return Promise.resolve({ data: saved ? { canonical_domain: saved } : {} })
    if (url === '/system-settings/storefront')
      return Promise.resolve({ data: effective ? { canonicalDomain: effective } : {} })
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

describe('CanonicalDomainCard', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
    toastSuccess.mockReset()
    toastError.mockReset()
    mockAuthState.user.role = 'superadmin'
    postMock.mockResolvedValue({ data: { key: 'canonical_domain', value: '' } })
  })

  it('superadmin sees the saved value and the effective domain', async () => {
    mockSettings('https://shop.example.com', 'https://shop.example.com')
    const { getByText, getByLabelText } = await renderCard()

    await expect.element(getByText('Canonical Domain', { exact: true })).toBeInTheDocument()
    await expect.element(getByText('Saved', { exact: true })).toBeInTheDocument()
    await expect
      .element(getByLabelText('Canonical domain URL'))
      .toHaveValue('https://shop.example.com')
    await expect
      .element(getByText('In effect: https://shop.example.com (saved).'))
      .toBeInTheDocument()
  })

  it('unset saved value shows the detected deployment domain', async () => {
    mockSettings('', 'https://demo.ecomate.bd')
    const { getByText } = await renderCard()

    await expect.element(getByText('Not set')).toBeInTheDocument()
    await expect
      .element(
        getByText(
          'In effect: https://demo.ecomate.bd (detected from the deployment — save a value to pin it).',
        ),
      )
      .toBeInTheDocument()
  })

  it('saves a typed domain and shows the success toast', async () => {
    mockSettings('', 'https://demo.ecomate.bd')
    const { getByText, getByLabelText } = await renderCard()

    await expect.element(getByText('Not set')).toBeInTheDocument()
    await userEvent.fill(getByLabelText('Canonical domain URL'), 'https://shop.example.com')
    await userEvent.click(getByText('Save', { exact: true }))

    expect(postMock).toHaveBeenCalledWith('/system-settings/canonical_domain', {
      value: 'https://shop.example.com',
    })
    expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining('Canonical domain saved'),
    )
  })

  it('surfaces the backend 400 message when the value is invalid', async () => {
    mockSettings('', 'https://demo.ecomate.bd')
    postMock.mockRejectedValueOnce({
      response: {
        data: { message: 'canonical_domain must use https:// (got http://shop.example.com)' },
      },
    })
    const { getByText, getByLabelText } = await renderCard()

    await expect.element(getByText('Not set')).toBeInTheDocument()
    await userEvent.fill(getByLabelText('Canonical domain URL'), 'http://shop.example.com')
    await userEvent.click(getByText('Save', { exact: true }))

    expect(toastError).toHaveBeenCalledWith(
      'canonical_domain must use https:// (got http://shop.example.com)',
    )
  })

  it('non-superadmin never sees the card', async () => {
    mockAuthState.user.role = 'admin'
    mockSettings('https://shop.example.com', 'https://shop.example.com')
    await renderCard()

    await expect
      .element(page.getByText('Canonical Domain', { exact: true }))
      .not.toBeInTheDocument()
  })
})
