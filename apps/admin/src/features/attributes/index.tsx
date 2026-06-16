import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2 } from 'lucide-react'
import { attributesApi, type AttributeResponse } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

export function Attributes() {
  const queryClient = useQueryClient()
  const { data: attributes, isLoading } = useQuery({
    queryKey: ['attributes'],
    queryFn: () => attributesApi.list().then(r => r.data),
  })

  const [newName, setNewName] = useState('')
  const [editingAttr, setEditingAttr] = useState<AttributeResponse | null>(null)
  const [valueInput, setValueInput] = useState('')

  useEffect(() => {
    if (editingAttr) setValueInput('')
  }, [editingAttr?.id])

  const createAttr = useMutation({
    mutationFn: (data: { name: string }) => attributesApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attributes'] })
      setNewName('')
      toast.success('Attribute created')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to create'),
  })

  const deleteAttr = useMutation({
    mutationFn: (id: string) => attributesApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attributes'] })
      toast.success('Deleted')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to delete'),
  })

  const addVal = useMutation({
    mutationFn: ({ attrId, value }: { attrId: string; value: string }) => attributesApi.addValue(attrId, { value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attributes'] })
      setValueInput('')
      toast.success('Value added')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed to add value'),
  })

  const removeVal = useMutation({
    mutationFn: ({ attrId, valueId }: { attrId: string; valueId: string }) => attributesApi.removeValue(attrId, valueId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attributes'] })
      toast.success('Value removed')
    },
    onError: (e: any) => toast.error(e.response?.data?.message || 'Failed'),
  })

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    createAttr.mutate({ name })
  }

  const handleAddValue = (e: React.FormEvent) => {
    e.preventDefault()
    const val = valueInput.trim()
    if (!val || !editingAttr) return
    addVal.mutate({ attrId: editingAttr.id, value: val })
  }

  return (
    <>
      <Header fixed>
        <Search className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-end justify-between gap-2'>
          <div>
            <h2 className='text-2xl font-bold tracking-tight'>Attributes</h2>
            <p className='text-muted-foreground'>Manage custom product attributes like Color, Size, Material etc.</p>
          </div>
          <form onSubmit={handleCreate} className='flex gap-2'>
            <Input
              placeholder='New attribute name...'
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className='w-48'
              disabled={createAttr.isPending}
            />
            <Button type='submit' size='sm' disabled={!newName.trim() || createAttr.isPending}>
              {createAttr.isPending ? <Loader2 className='h-4 w-4 animate-spin' /> : <Plus className='h-4 w-4' />}
              Add
            </Button>
          </form>
        </div>

        {isLoading ? (
          <div className='flex justify-center py-12'><Loader2 className='animate-spin h-8 w-8 text-muted-foreground' /></div>
        ) : attributes && attributes.length > 0 ? (
          <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
            {attributes.map(attr => (
              <Card
                key={attr.id}
                className='cursor-pointer hover:shadow-md transition-shadow'
                onClick={() => setEditingAttr(attr)}
              >
                <CardHeader className='flex flex-row items-center justify-between pb-2'>
                  <CardTitle className='text-lg'>{attr.name}</CardTitle>
                  <Button
                    variant='ghost'
                    size='icon'
                    disabled={deleteAttr.isPending}
                    onClick={(e) => { e.stopPropagation(); deleteAttr.mutate(attr.id) }}
                  >
                    <Trash2 className='h-4 w-4 text-muted-foreground hover:text-destructive' />
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className='flex flex-wrap gap-1.5'>
                    {attr.values.length > 0
                      ? attr.values.map(v => <Badge key={v.id} variant='secondary'>{v.value}</Badge>)
                      : <span className='text-sm text-muted-foreground'>No values yet — click to add</span>
                    }
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className='flex flex-col items-center justify-center py-16 border-2 border-dashed rounded-lg text-muted-foreground'>
            <p className='mb-1'>No attributes yet</p>
            <p className='text-sm'>Add your first attribute above</p>
          </div>
        )}

        <Dialog
          open={!!editingAttr}
          onOpenChange={(open) => { if (!open) setEditingAttr(null) }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingAttr?.name} — Values</DialogTitle>
            </DialogHeader>

            <div className='space-y-3 py-2'>
              {editingAttr && editingAttr.values.length > 0 ? (
                editingAttr.values.map(v => (
                  <div key={v.id} className='flex items-center justify-between py-1'>
                    <Badge variant='outline'>{v.value}</Badge>
                    <Button
                      variant='ghost'
                      size='icon'
                      disabled={removeVal.isPending}
                      onClick={() => removeVal.mutate({ attrId: editingAttr.id, valueId: v.id })}
                    >
                      <Trash2 className='h-3 w-3 text-muted-foreground hover:text-destructive' />
                    </Button>
                  </div>
                ))
              ) : (
                <p className='text-sm text-muted-foreground text-center py-4'>No values yet. Add one below.</p>
              )}

              <form onSubmit={handleAddValue} className='flex gap-2 pt-2 border-t'>
                <Input
                  placeholder='New value...'
                  value={valueInput}
                  onChange={e => setValueInput(e.target.value)}
                  disabled={addVal.isPending}
                  autoFocus
                />
                <Button type='submit' size='sm' disabled={!valueInput.trim() || addVal.isPending}>
                  {addVal.isPending ? <Loader2 className='h-4 w-4 animate-spin' /> : <Plus className='h-4 w-4' />}
                  Add
                </Button>
              </form>
            </div>

            <DialogFooter>
              <Button variant='outline' onClick={() => setEditingAttr(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Main>
    </>
  )
}
