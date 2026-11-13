import { createFileRoute } from '@tanstack/react-router'
import { CareersPostingsPage } from '@/features/hr/careers'
import { useLicenseStore } from '@/stores/license-store'

const FEATURE = 'admin_hr_careers'

function CareersRoute() {
  const loaded = useLicenseStore((s) => s.loaded)
  const hasFeature = useLicenseStore((s) => s.hasFeature)

  if (!loaded) return null
  if (!hasFeature(FEATURE)) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <p className="text-lg font-medium">Careers</p>
        <p className="text-sm">This feature is not available in your current plan.</p>
      </div>
    )
  }
  return <CareersPostingsPage />
}

export const Route = createFileRoute('/_authenticated/hr/careers/')({
  component: CareersRoute,
})
