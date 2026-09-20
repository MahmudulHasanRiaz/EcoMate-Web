import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Loader2 } from 'lucide-react'

interface SourcePolicySetting {
  category: string
  key: string
  label: string
  description: string
  enabled: boolean
  defaultValue: boolean
}

interface SourcePolicyResponse {
  settings: SourcePolicySetting[]
  description: string
}

export function OrderSourcePolicy() {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery<SourcePolicyResponse>({
    queryKey: ['tracking-source-policy'],
    queryFn: () => apiClient.get('/tracking/admin/source-policy').then((r) => r.data),
  })

  const updateMutation = useMutation({
    mutationFn: ({ category, enabled }: { category: string; enabled: boolean }) =>
      apiClient.post('/tracking/admin/source-policy', { category, enabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tracking-source-policy'] })
      toast.success('Setting updated')
    },
    onError: () => {
      toast.error('Failed to update setting')
    },
  })

  if (isLoading) {
    return (
      <Card>
        <CardContent className='flex items-center justify-center py-8'>
          <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Order Source Tracking</CardTitle>
        <CardDescription>
          {data?.description || 'Configure which order sources should have tracking events sent to advertising platforms (Meta, TikTok, etc.).'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className='space-y-4'>
          {data?.settings.map((setting) => (
            <div
              key={setting.category}
              className='flex items-start justify-between gap-4 rounded-lg border p-4'
            >
              <div className='space-y-1'>
                <div className='flex items-center gap-2'>
                  <span className='font-medium text-sm'>{setting.label}</span>
                  {setting.enabled !== setting.defaultValue && (
                    <span className='text-[10px] font-semibold uppercase tracking-wider text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded'>
                      Custom
                    </span>
                  )}
                </div>
                <p className='text-sm text-muted-foreground'>{setting.description}</p>
                <p className='text-xs text-muted-foreground'>
                  Default: {setting.defaultValue ? 'ON' : 'OFF'}
                </p>
              </div>
              <Switch
                checked={setting.enabled}
                onCheckedChange={(enabled) =>
                  updateMutation.mutate({ category: setting.category, enabled })
                }
                disabled={updateMutation.isPending}
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
