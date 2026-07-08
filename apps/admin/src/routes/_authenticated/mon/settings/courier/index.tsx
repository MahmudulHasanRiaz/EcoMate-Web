import { createFileRoute, redirect } from '@tanstack/react-router'
import { CourierSettings } from '@/features/settings/courier'
import { useLicenseStore } from '@/stores/license-store'

const COURIER_FEATURES = ['courier_steadfast', 'courier_pathao', 'courier_redx', 'courier_carrybee']

function requireAnyCourier() {
  const store = useLicenseStore.getState()
  const hasAny = COURIER_FEATURES.some((f) => store.hasFeature(f))
  if (!hasAny) {
    throw redirect({ to: '/license-denied', search: { feature: 'courier' } })
  }
}

export const Route = createFileRoute('/_authenticated/mon/settings/courier/')({
  beforeLoad: () => requireAnyCourier(),
  component: CourierSettings,
})
