import { StrictMode } from 'react'
import ReactDOM from 'react-dom/client'
import { AxiosError } from 'axios'
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { handleServerError } from '@/lib/handle-server-error'
import { APP_BASEPATH } from '@/lib/app-href'
import { initSwUpdate } from '@/lib/sw-update'
import { DirectionProvider } from './context/direction-provider'
import { FontProvider } from './context/font-provider'
import { ThemeProvider } from './context/theme-provider'
import { FeaturesProvider } from './context/features-provider'
import { routeTree } from './routeTree.gen'
import { GeneralError } from '@/features/errors/general-error'
// Styles
import './styles/index.css'

// D18: keep long-lived admin tabs on the latest deploy — periodic SW
// update checks + one reload when a new SW takes control (see lib/sw-update).
initSwUpdate()

const queryClient = new QueryClient({  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: import.meta.env.PROD ? 3 : 0,
      refetchOnWindowFocus: import.meta.env.PROD,
    },
    mutations: {
      onError: (error) => {
        if (import.meta.env.DEV) console.error('[Mutation Error]', error)
        handleServerError(error)

        if (error instanceof AxiosError) {
          if (error.response?.status === 304) {
            toast.error('Content not modified!')
          }
        }
      },
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      if (import.meta.env.DEV) console.error('[Query Error]', error)

      if (error instanceof AxiosError) {
        if (error.response?.status === 401) {
          return
        }
        if (error.response?.status === 500) {
          toast.error('Internal Server Error!')
          // Only navigate to error page in production to avoid disrupting HMR in development
          if (import.meta.env.PROD) {
            router.navigate({ to: '/500' })
          }
        }
        if (error.response?.status === 403) {
          // router.navigate("/forbidden", { replace: true });
        }
      }
    },
  }),
})

// Create a new router instance
const router = createRouter({
  routeTree,
  context: { queryClient, userRole: null },
  defaultErrorComponent: GeneralError,
  // 'intent' = preload when user hovers/focuses a link. Previously this
  // caused many modulepreload links to be added to the initial HTML, which
  // slowed first paint on slow connections. Keep intent for in-app links but
  // don't preload on render.
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 30_000,
  basepath: APP_BASEPATH,
  // Pending indicator for in-app navigation. On full page reload the HTML
  // boot skeleton (z-index 9999) covers it, so the user sees one continuous
  // loader; on client-side navigation it gives instant feedback while the
  // next route chunk loads.
  defaultPendingComponent: () => (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(255,255,255,0.7)',
        backdropFilter: 'blur(2px)',
        zIndex: 50,
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          border: '3px solid #e2e8f0',
          borderTopColor: '#2563eb',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  ),
})

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

// Remove the boot skeleton the moment React commits the first paint.
// This way the skeleton is replaced by real UI, not just hidden.
function dismissBootSkeleton() {
  const boot = document.getElementById('app-boot')
  if (!boot) return
  boot.classList.add('app-boot--hidden')
  // Remove from DOM after the CSS transition completes.
  setTimeout(() => {
    if (boot.parentNode) boot.parentNode.removeChild(boot)
  }, 250)
}

// Render the app
const rootElement = document.getElementById('root')!
if (!rootElement.innerHTML) {
  const root = ReactDOM.createRoot(rootElement)
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <FontProvider>
            <DirectionProvider>
              <FeaturesProvider>
                <RouterProvider router={router} />
              </FeaturesProvider>
            </DirectionProvider>
          </FontProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </StrictMode>
  )
  // Keep the boot skeleton until the first route resolves — one continuous
  // loading state instead of skeleton → spinner → dashboard.
  const unsubscribe = router.subscribe('onResolved', () => {
    dismissBootSkeleton()
    unsubscribe()
  })
  // Safety net: never leave the skeleton stuck on a failed load.
  setTimeout(dismissBootSkeleton, 10_000)
}
