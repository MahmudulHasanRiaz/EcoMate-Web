import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'

export const Route = createFileRoute('/(auth)/license/activate')({
  component: LicenseActivatePage,
})

function LicenseActivatePage() {
  const navigate = useNavigate()
  const [licenseKey, setLicenseKey] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

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
        setTimeout(() => navigate({ to: '/' }), 2000)
      } else {
        setError(res.data?.error || 'Activation failed. Please check your license key.')
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Unable to reach server. Please try again.')
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
              Redirecting to dashboard...
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
