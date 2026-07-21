import { describe, expect, it } from 'vitest'
import { Route as MonPresetsRoute } from '../routes/_authenticated/mon/users/presets'
import { Route as LegacyRoute } from '../routes/_authenticated/op/employees/presets'
import AccessPresetsPage from '../features/access-presets'
import { redirect, isRedirect } from '@tanstack/react-router'

describe('Access Preset Route Integration', () => {
  it('mon/users/presets route uses AccessPresetsPage component', () => {
    expect(MonPresetsRoute.options.component).toBe(AccessPresetsPage)
  })

  it('legacy op/employees/presets route beforeLoad redirects to /mon/users/presets', () => {
    const fn = LegacyRoute.options.beforeLoad
    expect(fn).toBeDefined()
    expect(() => fn!({} as any)).toThrow()
    try {
      fn!({} as any)
      expect.unreachable('should have thrown')
    } catch (e) {
      expect(isRedirect(e)).toBe(true)
    }
  })
})
