import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { settingsApi } from './api'
import { apiClient } from '@/lib/api-client'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Loader2, Save, User, Settings, Palette, Bell, Monitor, KeyRound, Eye, EyeOff, AlertTriangle } from 'lucide-react'
import { PasswordInput } from '@/components/password-input'

export function PersonalSettings() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['settings'], queryFn: () => settingsApi.get().then((r: { data: any }) => r.data) })

  const profileMut = useMutation({ mutationFn: settingsApi.updateProfile, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['settings'] }); toast.success('Profile updated') } })
  const accountMut = useMutation({ mutationFn: settingsApi.updateAccount, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['settings'] }); toast.success('Account updated') } })
  const appearanceMut = useMutation({ mutationFn: settingsApi.updateAppearance, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['settings'] }); toast.success('Appearance updated') } })
  const notifMut = useMutation({ mutationFn: settingsApi.updateNotifications, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['settings'] }); toast.success('Notifications updated') } })
  const displayMut = useMutation({ mutationFn: settingsApi.updateDisplay, onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['settings'] }); toast.success('Display updated') } })

  if (isLoading) return <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8' /></div>

  const s = data || {} as any

  return (
    <div>
      <h2 className='text-2xl font-bold tracking-tight mb-6'>Personal Settings</h2>
      <Tabs defaultValue='profile'>
        <TabsList className='mb-6'>
          <TabsTrigger value='profile'><User className='h-4 w-4 mr-1' /> Profile</TabsTrigger>
          <TabsTrigger value='account'><Settings className='h-4 w-4 mr-1' /> Account</TabsTrigger>
          <TabsTrigger value='appearance'><Palette className='h-4 w-4 mr-1' /> Appearance</TabsTrigger>
          <TabsTrigger value='notifications'><Bell className='h-4 w-4 mr-1' /> Notifications</TabsTrigger>
          <TabsTrigger value='display'><Monitor className='h-4 w-4 mr-1' /> Display</TabsTrigger>
        </TabsList>

        <TabsContent value='profile'>
          <ProfileForm data={s.profile || {}} onSave={(d: any) => profileMut.mutate(d)} saving={profileMut.isPending} />
        </TabsContent>
        <TabsContent value='account'>
          <AccountForm data={s.account || {}} onSave={(d: any) => accountMut.mutate(d)} saving={accountMut.isPending} />
        </TabsContent>
        <TabsContent value='appearance'>
          <AppearanceForm data={s.appearance || {}} onSave={(d: any) => appearanceMut.mutate(d)} saving={appearanceMut.isPending} />
        </TabsContent>
        <TabsContent value='notifications'>
          <NotificationsForm data={s.notifications || {}} onSave={(d: any) => notifMut.mutate(d)} saving={notifMut.isPending} />
        </TabsContent>
        <TabsContent value='display'>
          <DisplayForm data={s.display || {}} onSave={(d: any) => displayMut.mutate(d)} saving={displayMut.isPending} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ProfileForm({ data, onSave, saving }: { data: any; onSave: (d: any) => void; saving: boolean }) {
  const [u, setU] = useState(data.username || '')
  const [e, setE] = useState(data.email || '')
  const [b, setB] = useState(data.bio || '')
  return (
    <Card>
      <CardHeader><CardTitle className='text-base'>Profile</CardTitle></CardHeader>
      <CardContent className='space-y-3'>
        <div><Label>Username</Label><Input value={u} onChange={e => setU(e.target.value)} /></div>
        <div><Label>Email</Label><Input value={e} onChange={e => setE(e.target.value)} /></div>
        <div><Label>Bio</Label><Textarea value={b} onChange={e => setB(e.target.value)} rows={3} /></div>
        <Button size='sm' onClick={() => onSave({ username: u, email: e, bio: b })} disabled={saving}><Save className='h-4 w-4 mr-1' /> Save</Button>
      </CardContent>
    </Card>
  )
}

function AccountForm({ data, onSave, saving }: { data: any; onSave: (d: any) => void; saving: boolean }) {
  const [name, setName] = useState(data.name || '')
  const [dob, setDob] = useState(data.dob || '')
  const [lang, setLang] = useState(data.language || 'en')

  const [cpw, setCpw] = useState({ current: '', newPass: '', confirm: '' })
  const [cpwOpen, setCpwOpen] = useState(false)
  const pwMut = useMutation({
    mutationFn: (d: { currentPassword: string; newPassword: string }) =>
      apiClient.post('/auth/change-password', d),
    onSuccess: () => {
      toast.success('Password changed successfully')
      setCpw({ current: '', newPass: '', confirm: '' })
      setCpwOpen(false)
    },
    onError: (err: any) => toast.error(err?.response?.data?.message || 'Failed to change password'),
  })

  const canSubmitPw = cpw.current && cpw.newPass && cpw.newPass === cpw.confirm && cpw.newPass.length >= 6

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader><CardTitle className='text-base'>Account</CardTitle></CardHeader>
        <CardContent className='space-y-3'>
          <div><Label>Name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
          <div><Label>Date of Birth</Label><Input type='date' value={dob} onChange={e => setDob(e.target.value)} /></div>
          <div><Label>Language</Label><select className='w-full rounded-md border px-3 py-2 text-sm bg-background' value={lang} onChange={e => setLang(e.target.value)}><option value='en'>English</option><option value='bn'>Bangla</option></select></div>
          <Button size='sm' onClick={() => onSave({ name, dob, language: lang })} disabled={saving}><Save className='h-4 w-4 mr-1' /> Save</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className='flex items-center justify-between'>
            <div>
              <CardTitle className='text-base flex items-center gap-2'><KeyRound className='h-4 w-4' /> Password</CardTitle>
              <CardDescription>Change your account password</CardDescription>
            </div>
            <Button variant='outline' size='sm' onClick={() => setCpwOpen(!cpwOpen)}>
              {cpwOpen ? 'Cancel' : 'Change Password'}
            </Button>
          </div>
        </CardHeader>
        {cpwOpen && (
          <CardContent className='space-y-3 border-t pt-4'>
            {pwMut.isSuccess && (
              <div className='flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-700 dark:text-amber-300'>
                <AlertTriangle className='h-4 w-4 mt-0.5 shrink-0' />
                <span>You have been logged out from all other devices for security.</span>
              </div>
            )}
            <div>
              <Label>Current Password</Label>
              <PasswordInput value={cpw.current} onChange={e => setCpw(p => ({ ...p, current: e.target.value }))} />
            </div>
            <div>
              <Label>New Password</Label>
              <PasswordInput value={cpw.newPass} onChange={e => setCpw(p => ({ ...p, newPass: e.target.value }))} />
            </div>
            <div>
              <Label>Confirm New Password</Label>
              <PasswordInput value={cpw.confirm} onChange={e => setCpw(p => ({ ...p, confirm: e.target.value }))} />
              {cpw.confirm && cpw.newPass !== cpw.confirm && (
                <p className='text-xs text-red-500 mt-1'>Passwords do not match</p>
              )}
            </div>
            <Button
              size='sm'
              onClick={() => pwMut.mutate({ currentPassword: cpw.current, newPassword: cpw.newPass })}
              disabled={!canSubmitPw || pwMut.isPending}
            >
              {pwMut.isPending ? <Loader2 className='h-4 w-4 mr-1 animate-spin' /> : <Save className='h-4 w-4 mr-1' />}
              Update Password
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  )
}

function AppearanceForm({ data, onSave, saving }: { data: any; onSave: (d: any) => void; saving: boolean }) {
  const [theme, setTheme] = useState(data.theme || 'light')
  const [font, setFont] = useState(data.font || 'inter')
  return (
    <Card>
      <CardHeader><CardTitle className='text-base'>Appearance</CardTitle></CardHeader>
      <CardContent className='space-y-3'>
        <div><Label>Theme</Label><select className='w-full rounded-md border px-3 py-2 text-sm bg-background' value={theme} onChange={e => setTheme(e.target.value)}><option value='light'>Light</option><option value='dark'>Dark</option></select></div>
        <div><Label>Font</Label><select className='w-full rounded-md border px-3 py-2 text-sm bg-background' value={font} onChange={e => setFont(e.target.value)}><option value='inter'>Inter</option><option value='manrope'>Manrope</option><option value='system'>System</option></select></div>
        <Button size='sm' onClick={() => onSave({ theme, font })} disabled={saving}><Save className='h-4 w-4 mr-1' /> Save</Button>
      </CardContent>
    </Card>
  )
}

function NotificationsForm({ data, onSave, saving }: { data: any; onSave: (d: any) => void; saving: boolean }) {
  const [type, setType] = useState(data.type || 'all')
  const [comm, setComm] = useState(data.communication_emails ?? false)
  const [soc, setSoc] = useState(data.social_emails ?? false)
  const [mkt, setMkt] = useState(data.marketing_emails ?? false)
  return (
    <Card>
      <CardHeader><CardTitle className='text-base'>Notifications</CardTitle></CardHeader>
      <CardContent className='space-y-3'>
        <div><Label>Notification Type</Label><select className='w-full rounded-md border px-3 py-2 text-sm bg-background' value={type} onChange={e => setType(e.target.value)}><option value='all'>All</option><option value='mentions'>Mentions Only</option><option value='none'>None</option></select></div>
        <div className='flex items-center gap-2'><Switch checked={comm} onCheckedChange={setComm} /><Label>Communication emails</Label></div>
        <div className='flex items-center gap-2'><Switch checked={soc} onCheckedChange={setSoc} /><Label>Social emails</Label></div>
        <div className='flex items-center gap-2'><Switch checked={mkt} onCheckedChange={setMkt} /><Label>Marketing emails</Label></div>
        <Button size='sm' onClick={() => onSave({ type, communication_emails: comm, social_emails: soc, marketing_emails: mkt, security_emails: true })} disabled={saving}><Save className='h-4 w-4 mr-1' /> Save</Button>
      </CardContent>
    </Card>
  )
}

function DisplayForm({ data, onSave, saving }: { data: any; onSave: (d: any) => void; saving: boolean }) {
  const [items, setItems] = useState<string[]>(data.items || ['recents', 'home'])
  const allItems = ['recents', 'home', 'applications', 'desktop', 'downloads', 'documents']
  return (
    <Card>
      <CardHeader><CardTitle className='text-base'>Display</CardTitle></CardHeader>
      <CardContent className='space-y-3'>
        <div className='space-y-2'>
          {allItems.map(id => (
            <div key={id} className='flex items-center gap-2'>
              <Switch checked={items.includes(id)} onCheckedChange={(v) => setItems(v ? [...items, id] : items.filter(i => i !== id))} />
              <Label className='capitalize'>{id}</Label>
            </div>
          ))}
        </div>
        <Button size='sm' onClick={() => onSave({ items })} disabled={saving}><Save className='h-4 w-4 mr-1' /> Save</Button>
      </CardContent>
    </Card>
  )
}
