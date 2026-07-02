import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'
import { Loader2, RefreshCw, Key, ShieldCheck, Calendar, Globe, Award, HelpCircle } from 'lucide-react'

interface LicenseStatusResponse {
  active: boolean
  state: string
  message: string
  code: string | null
  license: {
    valid: boolean
    plan?: { id: string; name: string; planType: string; price: number }
    features?: string[]
    limits?: Record<string, number>
    domains?: string[]
    expiry?: string
    lastCheckIn?: string
  } | null
}

export function LicenseSettings() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data, isLoading, refetch } = useQuery<LicenseStatusResponse>({
    queryKey: ['license-status'],
    queryFn: () => apiClient.get('/license/status').then(r => r.data),
    staleTime: 30_000,
  })

  const syncMutation = useMutation({
    mutationFn: () => apiClient.post('/license/sync').then(r => r.data),
    onSuccess: (res) => {
      if (res.success) {
        toast.success('License synced and revalidated successfully!')
        queryClient.invalidateQueries({ queryKey: ['license-status'] })
        refetch()
      } else {
        toast.error(`Sync failed: ${res.message || res.error}`)
      }
    },
    onError: (err: any) => {
      toast.error(`Error syncing license: ${err.message || 'Server unreachable'}`)
    },
  })

  if (isLoading) {
    return (
      <div className='flex items-center justify-center min-h-[200px]'>
        <Loader2 className='animate-spin h-6 w-6 text-primary' />
      </div>
    )
  }

  const license = data?.license
  const isActive = data?.active ?? false

  return (
    <div className='space-y-6 w-full max-w-4xl'>
      <div>
        <h2 className='text-2xl font-bold tracking-tight'>License Settings</h2>
        <p className='text-muted-foreground'>
          Manage your software activation, check limits, and instantly revalidate features.
        </p>
      </div>
      <Separator />

      <div className='grid gap-6 md:grid-cols-3'>
        {/* Status Card */}
        <Card className='md:col-span-2'>
          <CardHeader>
            <div className='flex items-center justify-between'>
              <CardTitle className='flex items-center gap-2'>
                <ShieldCheck className={isActive ? 'text-green-500' : 'text-red-500'} />
                License Information
              </CardTitle>
              <Badge variant={isActive ? 'default' : 'destructive'} className={isActive ? 'bg-green-500 hover:bg-green-600' : ''}>
                {isActive ? 'Active' : data?.state || 'Inactive'}
              </Badge>
            </div>
            <CardDescription>
              Details about your active EcoMate software plan and activation.
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            {license ? (
              <div className='grid gap-4 sm:grid-cols-2 text-sm'>
                <div className='flex items-center gap-3 p-3 bg-muted/50 rounded-lg'>
                  <Award className='text-primary h-5 w-5 shrink-0' />
                  <div>
                    <p className='text-xs text-muted-foreground'>Current Plan</p>
                    <p className='font-medium text-foreground'>{license.plan?.name || 'Standard'}</p>
                  </div>
                </div>

                <div className='flex items-center gap-3 p-3 bg-muted/50 rounded-lg'>
                  <Calendar className='text-primary h-5 w-5 shrink-0' />
                  <div>
                    <p className='text-xs text-muted-foreground'>Expiration Date</p>
                    <p className='font-medium text-foreground'>
                      {license.expiry ? new Date(license.expiry).toLocaleDateString() : 'Never'}
                    </p>
                  </div>
                </div>

                <div className='flex items-center gap-3 p-3 bg-muted/50 rounded-lg sm:col-span-2'>
                  <Globe className='text-primary h-5 w-5 shrink-0' />
                  <div>
                    <p className='text-xs text-muted-foreground'>Authorized Domains</p>
                    <p className='font-medium text-foreground break-all'>
                      {license.domains?.join(', ') || 'No restrictions'}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className='text-center py-6 text-muted-foreground text-sm'>
                No active license detected. Please activate your product.
              </div>
            )}

            <div className='flex flex-wrap gap-3 pt-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => syncMutation.mutate()}
                disabled={syncMutation.isPending}
                className='flex items-center gap-2'
              >
                {syncMutation.isPending ? (
                  <Loader2 className='animate-spin h-4 w-4' />
                ) : (
                  <RefreshCw className='h-4 w-4' />
                )}
                Sync & Revalidate Features
              </Button>
              <Button
                variant='secondary'
                size='sm'
                onClick={() => navigate({ to: '/license/activate' })}
                className='flex items-center gap-2'
              >
                <Key className='h-4 w-4' />
                Change License Key
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Feature badge summary Card */}
        <Card>
          <CardHeader>
            <CardTitle className='text-lg'>Unlocked Features</CardTitle>
            <CardDescription>Features enabled under your active plan.</CardDescription>
          </CardHeader>
          <CardContent>
            {license?.features && license.features.length > 0 ? (
              <div className='flex flex-wrap gap-2'>
                {license.features.map((feat) => (
                  <Badge key={feat} variant='secondary' className='font-mono text-xs px-2 py-0.5'>
                    {feat}
                  </Badge>
                ))}
              </div>
            ) : (
              <div className='text-center py-6 text-muted-foreground text-sm flex flex-col items-center gap-2'>
                <HelpCircle className='h-8 w-8 text-muted-foreground/50' />
                <p>No special features unlocked or basic mode active.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
