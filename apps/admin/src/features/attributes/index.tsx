import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import { attributesApi, type AttributeResponse } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { ConfigDrawer } from '@/components/config-drawer'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function Attributes() {
  const queryClient = useQueryClient()
  const { data: attributes, isLoading } = useQuery({
    queryKey: ['attributes'],
    queryFn: () => attributesApi.list().then(r => r.data),
  })

  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState<Record<string, string>>({})
  const [editAttr, setEditAttr] = useState<AttributeResponse | null>(null)

  const createAttr = useMutation({
    mutationFn: attributesApi.create,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['attributes'] }); setNewName(''); toast.success('Attribute created') },
  })

  const deleteAttr = useMutation({
    mutationFn: attributesApi.delete,
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['attributes'] }); toast.success('Attribute deleted') },
  })

  const addVal = useMutation({
    mutationFn: ({ attrId, data }: { attrId: string; data: { value: string } }) => attributesApi.addValue(attrId, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['attributes'] }); toast.success('Value added') },
  })

  const removeVal = useMutation({
    mutationFn: ({ attrId, valueId }: { attrId: string; valueId: string }) => attributesApi.removeValue(attrId, valueId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['attributes'] }); toast.success('Value removed') },
  })

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ConfigDrawer />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Attributes</h2>
            <p className='text-muted-foreground'>Manage custom product attributes like Color, Size, Material etc.</p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (newName.trim()) createAttr.mutate({ name: newName.trim() }) }} className='flex gap-2'>
            <Input placeholder='New attribute name...' value={newName} onChange={e => setNewName(e.target.value)} className='w-48' />
            <Button type='submit' size='sm' disabled={createAttr.isPending}><Plus className='h-4 w-4' /> Add</Button>
          </form>
        </div>

        {isLoading ? (
          <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8 text-muted-foreground' /></div>
        ) : (
          <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
            {attributes?.map(attr => (
              <Card key={attr.id} className='cursor-pointer hover:shadow-md transition-shadow' onClick={() => setEditAttr(attr)}>
                <CardHeader className='flex flex-row items-center justify-between pb-2'>
                  <CardTitle className='text-lg'>{attr.name}</CardTitle>
                  <Button variant='ghost' size='icon' onClick={(e) => { e.stopPropagation(); deleteAttr.mutate(attr.id) }}>
                    <Trash2 className='h-4 w-4 text-muted-foreground hover:text-destructive' />
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className='flex flex-wrap gap-1.5'>
                    {attr.values.map(v => (
                      <Badge key={v.id} variant='secondary'>{v.value}</Badge>
                    ))}
                    {attr.values.length === 0 && <span className='text-sm text-muted-foreground'>No values yet</span>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <Dialog open={!!editAttr} onOpenChange={() => setEditAttr(null)}>
          <DialogContent>
            <DialogHeader><DialogTitle>{editAttr?.name} — Values</DialogTitle></DialogHeader>
            <div className='space-y-3'>
              {editAttr?.values.map(v => (
                <div key={v.id} className='flex items-center justify-between'>
                  <Badge variant='outline'>{v.value}</Badge>
                  <Button variant='ghost' size='icon' onClick={() => removeVal.mutate({ attrId: editAttr.id, valueId: v.id })}>
                    <Trash2 className='h-3 w-3 text-muted-foreground' />
                  </Button>
                </div>
              ))}
              <form onSubmit={(e) => {
                e.preventDefault();
                const val = newValue[editAttr?.id || '']?.trim();
                if (val && editAttr) {
                  addVal.mutate({ attrId: editAttr.id, data: { value: val } });
                  setNewValue(prev => ({ ...prev, [editAttr.id]: '' }));
                }
              }} className='flex gap-2 pt-2'>
                <Input
                  placeholder='Add value...'
                  value={newValue[editAttr?.id || ''] || ''}
                  onChange={e => setNewValue(prev => ({ ...prev, [editAttr?.id || '']: e.target.value }))}
                />
                <Button type='submit' size='sm'>Add</Button>
              </form>
            </div>
          </DialogContent>
        </Dialog>
      </Main>
    </>
  )
}
