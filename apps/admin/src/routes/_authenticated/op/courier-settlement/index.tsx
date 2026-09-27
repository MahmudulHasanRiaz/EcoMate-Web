import { createFileRoute } from '@tanstack/react-router'
import { CourierSettlementPage } from '@/features/courier-settlement'
import { useLicenseStore } from '@/stores/license-store'

const FEATURE = 'admin_courier_settlement'

function CourierSettlementRoute() {
  const loaded = useLicenseStore((s) => s.loaded)
  const hasFeature = useLicenseStore((s) => s.hasFeature)

  if (!loaded) return null
  if (!hasFeature(FEATURE)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-lg font-medium">Courier Settlement</p>
        <p className="text-sm">This feature is not available in your current plan.</p>
      </div>
    )
  }
  return <CourierSettlementPage />
}

export const Route = createFileRoute('/_authenticated/op/courier-settlement/')({
  component: CourierSettlementRoute,
})
