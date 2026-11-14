import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { render } from 'vitest-browser-react'
import { userEvent, page } from 'vitest/browser'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SearchIndexingCard } from './search-indexing-card'
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

const BACKEND_GUARD_MESSAGE =
  'Search indexing can only be turned on after a canonical domain is saved in Settings → General → Canonical Domain.'

function renderCard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <SearchIndexingCard />
    </QueryClientProvider>,
  )
}

function mockSettings(settings: Record<string, string>) {
  getMock.mockImplementation((url: string) => {
    if (url === '/system-settings') return Promise.resolve({ data: settings })
    return Promise.reject(new Error(`unexpected GET ${url}`))
  })
}

describe('SearchIndexingCard', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
    toastSuccess.mockReset()
    toastError.mockReset()
    mockAuthState.user.role = 'superadmin'
    postMock.mockResolvedValue({ data: { key: 'search_engine_indexing', value: 'true' } })
  })

  it('OFF + no saved domain → switch disabled with the blocking reason visible', async () => {
    mockSettings({ search_engine_indexing: 'false' })
    const { getByText, getByLabelText } = await renderCard()

    await expect.element(getByText('Not indexed', { exact: true })).toBeInTheDocument()
    await expect
      .element(getByLabelText('Allow search engines to index the store'))
      .toBeDisabled()
    await expect
      .element(
        getByText(
          'Search indexing can’t be turned on yet — save a canonical domain in the Canonical Domain card below first.',
        ),
      )
      .toBeInTheDocument()
  })

  it('OFF + saved domain → switch enabled', async () => {
    mockSettings({
      search_engine_indexing: 'false',
      canonical_domain: 'https://shop.example.com',
    })
    const { getByText, getByLabelText } = await renderCard()

    await expect.element(getByText('Not indexed', { exact: true })).toBeInTheDocument()
    await expect
      .element(getByLabelText('Allow search engines to index the store'))
      .not.toBeDisabled()
    await expect
      .element(page.getByText('Search indexing can’t be turned on yet'))
      .not.toBeInTheDocument()
  })

  it('already ON + no saved domain → switch enabled (can turn it OFF)', async () => {
    mockSettings({ search_engine_indexing: 'true' })
    const { getByText, getByLabelText } = await renderCard()

    await expect.element(getByText('Indexed', { exact: true })).toBeInTheDocument()
    await expect
      .element(getByLabelText('Allow search engines to index the store'))
      .not.toBeDisabled()
    await expect
      .element(page.getByText('Search indexing can’t be turned on yet'))
      .not.toBeInTheDocument()
  })

  it('non-superadmin, OFF + no saved domain → blocked reason mentions a superadmin', async () => {
    mockAuthState.user.role = 'admin'
    mockSettings({ search_engine_indexing: 'false' })
    const { getByText, getByLabelText } = await renderCard()

    await expect
      .element(getByLabelText('Allow search engines to index the store'))
      .toBeDisabled()
    await expect
      .element(
        getByText(
          'Search indexing can’t be turned on yet — ask a superadmin to save a canonical domain in the Canonical Domain card below.',
        ),
      )
      .toBeInTheDocument()
  })

  it('toggle ON with domain saved → posts search_engine_indexing=true and shows the success toast', async () => {
    mockSettings({
      search_engine_indexing: 'false',
      canonical_domain: 'https://shop.example.com',
    })
    const { getByLabelText } = await renderCard()

    const toggle = getByLabelText('Allow search engines to index the store')
    await expect.element(toggle).not.toBeDisabled()
    await userEvent.click(toggle)

    expect(postMock).toHaveBeenCalledWith('/system-settings/search_engine_indexing', {
      value: 'true',
    })
    expect(toastSuccess).toHaveBeenCalledWith(
      expect.stringContaining('Search indexing turned on'),
    )
  })

  it('server 400 on toggle → the server message is shown, not the generic message', async () => {
    mockSettings({
      search_engine_indexing: 'false',
      canonical_domain: 'https://shop.example.com',
    })
    postMock.mockRejectedValueOnce({
      response: { data: { message: BACKEND_GUARD_MESSAGE } },
    })
    const { getByLabelText } = await renderCard()

    const toggle = getByLabelText('Allow search engines to index the store')
    await expect.element(toggle).not.toBeDisabled()
    await userEvent.click(toggle)

    expect(postMock).toHaveBeenCalledWith('/system-settings/search_engine_indexing', {
      value: 'true',
    })
    expect(toastError).toHaveBeenCalledWith(BACKEND_GUARD_MESSAGE)
    expect(toastError).not.toHaveBeenCalledWith('Failed to save search indexing setting')
  })
})
