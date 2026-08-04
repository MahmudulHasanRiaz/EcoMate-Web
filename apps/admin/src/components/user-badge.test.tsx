import { type ReactElement } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { UserBadge } from './user-badge'
import { usersApi, type UserResponse } from '@/features/users/api'

vi.mock('@/features/users/api', () => ({
  usersApi: {
    get: vi.fn(),
    findByEmail: vi.fn(),
  },
}))

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

function wrap(ui: ReactElement) {
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const MOCK_USER: UserResponse = {
  id: '11111111-2222-4333-8444-555555555555',
  firstName: 'Riaz',
  lastName: 'Ahmed',
  username: 'riaz',
  email: 'riaz@ecomate.app',
  phoneNumber: '+8801700000000',
  status: 'active',
  role: 'admin',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-02T00:00:00.000Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  queryClient.clear()
})

describe('UserBadge', () => {
  it('renders a plain email (not an ID) by looking it up via findByEmail', async () => {
    vi.mocked(usersApi.findByEmail).mockResolvedValueOnce({
      data: MOCK_USER,
    } as any)

    const { getByText } = await wrap(
      <UserBadge email='riaz@ecomate.app' showEmail={false} />,
    )

    await expect
      .element(getByText('Riaz Ahmed'))
      .toBeInTheDocument()
    expect(usersApi.findByEmail).toHaveBeenCalledWith('riaz@ecomate.app')
    expect(usersApi.get).not.toHaveBeenCalled()
  })

  it('treats a UUID value as a user id and resolves the name via usersApi.get', async () => {
    vi.mocked(usersApi.get).mockResolvedValueOnce({ data: MOCK_USER } as any)

    const { getByText } = await wrap(
      <UserBadge email={MOCK_USER.id} showEmail={false} />,
    )

    await expect
      .element(getByText('Riaz Ahmed'))
      .toBeInTheDocument()
    expect(usersApi.get).toHaveBeenCalledWith(MOCK_USER.id)
    expect(usersApi.findByEmail).not.toHaveBeenCalled()
  })

  it('does not render the raw UUID when the user cannot be resolved', async () => {
    vi.mocked(usersApi.get).mockRejectedValueOnce(new Error('404'))

    const { getByText, getByRole } = await wrap(
      <UserBadge email={MOCK_USER.id} showEmail={false} />,
    )

    await expect
      .element(getByRole('button'))
      .toBeInTheDocument()
    const text = getByText('User')
    await expect.element(text).toBeInTheDocument()
    // The raw UUID must never appear in the UI.
    await expect.element(getByText(MOCK_USER.id)).not.toBeInTheDocument()
  })
})