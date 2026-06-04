import { type QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { Suspense, lazy } from 'react'
import { Toaster } from '@/components/ui/sonner'
import { NavigationProgress } from '@/components/navigation-progress'
import { GeneralError } from '@/features/errors/general-error'
import { NotFoundError } from '@/features/errors/not-found-error'

// Devtools are heavy (Recharts + devtools UI). Load them on demand in dev mode only.
const ReactQueryDevtools =
  import.meta.env.MODE === 'development'
    ? lazy(() =>
        import('@tanstack/react-query-devtools').then((m) => ({
          default: m.ReactQueryDevtools,
        })),
      )
    : () => null

const TanStackRouterDevtools =
  import.meta.env.MODE === 'development'
    ? lazy(() =>
        import('@tanstack/router-devtools').then((m) => ({
          default: m.TanStackRouterDevtools,
        })),
      )
    : () => null

function Devtools() {
  if (import.meta.env.MODE !== 'development') return null
  return (
    <Suspense fallback={null}>
      <ReactQueryDevtools buttonPosition='bottom-left' />
      <TanStackRouterDevtools position='bottom-right' />
    </Suspense>
  )
}

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  component: () => {
    return (
      <>
        <div className="no-print">
          <NavigationProgress />
          <Toaster duration={5000} />
          <Devtools />
        </div>
        <Outlet />
      </>
    )
  },
  notFoundComponent: NotFoundError,
  errorComponent: GeneralError,
})
