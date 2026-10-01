import { createFileRoute } from '@tanstack/react-router'
import { PackingWorkspace } from '@/features/packing'
import { useLicenseStore } from '@/stores/license-store'

const FEATURE = 'admin_packing'

/**
 * The packing workspace is gated by ROLE in the team switcher (superadmin /
 * admin only), but the `admin_packing` plan feature was never enforced — any
 * role that could reach this URL got the workspace regardless of license.
 */
function PackingRoute() {
  const loaded = useLicenseStore((s) => s.loaded)
  const hasFeature = useLicenseStore((s) => s.hasFeature)

  if (!loaded) return null
  if (!hasFeature(FEATURE)) {
    return (
      <div className="flex flex-col items-center justify-center h-screen text-muted-foreground">
        <p className="text-lg font-medium">Packing Workspace</p>
        <p className="text-sm">
          The packing workspace is not included in your current plan.
        </p>
      </div>
    )
  }
  return <PackingWorkspace />
}

export const Route = createFileRoute('/_authenticated/op/packing/')({
  component: PackingRoute,
})