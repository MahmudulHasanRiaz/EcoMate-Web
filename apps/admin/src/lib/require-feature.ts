import { redirect } from '@tanstack/react-router'
import { useLicenseStore } from '@/stores/license-store'

export function requireFeature(featureKey: string) {
  const store = useLicenseStore.getState()
  if (!store.loaded || !store.hasFeature(featureKey)) {
    throw redirect({
      to: '/license-denied',
      search: { feature: featureKey },
    })
  }
}
