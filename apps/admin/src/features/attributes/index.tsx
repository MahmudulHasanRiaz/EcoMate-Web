import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Plus, Trash2, Loader2, Pipette } from 'lucide-react'
import { attributesApi, type AttributeResponse } from './api'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'

const COLOR_MAP: Record<string, string> = {
  red: '#EF4444', blue: '#3B82F6', green: '#22C55E', yellow: '#EAB308',
  orange: '#F97316', purple: '#A855F7', pink: '#EC4899', brown: '#92400E',
  grey: '#6B7280', gray: '#6B7280', black: '#000000', white: '#FFFFFF',
  cyan: '#06B6D4', teal: '#14B8A6', lime: '#84CC16', amber: '#F59E0B',
  indigo: '#6366F1', violet: '#8B5CF6', fuchsia: '#D946EF', rose: '#F43F5E',
  navy: '#1E3A5F', maroon: '#800020', coral: '#FF7F50', gold: '#D4AF37',
  silver: '#C0C0C0', beige: '#F5F5DC', khaki: '#C3B091', ivory: '#FFFFF0',
  burgundy: '#800020', mint: '#98FF98', lavender: '#E6E6FA', peach: '#FFDAB9',
  turquoise: '#40E0D0', salmon: '#FA8072', plum: '#DDA0DD', olive: '#808000',
}

function nameToHex(name: string): string {
  const key = name.toLowerCase().trim()
  if (COLOR_MAP[key]) return COLOR_MAP[key]
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = ((hash % 360) + 360) % 360
  return hslToHex(hue, 55, 45)
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

export function Attributes() {
  const queryClient = useQueryClient()
  const { data: attributes, isLoading } = useQuery({
    queryKey: ['attributes'],
    queryFn: () => attributesApi.list().then(r => r.data),
  })

  const [newName, setNewName] = useState('')
  const [editingAttr, setEditingAttr] = useState<AttributeResponse | null>(null)
  const [valueInput, setValueInput] = useState('')
  const [hexInput, setHexInput] = useState('')

  useEffect(() => {
    if (editingAttr) { setValueInput(''); setHexInput('') }
  }, [editingAttr?.id])

  useEffect(() => {
    if (valueInput.trim() && !hexInput) {
      setHexInput(nameToHex(valueInput.trim()))
    }
  }, [valueInput])

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
    mutationFn: ({ attrId, value, hexCode }: { attrId: string; value: string; hexCode?: string }) =>
      attributesApi.addValue(attrId, { value, hexCode }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attributes'] })
      setValueInput('')
      setHexInput('')
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
    addVal.mutate({ attrId: editingAttr.id, value: val, hexCode: hexInput || undefined })
  }

  const isValidHex = (hex: string) => /^#[0-9a-fA-F]{6}$/.test(hex)

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
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
                      ? attr.values.map(v => (
                        <Badge key={v.id} variant='secondary' className='flex items-center gap-1.5'>
                          {v.hexCode && (
                            <span
                              className='inline-block h-3.5 w-3.5 rounded-full border shrink-0'
                              style={{ backgroundColor: v.hexCode }}
                            />
                          )}
                          {v.value}
                        </Badge>
                      ))
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
                    <Badge variant='outline' className='flex items-center gap-1.5'>
                      {v.hexCode && (
                        <span
                          className='inline-block h-3.5 w-3.5 rounded-full border shrink-0'
                          style={{ backgroundColor: v.hexCode }}
                        />
                      )}
                      {v.value}
                    </Badge>
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

              <form onSubmit={handleAddValue} className='pt-2 border-t space-y-3'>
                <div className='flex gap-2'>
                  <div className='flex-1 space-y-1'>
                    <Label className='text-xs text-muted-foreground'>Value name</Label>
                    <Input
                      placeholder='New value...'
                      value={valueInput}
                      onChange={e => setValueInput(e.target.value)}
                      disabled={addVal.isPending}
                      autoFocus
                    />
                  </div>
                  <div className='w-28 space-y-1'>
                    <Label className='text-xs text-muted-foreground'>Color code</Label>
                    <div className='flex items-center gap-1'>
                      <div className='relative'>
                        <input
                          type='color'
                          value={isValidHex(hexInput) ? hexInput : '#cccccc'}
                          onChange={e => setHexInput(e.target.value)}
                          className='absolute inset-0 h-full w-full cursor-pointer opacity-0'
                          disabled={addVal.isPending}
                        />
                        <span
                          className='inline-block h-9 w-9 rounded-md border cursor-pointer'
                          style={{ backgroundColor: isValidHex(hexInput) ? hexInput : '#cccccc' }}
                        />
                        <Pipette className='absolute inset-0 m-auto h-4 w-4 pointer-events-none text-white mix-blend-difference' />
                      </div>
                      <Input
                        placeholder='#HEX'
                        value={hexInput}
                        onChange={e => setHexInput(e.target.value)}
                        className='flex-1 font-mono text-xs'
                        disabled={addVal.isPending}
                      />
                    </div>
                  </div>
                </div>
                <Button
                  type='submit'
                  size='sm'
                  className='w-full'
                  disabled={!valueInput.trim() || addVal.isPending}
                >
                  {addVal.isPending ? <Loader2 className='h-4 w-4 animate-spin' /> : <Plus className='h-4 w-4' />}
                  Add Value
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
