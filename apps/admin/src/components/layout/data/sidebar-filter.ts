import type { NavGroup, NavItem, NavCollapsible, NavLink } from '../types'

export const EVERYTHING_FEATURE = '*'

export function filterNavItems(
  items: NavItem[],
  features: string[],
  permissions: string[] = [],
): NavItem[] {
  const hasFeature = (key: string) => features.includes(EVERYTHING_FEATURE) || features.includes(key)
  // Only gate on the keys we were actually given: a caller that omits the
  // permission list is not asserting "no permissions", so items with a
  // declared `permissions` requirement stay hidden until a list arrives.
  const hasAnyPermission = (keys?: string[]) =>
    !keys || keys.length === 0 || (Array.isArray(permissions) && keys.some((key) => permissions.includes(key)))
  return items.reduce<NavItem[]>((acc, item) => {
    if ('items' in item && item.items) {
      const subItems = filterNavItems(item.items, features, permissions)
      const parentHasFeature = !item.feature || hasFeature(item.feature)
      const parentHasPermission = hasAnyPermission(item.permissions)
      if (!parentHasFeature || !parentHasPermission) return acc
      if (subItems.length === 0) return acc
      acc.push({ ...item, items: subItems } as NavCollapsible)
    } else {
      if (item.feature && !hasFeature(item.feature)) return acc
      if (!hasAnyPermission(item.permissions)) return acc
      acc.push(item as NavLink)
    }
    return acc
  }, [])
}
