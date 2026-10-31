import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { useSteadfastSets } from '@/features/dispatch/steadfast-set-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2, Plus, Pencil, Trash2, Star, Eye, EyeOff } from 'lucide-react'

const setsApi = {
  create: (d: Record<string, unknown>) => apiClient.post('/couriers/credential-sets', d),
  update: (id: string, d: Record<string, unknown>) => apiClient.put(`/couriers/credential-sets/${id}`, d),
  remove: (id: string) => apiClient.delete(`/couriers/credential-sets/${id}`),
  makeDefault: (id: string) => apiClient.post(`/couriers/credential-sets/${id}/make-default`, {}),
  reveal: (id: string) => apiClient.get(`/couriers/credential-sets/${id}/reveal`),
}

// Task 8: Steadfast multi-account list (labels + default radio + masked
// keys). The list endpoint never returns keys, and the form only sends a
// key when staff typed a new value (blank = keep). Owner-requested
// exception (2026-10-31): the edit dialog's eye toggle reveals the stored
// keys via a per-set reveal endpoint, shown as selectable text (no copy
// buttons).
export function SteadfastSetsManager() {
  const queryClient = useQueryClient()
  const { data: sets = [], isLoading } = useSteadfastSets()
  const [dialog, setDialog] = useState<{ open: boolean; id?: string; label: string }>({
    open: false,
    label: '',
  })
  const [keys, setKeys] = useState({ apiKey: '', secretKey: '', webhookSecret: '' })
  const [shownKeys, setShownKeys] = useState(false)

  const toggleRevealKeys = async () => {
    if (!dialog.id) return
    if (shownKeys) { setShownKeys(false); return }
    try {
      const r = await setsApi.reveal(dialog.id)
      const v = (r.data as any) || {}
      setKeys({
        apiKey: v.apiKey || '',
        secretKey: v.secretKey || '',
        webhookSecret: v.webhookSecret || '',
      })
      setShownKeys(true)
    } catch {
      toast.error('Could not load the saved keys')
    }
  }

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['steadfast-credential-sets'] })

  const createMut = useMutation({
    mutationFn: setsApi.create,
    onSuccess: () => { invalidate(); toast.success('Account added') },
    onError: (e: unknown) => toast.error((e as Error).message || 'Failed to add account'),
  })
  const updateMut = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Record<string, unknown> }) => setsApi.update(id, d),
    onSuccess: () => { invalidate(); toast.success('Account saved') },
    onError: (e: unknown) => toast.error((e as Error).message || 'Failed to save'),
  })
  const deleteMut = useMutation({
    mutationFn: setsApi.remove,
    onSuccess: () => { invalidate(); toast.success('Account removed') },
    onError: (e: unknown) => toast.error((e as Error).message || 'Failed to remove'),
  })
  const defaultMut = useMutation({
    mutationFn: setsApi.makeDefault,
    onSuccess: () => { invalidate(); toast.success('Default account updated') },
    onError: (e: unknown) => toast.error((e as Error).message || 'Failed to update default'),
  })

  const openAdd = () => {
    setKeys({ apiKey: '', secretKey: '', webhookSecret: '' })
    setShownKeys(false)
    setDialog({ open: true, label: '' })
  }
  const openEdit = (id: string, label: string) => {
    setKeys({ apiKey: '', secretKey: '', webhookSecret: '' })
    setShownKeys(false)
    setDialog({ open: true, id, label })
  }
  const save = () => {
    if (!dialog.label.trim()) { toast.error('Label is required'); return }
    if (!dialog.id && (!keys.apiKey.trim() || !keys.secretKey.trim())) {
      toast.error('API Key and Secret Key are required')
      return
    }
    const payload: Record<string, unknown> = { label: dialog.label.trim() }
    // Only send keys staff actually typed — blank keeps the stored value.
    if (keys.apiKey.trim()) payload.apiKey = keys.apiKey.trim()
    if (keys.secretKey.trim()) payload.secretKey = keys.secretKey.trim()
    if (keys.webhookSecret.trim()) payload.webhookSecret = keys.webhookSecret.trim()
    if (dialog.id) {
      updateMut.mutate({ id: dialog.id, d: payload }, {
        onSuccess: () => setDialog({ open: false, label: '' }),
      })
    } else {
      createMut.mutate(payload, {
        onSuccess: () => setDialog({ open: false, label: '' }),
      })
    }
  }

  return (
    <div className='rounded-md border border-border/70 p-2.5 space-y-2'>
      <div className='flex items-center justify-between'>
        <Label className='text-xs font-medium'>Merchant Accounts</Label>
        <Button size='sm' variant='outline' className='h-7 text-xs' onClick={openAdd}>
          <Plus className='h-3 w-3 mr-1' /> Add Account
        </Button>
      </div>
      <p className='text-[11px] text-muted-foreground leading-relaxed'>
        Multiple Steadfast merchant profiles (e.g. separate shops). The default books
        every order unless staff picks another account at dispatch. Keys stay hidden —
        open an account and tap the eye on a key field to view it.
      </p>
      {isLoading ? (
        <div className='flex justify-center py-2'><Loader2 className='h-4 w-4 animate-spin' /></div>
      ) : sets.length === 0 ? (
        <p className='text-[11px] text-muted-foreground'>Single account (above). Add a second profile to enable the dispatch picker.</p>
      ) : (
        <div className='space-y-1.5'>
          {sets.map((s) => (
            <div key={s.id} className='flex items-center gap-2 rounded-md bg-muted/40 px-2 py-1.5'>
              <button
                title={s.isDefault ? 'Default account' : 'Make default'}
                onClick={() => { if (!s.isDefault) defaultMut.mutate(s.id) }}
                className='shrink-0'
              >
                <Star className={`h-4 w-4 ${s.isDefault ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground hover:text-amber-400'}`} />
              </button>
              <div className='flex-1 min-w-0'>
                <p className='text-xs font-medium truncate'>{s.label}</p>
                <p className='text-[10px] text-muted-foreground'>
                  {s.hasApiKey ? 'keys set' : 'no keys'} · {s.hasWebhook ? 'webhook token set' : 'no webhook token'}
                </p>
              </div>
              {s.isDefault && <Badge variant='outline' className='text-[9px]'>Default</Badge>}
              <Button size='icon' variant='ghost' className='h-6 w-6' onClick={() => openEdit(s.id, s.label)}>
                <Pencil className='h-3 w-3' />
              </Button>
              <Button size='icon' variant='ghost' className='h-6 w-6 text-destructive' onClick={() => deleteMut.mutate(s.id)}>
                <Trash2 className='h-3 w-3' />
              </Button>
            </div>
          ))}
        </div>
      )}
      <Dialog open={dialog.open} onOpenChange={(open) => setDialog((p) => ({ ...p, open }))}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>{dialog.id ? 'Edit Account' : 'Add Steadfast Account'}</DialogTitle>
          </DialogHeader>
          <div className='space-y-3 py-2'>
            <div>
              <Label className='text-xs'>Label</Label>
              <Input
                className='h-8 text-sm'
                value={dialog.label}
                onChange={(e) => setDialog((p) => ({ ...p, label: e.target.value }))}
                placeholder='e.g. Dhaka Shop'
              />
            </div>
            {([
              { key: 'apiKey', label: `API Key${dialog.id ? ' (blank = keep)' : ''}`, placeholder: dialog.id ? '•••••••• (unchanged)' : 'Enter API Key...' },
              { key: 'secretKey', label: `Secret Key${dialog.id ? ' (blank = keep)' : ''}`, placeholder: dialog.id ? '•••••••• (unchanged)' : 'Enter Secret Key...' },
              { key: 'webhookSecret', label: 'Webhook Token (optional, blank = keep)', placeholder: '•••••••• (unchanged)' },
            ] as const).map((f) => (
              <div key={f.key}>
                <Label className='text-xs'>{f.label}</Label>
                <div className='relative'>
                  <Input
                    className='h-8 text-sm pr-8'
                    type={shownKeys ? 'text' : 'password'}
                    value={keys[f.key]}
                    onChange={(e) => setKeys((p) => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                  />
                  {dialog.id && (
                    <button
                      type='button'
                      aria-label={shownKeys ? 'Hide saved keys' : 'Show saved keys'}
                      title={shownKeys ? 'Hide saved keys' : 'Show saved keys'}
                      onClick={() => void toggleRevealKeys()}
                      className='absolute right-1 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground'
                    >
                      {shownKeys ? <EyeOff className='h-3.5 w-3.5' /> : <Eye className='h-3.5 w-3.5' />}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setDialog({ open: false, label: '' })}>Cancel</Button>
            <Button onClick={save} disabled={createMut.isPending || updateMut.isPending}>
              {(createMut.isPending || updateMut.isPending) && <Loader2 className='h-3.5 w-3.5 animate-spin mr-1' />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
