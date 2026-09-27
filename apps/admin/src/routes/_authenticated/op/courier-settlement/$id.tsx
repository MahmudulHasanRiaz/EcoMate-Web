import { createFileRoute } from '@tanstack/react-router'
import { InvoiceDetailPage } from '@/features/courier-settlement/invoice-detail'
import { useLicenseStore } from '@/stores/license-store'

const FEATURE = 'admin_courier_settlement'

function InvoiceRoute() {
  const loaded = useLicenseStore((s) => s.loaded)
  const hasFeature = useLicenseStore((s) => s.hasFeature)
  const { id } = Route.useParams()

  if (!loaded) return null
  if (!hasFeature(FEATURE)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-lg font-medium">Courier Settlement</p>
        <p className="text-sm">This feature is not available in your current plan.</p>
      </div>
    )
  }
  return <InvoiceDetailPage id={id} />
}

export const Route = createFileRoute('/_authenticated/op/courier-settlement/$id')({
  component: InvoiceRoute,
})
