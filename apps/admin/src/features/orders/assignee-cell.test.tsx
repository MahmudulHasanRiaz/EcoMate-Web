import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AssigneeCell } from './index'

vi.mock('@/features/users/api', () => ({
  usersApi: {
    get: vi.fn((id: string) =>
      Promise.resolve({
        data: {
          id,
          firstName: 'Sara',
          lastName: 'Khan',
          username: 'sara.k',
          email: 'sara@example.com',
          phoneNumber: '+8801000000001',
          status: 'active',
          role: 'employee',
          createdAt: '2024-06-01T00:00:00Z',
          updatedAt: '2024-06-01T00:00:00Z',
        },
      }),
    ),
  },
}))

import { usersApi } from '@/features/users/api'

async function renderCell(assignee: { id: string; firstName?: string; lastName?: string } | null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <AssigneeCell assignee={assignee} />
    </QueryClientProvider>,
  )
}

describe('AssigneeCell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows Unassigned when there is no assignee and opens nothing', async () => {
    const { getByText, getByRole } = await renderCell(null)
    await expect.element(getByText('Unassigned')).toBeInTheDocument()
    await expect.element(getByRole('button')).not.toBeInTheDocument()
  })

  it('opens the user card on click and lazy-loads only then', async () => {
    const { getByRole, getByText } = await renderCell({ id: 'u1', firstName: 'Sara', lastName: 'Khan' })
    expect(vi.mocked(usersApi.get)).not.toHaveBeenCalled()
    await getByRole('button').click()
    expect(vi.mocked(usersApi.get)).toHaveBeenCalledWith('u1')
    await expect.element(getByText('sara@example.com')).toBeInTheDocument()
    await expect.element(getByText('employee')).toBeInTheDocument()
  })
})
