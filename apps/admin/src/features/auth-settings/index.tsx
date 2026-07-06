import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Copy, Check, Eye, EyeOff, Loader2 } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { authSettingsApi, type AuthProviderResponse } from './api'

const PROVIDERS = [
  { key: 'google', label: 'Google', icon: 'G' },
  { key: 'github', label: 'GitHub', icon: 'GH' },
  { key: 'facebook', label: 'Facebook', icon: 'FB' },
]

const REDIRECT_URI = `${window.location.origin}/api/auth/callback`

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
}

export default function AuthSettingsPage() {
  const queryClient = useQueryClient()
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [copied, setCopied] = useState(false)

  const { data: settings, isLoading } = useQuery({
    queryKey: ['auth-settings'],
    queryFn: () => authSettingsApi.list().then((r) => r.data),
  })

  useEffect(() => {
    if (settings) {
      const map: Record<string, string> = {}
      for (const s of settings) {
        map[`clientId:${s.providerName}`] = s.clientId
        map[`clientSecret:${s.providerName}`] = s.clientSecret
      }
      setSecrets(map)
    }
  }, [settings])

  const upsertMutation = useMutation({
    mutationFn: ({ provider, data }: { provider: string; data: { isEnabled?: boolean; clientId?: string; clientSecret?: string } }) =>
      authSettingsApi.upsert(provider, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth-settings'] })
    },
    onError: () => toast.error('Failed to save settings'),
  })

  const handleToggle = useCallback(
    (provider: string, checked: boolean) => {
      upsertMutation.mutate({ provider, data: { isEnabled: checked } })
    },
    [upsertMutation],
  )

  const handleBlur = useCallback(
    (provider: string, field: 'clientId' | 'clientSecret') => {
      const value = secrets[`${field}:${provider}`]
      if (value !== undefined) {
        upsertMutation.mutate({ provider, data: { [field]: value || '' } })
      }
    },
    [secrets, upsertMutation],
  )

  const getSetting = (provider: string) =>
    settings?.find((s: AuthProviderResponse) => s.providerName === provider)

  const missingCredentials = (provider: string) => {
    const s = getSetting(provider)
    if (!s?.isEnabled) return false
    return !secrets[`clientId:${provider}`] || !secrets[`clientSecret:${provider}`]
  }

  const handleCopy = () => {
    copyToClipboard(REDIRECT_URI)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div className='flex flex-wrap items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Auth & Integrations</h2>
            <p className='text-muted-foreground'>Configure OAuth provider credentials and enable/disable social login methods.</p>
          </div>
        </div>

        {isLoading ? (
          <div className='flex justify-center py-16'>
            <Loader2 className='animate-spin h-8 w-8 text-muted-foreground' />
          </div>
        ) : (
          <div className='grid gap-6'>
            {PROVIDERS.map(({ key, label }) => {
              const s = getSetting(key)
              return (
                <Card key={key}>
                  <CardHeader className='flex flex-row items-center justify-between space-y-0 pb-4'>
                    <div>
                      <CardTitle className='flex items-center gap-2 text-lg'>
                        {label}
                        {missingCredentials(key) && (
                          <span className='inline-flex items-center rounded-md bg-amber-50 dark:bg-amber-950 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300 ring-1 ring-inset ring-amber-600/20'>
                            Missing credentials
                          </span>
                        )}
                      </CardTitle>
                      <CardDescription>Enable sign-in with {label}</CardDescription>
                    </div>
                    <Switch
                      checked={s?.isEnabled ?? false}
                      onCheckedChange={(checked) => handleToggle(key, checked)}
                    />
                  </CardHeader>
                  <CardContent className='space-y-4'>
                    <div className='space-y-2'>
                      <Label>Redirect URI</Label>
                      <div className='flex gap-2'>
                        <Input readOnly value={REDIRECT_URI} className='font-mono text-xs' />
                        <Button variant='outline' size='icon' onClick={handleCopy} className='shrink-0'>
                          {copied ? <Check className='h-4 w-4' /> : <Copy className='h-4 w-4' />}
                        </Button>
                      </div>
                    </div>
                    <div className='space-y-2'>
                      <Label htmlFor={`clientId-${key}`}>Client ID</Label>
                      <Input
                        id={`clientId-${key}`}
                        value={secrets[`clientId:${key}`] ?? ''}
                        onChange={(e) => setSecrets((prev) => ({ ...prev, [`clientId:${key}`]: e.target.value }))}
                        onBlur={() => handleBlur(key, 'clientId')}
                        placeholder='Enter Client ID'
                      />
                    </div>
                    <div className='space-y-2'>
                      <Label htmlFor={`clientSecret-${key}`}>Client Secret</Label>
                      <div className='flex gap-2'>
                        <Input
                          id={`clientSecret-${key}`}
                          type={visible[`clientSecret:${key}`] ? 'text' : 'password'}
                          value={secrets[`clientSecret:${key}`] ?? ''}
                          onChange={(e) => setSecrets((prev) => ({ ...prev, [`clientSecret:${key}`]: e.target.value }))}
                          onBlur={() => handleBlur(key, 'clientSecret')}
                          placeholder='Enter Client Secret'
                          className='font-mono'
                        />
                        <Button
                          variant='outline'
                          size='icon'
                          onClick={() => setVisible((prev) => ({ ...prev, [`clientSecret:${key}`]: !prev[`clientSecret:${key}`] }))}
                          className='shrink-0'
                        >
                          {visible[`clientSecret:${key}`] ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </Main>
    </>
  )
}
