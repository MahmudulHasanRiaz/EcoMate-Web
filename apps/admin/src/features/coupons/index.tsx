import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Loader2, Plus, Pencil, Trash2, Percent, DollarSign } from 'lucide-react'

const couponsApi = {
  list: () => apiClient.get('/coupons'),
  create: (d: Record<string, unknown>) => apiClient.post('/coupons', d),
  update: (id: string, d: Record<string, unknown>) => apiClient.put(`/coupons/${id}`, d),
  delete: (id: string) => apiClient.delete(`/coupons/${id}`),
}

export function Coupons() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [form, setForm] = useState({ code: '', type: 'flat', value: '', minOrderValue: '', maxUses: '', startsAt: '', expiresAt: '' })

  const { data: coupons, isLoading } = useQuery({ queryKey: ['coupons'], queryFn: () => couponsApi.list().then(r => r.data) })

  const saveMut = useMutation({
    mutationFn: (d: Record<string, unknown>) => editing ? couponsApi.update(editing['id'] as string, d) : couponsApi.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['coupons'] }); setOpen(false); setEditing(null); resetForm(); toast.success(editing ? 'Updated' : 'Created') },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => couponsApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['coupons'] }); toast.success('Deleted') },
  })

  const resetForm = () => setForm({ code: '', type: 'flat', value: '', minOrderValue: '', maxUses: '', startsAt: '', expiresAt: '' })

  const openEdit = (c: Record<string, unknown>) => {
    setEditing(c)
    setForm({ code: c['code'] as string, type: c['type'] as string, value: String(c['value']), minOrderValue: c['minOrderValue'] ? String(c['minOrderValue']) : '', maxUses: c['maxUses'] ? String(c['maxUses']) : '', startsAt: c['startsAt'] ? (c['startsAt'] as string).slice(0,16) : '', expiresAt: c['expiresAt'] ? (c['expiresAt'] as string).slice(0,16) : '' })
    setOpen(true)
  }

  const list = Array.isArray(coupons) ? coupons : (coupons as { data?: unknown[] })?.data || []

  return (
    <>
      <Header fixed><GlobalSearchBar className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-end justify-between'>
          <div><h2 className='text-2xl font-bold tracking-tight'>Coupons</h2><p className='text-muted-foreground'>Create discount coupons.</p></div>
          <Button size='sm' onClick={() => { resetForm(); setEditing(null); setOpen(true) }}><Plus className='h-4 w-4 mr-1' /> Add</Button>
        </div>
        <Card><CardContent className='p-0'>
          <Table>
            <TableHeader><TableRow><TableHead>Code</TableHead><TableHead>Type</TableHead><TableHead>Value</TableHead><TableHead>Min Order</TableHead><TableHead>Usage</TableHead><TableHead>Active</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? <TableRow><TableCell colSpan={7} className='text-center py-8'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow> :
               list.length ? list.map((c: Record<string, unknown>) => (
                <TableRow key={c['id'] as string}>
                  <TableCell className='font-mono font-medium'>{c['code'] as string}</TableCell>
                  <TableCell><Badge variant='outline'>{c['type'] === 'percentage' ? <Percent className='h-3 w-3' /> : <DollarSign className='h-3 w-3' />} {c['type'] as string}</Badge></TableCell>
                  <TableCell>{c['type'] === 'percentage' ? `${c['value']}%` : `৳${c['value']}`}</TableCell>
                  <TableCell>{c['minOrderValue'] ? `৳${c['minOrderValue']}` : '—'}</TableCell>
                  <TableCell>{c['usedCount'] as number}{c['maxUses'] ? ` / ${c['maxUses']}` : ''}</TableCell>
                  <TableCell><Badge className={c['isActive'] ? 'bg-green-500' : ''}>{c['isActive'] ? 'Active' : 'Inactive'}</Badge></TableCell>
                  <TableCell className='flex gap-1'>
                    <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(c as Record<string, unknown>)}><Pencil className='h-3.5 w-3.5' /></Button>
                    <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => deleteMut.mutate(c['id'] as string)}><Trash2 className='h-3.5 w-3.5 text-destructive' /></Button>
                  </TableCell>
                </TableRow>
              )) : <TableRow><TableCell colSpan={7} className='text-center py-8 text-muted-foreground'>No coupons yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent></Card>
      </Main>

      <Dialog open={open} onOpenChange={v => { if (!v) { setOpen(false); setEditing(null) } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Edit Coupon' : 'New Coupon'}</DialogTitle></DialogHeader>
          <div className='space-y-3 py-2'>
            <div><Label>Code</Label><Input value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} placeholder='SUMMER2026' /></div>
            <div className='grid grid-cols-2 gap-3'>
              <div><Label>Type</Label><select className='w-full rounded-md border px-3 py-2 text-sm bg-background' value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}><option value='flat'>Flat (৳)</option><option value='percentage'>Percentage (%)</option></select></div>
              <div><Label>Value</Label><Input type='number' value={form.value} onChange={e => setForm({ ...form, value: e.target.value })} placeholder={form.type === 'percentage' ? '15' : '200'} /></div>
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div><Label>Min Order Value</Label><Input type='number' value={form.minOrderValue} onChange={e => setForm({ ...form, minOrderValue: e.target.value })} placeholder='500' /></div>
              <div><Label>Max Uses</Label><Input type='number' value={form.maxUses} onChange={e => setForm({ ...form, maxUses: e.target.value })} placeholder='100' /></div>
            </div>
            <div className='grid grid-cols-2 gap-3'>
              <div><Label>Starts At</Label><Input type='datetime-local' value={form.startsAt} onChange={e => setForm({ ...form, startsAt: e.target.value })} /></div>
              <div><Label>Expires At</Label><Input type='datetime-local' value={form.expiresAt} onChange={e => setForm({ ...form, expiresAt: e.target.value })} /></div>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setOpen(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={() => saveMut.mutate({ ...form, value: parseFloat(form.value) || 0, minOrderValue: form.minOrderValue ? parseFloat(form.minOrderValue) : undefined, maxUses: form.maxUses ? parseInt(form.maxUses) : undefined })} disabled={!form.code || !form.value}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
