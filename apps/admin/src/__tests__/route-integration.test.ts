import { describe, expect, it } from 'vitest'
import { Route as MonPresetsRoute } from '../routes/_authenticated/mon/users/presets'
import { Route as OpEmployeesPresetsRoute } from '../routes/_authenticated/op/employees/presets'
import { Route as HrPresetsRoute } from '../routes/_authenticated/hr/presets'
import AccessPresetsPage from '../features/access-presets'
import { isRedirect } from '@tanstack/react-router'

describe('Access Preset Route Integration', () => {
  it('hr/presets route uses AccessPresetsPage component', () => {
    expect(HrPresetsRoute.options.component).toBe(AccessPresetsPage)
  })

  it.each([
    ['legacy mon/users/presets route', MonPresetsRoute],
    ['legacy op/employees/presets route', OpEmployeesPresetsRoute],
  ])('%s beforeLoad redirects to /hr/presets', (_label, route) => {
    const fn = route.options.beforeLoad
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
