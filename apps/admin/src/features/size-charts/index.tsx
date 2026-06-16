import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { Search } from '@/components/search'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Loader2, Plus, Pencil, Trash2, Ruler, X, Image as ImageIcon, Columns } from 'lucide-react'
import { MediaPicker } from '@/components/media-picker'
import { mediaUrl } from '@/lib/utils'
import { SafeImage } from '@/components/safe-image'

const sizeChartsApi = {
  list: () => apiClient.get('/size-charts'),
  create: (d: Record<string, unknown>) => apiClient.post('/size-charts', d),
  update: (id: string, d: Record<string, unknown>) => apiClient.put(`/size-charts/${id}`, d),
  delete: (id: string) => apiClient.delete(`/size-charts/${id}`),
}

interface TableRowData {
  [key: string]: string
}

export function SizeCharts() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null)
  const [form, setForm] = useState({ name: '', description: '', image: '', isActive: 'true' })
  const [columns, setColumns] = useState<string[]>(['Size', 'Chest', 'Length'])
  const [rows, setRows] = useState<TableRowData[]>([{ Size: 'S', Chest: '36"', Length: '28"' }])
  const [pickerOpen, setPickerOpen] = useState(false)

  const { data: sizeCharts, isLoading } = useQuery({ queryKey: ['size-charts'], queryFn: () => sizeChartsApi.list().then(r => r.data) })

  const saveMut = useMutation({
    mutationFn: (d: Record<string, unknown>) => editing ? sizeChartsApi.update(editing['id'] as string, d) : sizeChartsApi.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['size-charts'] }); setOpen(false); setEditing(null); resetForm(); toast.success(editing ? 'Updated' : 'Created') },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => sizeChartsApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['size-charts'] }); toast.success('Deleted') },
  })

  const resetForm = () => {
    setForm({ name: '', description: '', image: '', isActive: 'true' })
    setColumns(['Size', 'Chest', 'Length'])
    setRows([{ Size: 'S', Chest: '36"', Length: '28"' }])
  }

  const openEdit = (c: Record<string, unknown>) => {
    setEditing(c)
    setForm({
      name: c['name'] as string,
      description: c['description'] as string || '',
      image: c['image'] as string || '',
      isActive: c['isActive'] ? 'true' : 'false',
    })
    const td = c['tableData'] as TableRowData[] | null
    if (td && td.length > 0) {
      setColumns(Object.keys(td[0]))
      setRows(td)
    } else {
      setColumns(['Size', 'Chest', 'Length'])
      setRows([{ Size: 'S', Chest: '36"', Length: '28"' }])
    }
    setOpen(true)
  }

  const handleSave = () => {
    const tableData = rows.map(r => {
      const row: TableRowData = {}
      for (const col of columns) {
        row[col] = r[col] || ''
      }
      return row
    })
    saveMut.mutate({
      name: form.name,
      description: form.description || undefined,
      image: form.image || undefined,
      isActive: form.isActive === 'true',
      tableData,
    })
  }

  const addColumn = () => {
    const name = `Col ${columns.length + 1}`
    setColumns([...columns, name])
    setRows(rows.map(r => ({ ...r, [name]: '' })))
  }

  const removeColumn = (i: number) => {
    const colName = columns[i]
    setColumns(columns.filter((_, idx) => idx !== i))
    setRows(rows.map(r => {
      const { [colName]: _, ...rest } = r
      return rest
    }))
  }

  const renameColumn = (i: number, name: string) => {
    const oldName = columns[i]
    const newName = name || `Col ${i + 1}`
    setColumns(columns.map((c, idx) => idx === i ? newName : c))
    setRows(rows.map(r => {
      if (oldName in r) {
        const { [oldName]: val, ...rest } = r
        return { ...rest, [newName]: val }
      }
      return r
    }))
  }

  const addRow = () => {
    const row: TableRowData = {}
    for (const col of columns) row[col] = ''
    setRows([...rows, row])
  }

  const removeRow = (i: number) => {
    setRows(rows.filter((_, idx) => idx !== i))
  }

  const updateCell = (rowIdx: number, colName: string, value: string) => {
    setRows(rows.map((r, idx) => idx === rowIdx ? { ...r, [colName]: value } : r))
  }

  const list = Array.isArray(sizeCharts) ? sizeCharts : (sizeCharts as { data?: unknown[] })?.data || []

  return (
    <>
      <Header fixed><Search className='me-auto' /><ThemeSwitch /><ProfileDropdown /></Header>
      <Main className='flex flex-1 flex-col gap-6'>
        <div className='flex items-end justify-between'>
          <div><h2 className='text-2xl font-bold tracking-tight'>Size Charts</h2><p className='text-muted-foreground'>Create and manage size charts for products.</p></div>
          <Button size='sm' onClick={() => { resetForm(); setEditing(null); setOpen(true) }}><Plus className='h-4 w-4 mr-1' /> Add</Button>
        </div>
        <Card><CardContent className='p-0'>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Description</TableHead><TableHead>Columns</TableHead><TableHead>Active</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {isLoading ? <TableRow><TableCell colSpan={5} className='text-center py-8'><Loader2 className='animate-spin h-6 w-6 mx-auto' /></TableCell></TableRow> :
               list.length ? list.map((c: Record<string, unknown>) => (
                <TableRow key={c['id'] as string}>
                  <TableCell className='font-medium'><div className='flex items-center gap-2'><Ruler className='h-4 w-4 text-muted-foreground' />{c['name'] as string}</div></TableCell>
                  <TableCell className='text-muted-foreground max-w-[200px] truncate'>{c['description'] as string || '—'}</TableCell>
                  <TableCell>
                    {(() => {
                      const td = c['tableData'] as unknown[]
                      if (!td || td.length === 0) return <span className='text-muted-foreground'>—</span>
                      const cols = Object.keys(td[0] as object)
                      return <Badge variant='outline'>{cols.length} cols / {td.length} rows</Badge>
                    })()}
                  </TableCell>
                  <TableCell><Badge className={c['isActive'] ? 'bg-green-500' : ''}>{c['isActive'] ? 'Active' : 'Inactive'}</Badge></TableCell>
                  <TableCell className='flex gap-1'>
                    <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => openEdit(c as Record<string, unknown>)}><Pencil className='h-3.5 w-3.5' /></Button>
                    <Button variant='ghost' size='icon' className='h-7 w-7' onClick={() => deleteMut.mutate(c['id'] as string)}><Trash2 className='h-3.5 w-3.5 text-destructive' /></Button>
                  </TableCell>
                </TableRow>
               )) : <TableRow><TableCell colSpan={5} className='text-center py-8 text-muted-foreground'>No size charts yet</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent></Card>
      </Main>

      <Dialog open={open} onOpenChange={v => { if (!v) { setOpen(false); setEditing(null) } }}>
        <DialogContent className='max-w-3xl max-h-[90vh] overflow-y-auto'>
          <DialogHeader><DialogTitle>{editing ? 'Edit Size Chart' : 'New Size Chart'}</DialogTitle></DialogHeader>
          <div className='space-y-4 py-2'>
            <div className='grid grid-cols-2 gap-4'>
              <div>
                <Label>Name</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder='e.g. Men T-Shirt Size Guide' />
              </div>
              <div>
                <Label>Active</Label>
                <div className='flex items-center gap-2 mt-2'>
                  <Switch checked={form.isActive === 'true'} onCheckedChange={v => setForm({ ...form, isActive: v ? 'true' : 'false' })} />
                  <span className='text-sm text-muted-foreground'>{form.isActive === 'true' ? 'Visible on storefront' : 'Hidden'}</span>
                </div>
              </div>
            </div>
            <div>
              <Label>Description</Label>
              <Textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder='Optional description or instructions' rows={2} />
            </div>

            <div className='border rounded-lg overflow-hidden'>
              <div className='bg-muted/20 px-4 py-2 flex items-center justify-between border-b'>
                <div className='flex items-center gap-2 text-sm font-medium'>
                  <Columns className='h-4 w-4 text-muted-foreground' />
                  Table Data
                </div>
                <div className='flex gap-2'>
                  <Button variant='outline' size='sm' onClick={addColumn} className='h-7 text-xs'>
                    <Plus className='h-3 w-3 mr-1' /> Column
                  </Button>
                  <Button variant='outline' size='sm' onClick={addRow} className='h-7 text-xs'>
                    <Plus className='h-3 w-3 mr-1' /> Row
                  </Button>
                </div>
              </div>
              <div className='overflow-x-auto p-1'>
                <table className='w-full border-collapse'>
                  <thead>
                    <tr>
                      {columns.map((col, i) => (
                        <th key={i} className='p-1 border border-gray-200 bg-gray-50 min-w-[100px]'>
                          <div className='flex items-center gap-1'>
                            <Input
                              value={col}
                              onChange={e => renameColumn(i, e.target.value)}
                              className='h-7 text-xs font-medium px-2 border-0 bg-transparent focus:bg-white'
                              placeholder={`Col ${i + 1}`}
                            />
                            {columns.length > 1 && (
                              <button onClick={() => removeColumn(i)} className='shrink-0 p-0.5 rounded hover:bg-red-100 text-muted-foreground hover:text-red-500'>
                                <X className='h-3 w-3' />
                              </button>
                            )}
                          </div>
                        </th>
                      ))}
                      <th className='w-10 p-1 border border-gray-200 bg-gray-50' />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, rowIdx) => (
                      <tr key={rowIdx}>
                        {columns.map((col, colIdx) => (
                          <td key={colIdx} className='p-1 border border-gray-200'>
                            <Input
                              value={row[col] || ''}
                              onChange={e => updateCell(rowIdx, col, e.target.value)}
                              className='h-8 text-xs px-2 border-0 focus:bg-white'
                              placeholder='—'
                            />
                          </td>
                        ))}
                        <td className='p-1 border border-gray-200 text-center'>
                          <button onClick={() => removeRow(rowIdx)} className='p-1 rounded hover:bg-red-100 text-muted-foreground hover:text-red-500'>
                            <Trash2 className='h-3 w-3' />
                          </button>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={columns.length + 1} className='p-6 text-center text-sm text-muted-foreground'>
                          No rows. Click "Add Row" to add data.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className='space-y-2'>
              <Label>Image (optional)</Label>
              <div className='flex items-center gap-2'>
                <div className='h-14 w-14 rounded border overflow-hidden bg-muted shrink-0 flex items-center justify-center'>
                  {form.image
                    ? <SafeImage src={mediaUrl(form.image)} alt='' className='h-full w-full object-cover' />
                    : <ImageIcon className='h-5 w-5 text-muted-foreground' />}
                </div>
                <Button type='button' variant='outline' size='sm' onClick={() => setPickerOpen(true)}>
                  {form.image ? 'Change' : 'Choose'} image
                </Button>
                {form.image && (
                  <Button type='button' variant='ghost' size='icon' onClick={() => setForm({ ...form, image: '' })}>
                    <X className='h-4 w-4' />
                  </Button>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => { setOpen(false); setEditing(null) }}>Cancel</Button>
            <Button onClick={handleSave} disabled={!form.name}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MediaPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        selected={form.image ? [form.image] : []}
        multiple={false}
        onSelect={(urls) => {
          setForm(prev => ({ ...prev, image: urls[urls.length - 1] || '' }))
          setPickerOpen(false)
        }}
      />
    </>
  )
}
