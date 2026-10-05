import { createFileRoute, useNavigate, redirect } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { apiClient } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

const ERROR_MESSAGES: Record<string, string> = {
  not_found: 'License key not found in system. Please verify your license key and try again.',
  domain_mismatch: 'Domain mismatch. This license is not valid for this domain.',
  expired: 'License has expired. Please renew your license to continue.',
  invalid_api_key: 'Invalid API key. The server rejected the request. Please check your API key.',
  unauthorized: 'Authorization failed. Please check your API key.',
  unreachable: 'Cannot reach KeyMate server. Please verify: (1) KEYMATE_API_URL is correct, (2) KeyMate server is running, (3) Network connectivity.',
  engine_unavailable: 'License engine failed to load. Please restart the application.',
  validation_failed: 'License validation failed. Please contact support with your license key.',
  keymate_unreachable: 'Cannot reach KeyMate server. Please verify the server is running and accessible.',
}

function friendlyError(code?: string, fallback?: string): string {
  if (!code) return fallback || 'An unknown error occurred.'
  return ERROR_MESSAGES[code] || `License error: ${code}`
}

/**
 * Turn a failed activation request into something the user can act on.
 *
 * The generic 'Unable to reach server' this used to fall back to was actively
 * misleading: it fired for every transport-level failure, so a backend that
 * failed to boot was indistinguishable from the license server being down.
 * The error name tells the two apart, and the server's own message (when it
 * sent one) is preferred over anything we could guess.
 */
function describeActivationError(err: any): string {
  // A real response from our backend — trust its message.
  const serverMessage = err?.response?.data?.message;
  if (serverMessage) return serverMessage;

  const code = err?.code;
  const detail = err?.message;

  if (code === 'ECONNREFUSED') {
    return (
      'Could not reach the EcoMate server — it is not running or is not accepting connections. ' +
      'Start it with "npm run dev" from the project root (or "npm run start" in production) and try again.'
    );
  }
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
    return 'The server took too long to respond. It may still be starting up — wait a few seconds and try again.';
  }
  if (typeof code === 'string' && code.startsWith('ERR_BAD_RESPONSE')) {
    return 'The server sent a malformed response. Check that the backend is running and reachable.';
  }
  if (code === 'ERR_NETWORK') {
    return (
      'Could not reach the EcoMate server. Check your internet connection, and that the server ' +
      'address is correct.'
    );
  }
  if (detail) return detail;
  return 'Unable to reach server. Please try again.';
}

/**
 * License activation.
 *
 * Deliberately OUTSIDE the authenticated shell: when the license is invalid
 * every page 403s and the sidebar collapses, so this page must render
 * standalone (full-screen, no menus) and be reachable by typing nothing —
 * the app redirects here automatically. It keeps the two security properties
 * the _authenticated placement provided:
 *
 *   1. A session is required (no token ⇒ sign-in with a return path).
 *      POST /license/activate stays @Roles('superadmin','admin') server-side.
 *   2. Anonymous visitors never see an activation form — the page was moved
 *      out of the (auth) group previously precisely because an anonymous
 *      visitor could replace a live deployment's license.
 */
export const Route = createFileRoute('/license/activate')({
  validateSearch: z.object({
    redirect: z.string().optional(),
  }),
  beforeLoad: ({ search }) => {
    const { accessToken } = useAuthStore.getState().auth
    if (!accessToken) {
      throw redirect({
        to: '/sign-in',
        search: { redirect: search.redirect || '/license/activate' },
        replace: true,
      })
    }
  },
  component: LicenseActivatePage,
})

const ADMIN_ROLES = ['superadmin', 'admin']

function LicenseActivatePage() {
  const navigate = useNavigate()
  const { redirect: returnTo } = Route.useSearch()
  const role = useAuthStore((s) => s.auth.user?.role)
  const [licenseKey, setLicenseKey] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const isAdmin = role ? ADMIN_ROLES.includes(role) : false

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await apiClient.post('/license/activate', {
        licenseKey: licenseKey.trim(),
        apiKey: apiKey.trim() || undefined,
      })

      if (res.data?.success) {
        setSuccess(true)
        setTimeout(() => navigate({ to: returnTo || '/' }), 2000)
      } else {
        const code = res.data?.error
        const backendMessage = res.data?.message
        setError(backendMessage || friendlyError(code, 'Activation failed. Please check your license key.'))
      }
    } catch (err: any) {
      setError(describeActivationError(err))
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-center text-green-600">License Activated!</CardTitle>
            <CardDescription className="text-center">
              Redirecting back to the app...
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>License Activation Required</CardTitle>
            <CardDescription>
              This EcoMate installation needs a valid license. License activation
              requires an administrator account — please contact your administrator.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Activate Your License</CardTitle>
          <CardDescription>
            Enter your license key to activate this EcoMate installation.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="licenseKey">License Key</Label>
              <Input
                id="licenseKey"
                placeholder="XXXX-XXXX-XXXX-XXXX"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key (optional)</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="e.g. eyJhbGciOi..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                Optional security token for auto-verification. Leave blank if not provided.
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Activating...' : 'Activate License'}
            </Button>

            <p className="text-xs text-center text-muted-foreground mt-4">
              Need a license? Contact your service provider.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
