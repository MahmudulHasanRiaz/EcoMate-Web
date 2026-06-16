import { useState, useEffect } from 'react'
import { Loader2, Save } from 'lucide-react'
import { useBlockSettings, useUpdateBlockSettings } from './hooks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { toast } from 'sonner'

export function BlockSettingsPage() {
  const { data: settings, isLoading } = useBlockSettings()
  const updateMut = useUpdateBlockSettings()
  const [form, setForm] = useState<any>(null)

  useEffect(() => {
    if (settings && !form) setForm(JSON.parse(JSON.stringify(settings)))
  }, [settings])

  if (isLoading || !form) {
    return (
      <>
        <Header fixed>
          <div className='me-auto' />
          <ThemeSwitch /><ConfigDrawer /><ProfileDropdown />
        </Header>
        <Main><div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8' /></div></Main>
      </>
    )
  }

  const updateNested = (path: string, value: any) => {
    const copy = JSON.parse(JSON.stringify(form))
    const keys = path.split('.')
    let obj = copy
    for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]]
    obj[keys[keys.length - 1]] = value
    setForm(copy)
  }

  const handleSave = () => {
    updateMut.mutate(form, {
      onSuccess: () => toast.success('Settings saved'),
      onError: () => toast.error('Failed to save settings'),
    })
  }

  const msgKeys = Object.keys(form.blockMessages || {})

  return (
    <>
      <Header fixed>
        <div className='me-auto'><h1 className='text-lg font-semibold'>Blocking Settings</h1></div>
        <Button size='sm' onClick={handleSave} disabled={updateMut.isPending}>
          {updateMut.isPending ? <Loader2 className='h-4 w-4 animate-spin mr-1' /> : <Save className='h-4 w-4 mr-1' />}
          Save
        </Button>
        <ThemeSwitch /><ConfigDrawer /><ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <Card>
          <CardHeader><CardTitle className='text-sm font-medium'>Phone Order Restriction</CardTitle></CardHeader>
          <CardContent className='grid grid-cols-3 gap-4'>
            <div>
              <Label>Max Orders</Label>
              <Input type='number' value={form.phoneOrderRestriction.maxOrders} onChange={(e) => updateNested('phoneOrderRestriction.maxOrders', parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Time Window (minutes)</Label>
              <Input type='number' value={form.phoneOrderRestriction.timeWindowMinutes} onChange={(e) => updateNested('phoneOrderRestriction.timeWindowMinutes', parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Block Duration (minutes)</Label>
              <Input type='number' value={form.phoneOrderRestriction.blockDurationMinutes} onChange={(e) => updateNested('phoneOrderRestriction.blockDurationMinutes', parseInt(e.target.value) || 0)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className='text-sm font-medium'>IP Order Restriction</CardTitle></CardHeader>
          <CardContent className='grid grid-cols-3 gap-4'>
            <div>
              <Label>Max Orders</Label>
              <Input type='number' value={form.ipOrderRestriction.maxOrders} onChange={(e) => updateNested('ipOrderRestriction.maxOrders', parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Time Window (minutes)</Label>
              <Input type='number' value={form.ipOrderRestriction.timeWindowMinutes} onChange={(e) => updateNested('ipOrderRestriction.timeWindowMinutes', parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Block Duration (minutes)</Label>
              <Input type='number' value={form.ipOrderRestriction.blockDurationMinutes} onChange={(e) => updateNested('ipOrderRestriction.blockDurationMinutes', parseInt(e.target.value) || 0)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className='text-sm font-medium'>Auto-Block Configuration</CardTitle></CardHeader>
          <CardContent className='grid grid-cols-2 gap-4'>
            <div>
              <Label>Failed Login Threshold</Label>
              <Input type='number' value={form.autoBlock.failedLoginThreshold} onChange={(e) => updateNested('autoBlock.failedLoginThreshold', parseInt(e.target.value) || 0)} />
            </div>
            <div>
              <Label>Failed Login Window (minutes)</Label>
              <Input type='number' value={form.autoBlock.failedLoginWindowMinutes} onChange={(e) => updateNested('autoBlock.failedLoginWindowMinutes', parseInt(e.target.value) || 0)} />
            </div>
            <div className='flex items-center gap-3'>
              <Switch checked={form.autoBlock.autoFullBlockIp} onCheckedChange={(v) => updateNested('autoBlock.autoFullBlockIp', v)} />
              <Label>Auto Full-Block IP on failed login</Label>
            </div>
            <div className='flex items-center gap-3'>
              <Switch checked={form.autoBlock.autoOrderBlockIp} onCheckedChange={(v) => updateNested('autoBlock.autoOrderBlockIp', v)} />
              <Label>Auto Order-Block IP on order frequency</Label>
            </div>
            <div className='flex items-center gap-3'>
              <Switch checked={form.autoBlock.autoOrderBlockPhone} onCheckedChange={(v) => updateNested('autoBlock.autoOrderBlockPhone', v)} />
              <Label>Auto Order-Block Phone on order frequency</Label>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className='text-sm font-medium'>Block Messages</CardTitle></CardHeader>
          <CardContent className='space-y-6'>
            {msgKeys.map((key) => (
              <div key={key} className='space-y-3 rounded-md border p-4'>
                <h4 className='text-sm font-semibold capitalize'>{key.replace(/([A-Z])/g, ' $1').trim()}</h4>
                <div className='grid grid-cols-2 gap-3'>
                  <div>
                    <Label>Title</Label>
                    <Input value={form.blockMessages[key].title} onChange={(e) => updateNested(`blockMessages.${key}.title`, e.target.value)} />
                  </div>
                  <div>
                    <Label>Message</Label>
                    <Input value={form.blockMessages[key].message} onChange={(e) => updateNested(`blockMessages.${key}.message`, e.target.value)} />
                  </div>
                  <div>
                    <Label>CTA Label</Label>
                    <Input value={form.blockMessages[key].ctaLabel} onChange={(e) => updateNested(`blockMessages.${key}.ctaLabel`, e.target.value)} />
                  </div>
                  <div>
                    <Label>CTA Action</Label>
                    <Input value={form.blockMessages[key].ctaAction} onChange={(e) => updateNested(`blockMessages.${key}.ctaAction`, e.target.value)} />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </Main>
    </>
  )
}
