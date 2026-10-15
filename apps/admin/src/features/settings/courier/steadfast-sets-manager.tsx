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
import { Loader2, Plus, Pencil, Trash2, Star } from 'lucide-react'

const setsApi = {
  create: (d: Record<string, unknown>) => apiClient.post('/couriers/credential-sets', d),
  update: (id: string, d: Record<string, unknown>) => apiClient.put(`/couriers/credential-sets/${id}`, d),
  remove: (id: string) => apiClient.delete(`/couriers/credential-sets/${id}`),
  makeDefault: (id: string) => apiClient.post(`/couriers/credential-sets/${id}/make-default`, {}),
}

// Task 8: Steadfast multi-account list (labels + default radio + masked
// keys). Keys are write-only: the list endpoint never returns them, and the
// form only sends a key when staff typed a new value (blank = keep).
export function SteadfastSetsManager() {
  const queryClient = useQueryClient()
  const { data: sets = [], isLoading } = useSteadfastSets()
  const [dialog, setDialog] = useState<{ open: boolean; id?: string; label: string }>({
    open: false,
    label: '',
  })
  const [keys, setKeys] = useState({ apiKey: '', secretKey: '', webhookSecret: '' })

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
    setDialog({ open: true, label: '' })
  }
  const openEdit = (id: string, label: string) => {
    setKeys({ apiKey: '', secretKey: '', webhookSecret: '' })
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
        every order unless staff picks another account at dispatch. Keys are never
        displayed — only labels.
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
            <div>
              <Label className='text-xs'>API Key{dialog.id && ' (blank = keep)'}</Label>
              <Input
                className='h-8 text-sm'
                type='password'
                value={keys.apiKey}
                onChange={(e) => setKeys((p) => ({ ...p, apiKey: e.target.value }))}
                placeholder={dialog.id ? '•••••••• (unchanged)' : 'Enter API Key...'}
              />
            </div>
            <div>
              <Label className='text-xs'>Secret Key{dialog.id && ' (blank = keep)'}</Label>
              <Input
                className='h-8 text-sm'
                type='password'
                value={keys.secretKey}
                onChange={(e) => setKeys((p) => ({ ...p, secretKey: e.target.value }))}
                placeholder={dialog.id ? '•••••••• (unchanged)' : 'Enter Secret Key...'}
              />
            </div>
            <div>
              <Label className='text-xs'>Webhook Token (optional, blank = keep)</Label>
              <Input
                className='h-8 text-sm'
                type='password'
                value={keys.webhookSecret}
                onChange={(e) => setKeys((p) => ({ ...p, webhookSecret: e.target.value }))}
                placeholder='•••••••• (unchanged)'
              />
            </div>
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
