import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { handleServerError } from '@/lib/handle-server-error'
import { useStores } from '@/features/channels/hooks'
import { categoriesApi } from '@/features/categories/api'
import { useAvailabilityRules, useUpsertRule } from '@/features/channels/distribution-hooks'
import { flattenCategories, type AvailabilityRuleResponse } from '@/features/channels/distribution-api'

interface RuleEditorState {
  mode: 'create' | 'edit'
  categoryId: string
  categoryPath?: string
  available: boolean
  inheritFromParent: boolean
}

/**
 * Store Availability Rules (§11, P3): per-store category rules.
 * Nearest own-value rule wins; inherit-from-parent propagates downward;
 * no rule → external default OFF. NATIVE stores carry no rules (BR-20).
 */
export function AvailabilityRules() {
  const [storeId, setStoreId] = useState<string>('')
  const [editor, setEditor] = useState<RuleEditorState | null>(null)

  const { data: stores } = useStores()
  const external = useMemo(() => (stores ?? []).filter((s) => s.kind !== 'NATIVE'), [stores])
  const effectiveStoreId = storeId || external[0]?.id || ''

  const { data: rules, isLoading } = useAvailabilityRules(effectiveStoreId || undefined)
  const upsertMut = useUpsertRule(effectiveStoreId || undefined)

  const { data: allCats } = useQuery({
    queryKey: ['categories'],
    queryFn: () => categoriesApi.list().then((r) => (Array.isArray(r.data) ? r.data : (r.data as any)?.data || [])),
  })

  const categoryOptions = useMemo(() => {
    const flat = (Array.isArray(allCats) ? allCats : []) as { id: string; name: string; parentId?: string | null }[]
    const byId = new Map(flat.map((c) => [c.id, c]))
    const children = new Map<string, typeof flat>()
    const roots: typeof flat = []
    for (const c of flat) {
      if (c.parentId && byId.has(c.parentId)) {
        const list = children.get(c.parentId) ?? []
        list.push(c)
        children.set(c.parentId, list)
      } else {
        roots.push(c)
      }
    }
    const toNode = (c: (typeof flat)[number]): { id: string; name: string; children?: ReturnType<typeof toNode>[] } => ({
      id: c.id,
      name: c.name,
      children: (children.get(c.id) ?? []).map(toNode),
    })
    return flattenCategories(roots.map(toNode))
  }, [allCats])

  const columns = useMemo<ColumnDef<AvailabilityRuleResponse>[]>(() => [
    {
      accessorKey: 'categoryPath',
      header: 'Category',
      cell: ({ row }) => <span className='font-medium'>{row.original.categoryPath}</span>,
    },
    {
      accessorKey: 'available',
      header: 'Available',
      cell: ({ row }) => (
        <Badge variant={row.original.available ? 'default' : 'secondary'}>
          {row.original.available ? 'ON' : 'OFF'}
        </Badge>
      ),
    },
    {
      accessorKey: 'inheritFromParent',
      header: 'Inheritance',
      cell: ({ row }) => (
        <span className='text-sm text-muted-foreground'>
          {row.original.inheritFromParent ? 'Inherits from parent' : 'Own value'}
        </span>
      ),
    },
    {
      id: 'actions',
      header: () => <div className='text-right'>Actions</div>,
      cell: ({ row }) => (
        <div className='text-right'>
          <Button
            variant='outline'
            size='sm'
            onClick={() =>
              setEditor({
                mode: 'edit',
                categoryId: row.original.categoryId,
                categoryPath: row.original.categoryPath,
                available: row.original.available,
                inheritFromParent: row.original.inheritFromParent,
              })
            }
          >
            Edit
          </Button>
        </div>
      ),
    },
  ], [])

  const table = useReactTable({
    data: rules ?? [],
    columns,
    // Server-backed facet: the store filter is a server query (?storeId=);
    // the rule list for one store is complete, rendered as a single page.
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  })

  const save = () => {
    if (!editor || !effectiveStoreId) return
    upsertMut.mutate(
      {
        categoryId: editor.categoryId,
        storeId: effectiveStoreId,
        available: editor.available,
        inheritFromParent: editor.inheritFromParent,
      },
      {
        onSuccess: () => {
          toast.success('Availability rule saved')
          setEditor(null)
        },
        onError: handleServerError,
      },
    )
  }

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-lg font-semibold'>Store Availability Rules</h2>
        <p className='text-sm text-muted-foreground'>
          Category-level defaults per external store. A manual product override still beats these rules;
          with no rule the store default is off. The native website never reads rules (BR-20).
        </p>
      </div>

      <Card>
        <CardHeader className='flex flex-row items-center justify-between'>
          <div>
            <CardTitle className='text-base'>Rules</CardTitle>
            <CardDescription>Filtered by store on the server (?storeId=).</CardDescription>
          </div>
          <div className='flex gap-2'>
            <Select value={effectiveStoreId} onValueChange={setStoreId}>
              <SelectTrigger className='w-52'>
                <SelectValue placeholder='Select store' />
              </SelectTrigger>
              <SelectContent>
                {external.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} ({s.kind})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size='sm'
              disabled={!effectiveStoreId}
              onClick={() => setEditor({ mode: 'create', categoryId: '', available: true, inheritFromParent: false })}
            >
              New rule
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <Loader2 className='h-4 w-4 animate-spin' /> Loading rules…
            </div>
          ) : (
            <Table>
              <TableHeader>
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => (
                      <TableHead key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.length ? (
                  table.getRowModel().rows.map((r) => (
                    <TableRow key={r.id}>
                      {r.getVisibleCells().map((c) => (
                        <TableCell key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className='h-24 text-center text-muted-foreground'>
                      No rules for this store — products fall back to manual overrides, then default off.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Sheet open={editor !== null} onOpenChange={(v) => { if (!v) setEditor(null) }}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{editor?.mode === 'create' ? 'New rule' : 'Edit rule'}</SheetTitle>
            <SheetDescription>
              {editor?.mode === 'edit'
                ? `Category: ${editor?.categoryPath}`
                : 'Pick a category. An explicit toggle is an own value (inherit off) unless inheritance is enabled.'}
            </SheetDescription>
          </SheetHeader>
          <div className='mt-4 flex flex-col gap-4'>
            {editor?.mode === 'create' && (
              <Select value={editor.categoryId} onValueChange={(v) => setEditor({ ...editor, categoryId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder='Select category' />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {'\u00A0\u00A0'.repeat(o.depth)}{o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className='flex items-center justify-between'>
              <Label>Available on this store</Label>
              <Switch
                checked={editor?.available ?? true}
                onCheckedChange={(v) => editor && setEditor({ ...editor, available: v })}
              />
            </div>
            <div className='flex items-center justify-between'>
              <div>
                <Label>Inherit from parent</Label>
                <p className='text-xs text-muted-foreground'>On: this row defers to the nearest parent rule.</p>
              </div>
              <Switch
                checked={editor?.inheritFromParent ?? false}
                onCheckedChange={(v) => editor && setEditor({ ...editor, inheritFromParent: v })}
              />
            </div>
            <Button disabled={upsertMut.isPending || (editor?.mode === 'create' && !editor?.categoryId)} onClick={save}>
              Save rule
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}
