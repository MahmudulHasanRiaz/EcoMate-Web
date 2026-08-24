import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render } from 'vitest-browser-react'
import { SignIn } from '../index'

const search = vi.hoisted(() => ({ value: {} }))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...actual,
    useSearch: () => search.value,
    Link: ({ children, to, className }: { children?: React.ReactNode; to: string; className?: string }) => (
      <a href={to} className={className}>{children}</a>
    ),
  }
})

vi.mock('../components/user-auth-form', () => ({
  UserAuthForm: () => <div data-testid='user-auth-form' />,
}))

vi.mock('@/assets/logo', () => ({ Logo: () => <span>Logo</span> }))

describe('SignIn session-expired banner (G-21)', () => {
  beforeEach(() => {
    search.value = {}
  })

  it('renders the friendly expired banner when ?expired=1 is present', async () => {
    search.value = { expired: '1' }
    const { getByText } = await render(<SignIn />)

    await expect
      .element(getByText('Your session has expired. Please sign in again.'))
      .toBeInTheDocument()
  })

  it('does not render the expired banner on a normal sign-in visit', async () => {
    const { getByText } = await render(<SignIn />)

    const matches = await getByText('Your session has expired. Please sign in again.').all()
    expect(matches.length).toBe(0)
  })
})
