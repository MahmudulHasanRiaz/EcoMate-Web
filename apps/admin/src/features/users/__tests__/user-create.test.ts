import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/users/api', () => ({
  usersApi: { create: vi.fn() },
}))

/**
 * The User Creation page replaced the "Add User" dialog. The page initially
 * shipped with a 6-character, no-complexity password rule, no confirmation
 * field and no permission override matrix — all of which the dialog enforced.
 * These tests lock the restored rules in place.
 *
 * Imported lazily: a static import pulls the TanStack route module through the
 * router plugin transform, which does not resolve inside a browser-mode test.
 */
async function load() {
  return import('@/routes/_authenticated/mon/users/create')
}

describe('/mon/users/create route guard', () => {
  it('is gated on the view_hr permission, with superadmin always allowed', async () => {
    const { Route } = await load()
    const beforeLoad = (Route.options as { beforeLoad?: () => void }).beforeLoad
    expect(beforeLoad).toBeTypeOf('function')

    const setup = (user: unknown) => {
      if (user) localStorage.setItem('eco_mate_user', JSON.stringify(user))
      else localStorage.removeItem('eco_mate_user')
    }

    try {
      // No cached user → redirect.
      setup(null)
      expect(() => beforeLoad!()).toThrow()

      // Permissions without view_hr → redirect. This page previously had no
      // guard at all, so any authenticated user could render the create form.
      setup({ role: 'manager', permissions: ['view_orders'] })
      expect(() => beforeLoad!()).toThrow()

      // view_hr → allowed.
      setup({ role: 'manager', permissions: ['view_hr'] })
      expect(() => beforeLoad!()).not.toThrow()

      // superadmin → allowed regardless of permissions.
      setup({ role: 'superadmin', permissions: [] })
      expect(() => beforeLoad!()).not.toThrow()
    } finally {
      setup(null)
    }
  })
})

describe('/mon/users/create password rules', () => {
  it('requires a password', async () => {
    const { passwordError } = await load()
    expect(passwordError('', '')).toBe('Password is required.')
  })

  it('enforces the 8-character minimum the dialog enforced', async () => {
    const { passwordError } = await load()
    // The page previously accepted 6 characters.
    expect(passwordError('Ab1', 'Ab1')).toBe(
      'Password must be at least 8 characters long.',
    )
    expect(passwordError('Ab1defgh', 'Ab1defgh')).toBeNull()
  })

  it('requires a lowercase letter', async () => {
    const { passwordError } = await load()
    expect(passwordError('UPPERCASE1', 'UPPERCASE1')).toBe(
      'Password must contain at least one lowercase letter.',
    )
  })

  it('requires a number', async () => {
    const { passwordError } = await load()
    expect(passwordError('lowercaseonly', 'lowercaseonly')).toBe(
      'Password must contain at least one number.',
    )
  })

  it('requires the confirmation to match', async () => {
    const { passwordError } = await load()
    expect(passwordError('S3cur3Pass', 'S3cur3Pasz')).toBe(
      "Passwords don't match.",
    )
    expect(passwordError('S3cur3Pass', 'S3cur3Pass')).toBeNull()
  })

  it('accepts a password that satisfies every rule', async () => {
    const { passwordError } = await load()
    expect(passwordError('S3cur3P@ss', 'S3cur3P@ss')).toBeNull()
  })
})