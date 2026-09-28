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
import { DirectionProvider } from './context/direction-provider'
import { FontProvider } from './context/font-provider'
import { ThemeProvider } from './context/theme-provider'
import { FeaturesProvider } from './context/features-provider'
import { routeTree } from './routeTree.gen'
import { GeneralError } from '@/features/errors/general-error'
// Styles
import './styles/index.css'

const queryClient = new QueryClient({
  defaultOptions: {
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
  basepath: '/admin',
  // No defaultPendingComponent: the HTML boot skeleton is the single loading
  // state. It stays until the first route resolves, so a full page reload
  // shows one continuous loader instead of skeleton → spinner → dashboard.
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
