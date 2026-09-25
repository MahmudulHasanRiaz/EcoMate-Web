import { useEffect, useMemo, useState } from 'react'
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { toast } from 'sonner'
import { Loader2, Package, Pencil } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { handleServerError } from '@/lib/handle-server-error'
import { useProductsQuery } from '@/features/products/hooks'
import {
  DISTRIBUTION_KEYS,
  useBulkAvailability,
  useBulkJob,
  useProductAvailability,
  useSetAvailability,
} from './distribution-hooks'
import {
  DISABLE_ALL_CONFIRM_TEXT,
  availabilitySourceLabel,
  isDisableConfirmValid,
  type BulkJobStatus,
  type StoreAvailabilityRow,
} from './distribution-api'
import { useQueryClient } from '@tanstack/react-query'

function EffectiveBadge({ effective }: { effective: boolean }) {
  return effective ? <Badge variant='default'>Available</Badge> : <Badge variant='muted'>Off</Badge>
}

/**
 * Product Store Availability (§11, P3): per-product × store matrix.
 * Precedence: global AND (manual override ?? category rule ?? default off);
 * NATIVE rows are global-only (BR-20) and carry no actions.
 */
export function ProductAvailability() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [productId, setProductId] = useState<string | null>(null)
  const [productName, setProductName] = useState('')
  const [editRow, setEditRow] = useState<StoreAvailabilityRow | null>(null)
  const [bulkAction, setBulkAction] = useState<'all_on' | 'all_off' | null>(null)
  const [disableConfirm, setDisableConfirm] = useState('')
  const [jobId, setJobId] = useState<string | null>(null)

  const { data: products, isFetching: searching } = useProductsQuery({ search, perPage: 8, status: 'active' })
  const { data: view, isLoading } = useProductAvailability(productId)
  const setMut = useSetAvailability(productId ?? '')
  const bulkMut = useBulkAvailability(productId ?? '')
  const { data: job } = useBulkJob(productId ?? '', jobId, jobId !== null)

  const rows = useMemo(() => view?.stores ?? [], [view])

  const columns = useMemo<ColumnDef<StoreAvailabilityRow>[]>(() => [
    {
      accessorKey: 'name',
      header: 'Store',
      cell: ({ row }) => <span className='font-medium'>{row.original.name}</span>,
    },
    {
      accessorKey: 'kind',
      header: 'Type',
      cell: ({ row }) => <Badge variant='outline'>{row.original.kind}</Badge>,
    },
    {
      id: 'source',
      header: 'Decided by',
      cell: ({ row }) => (
        <span className='text-sm text-muted-foreground'>{availabilitySourceLabel(row.original)}</span>
      ),
    },
    {
      id: 'override',
      header: 'Override',
      cell: ({ row }) =>
        row.original.overrideAvailable === null ? (
          <span className='text-sm text-muted-foreground'>—</span>
        ) : (
          <Badge variant={row.original.overrideAvailable ? 'default' : 'secondary'}>
            {row.original.overrideAvailable ? 'ON' : 'OFF'}
          </Badge>
        ),
    },
    {
      id: 'rule',
      header: 'Rule',
      cell: ({ row }) =>
        row.original.ruleAvailable === null ? (
          <span className='text-sm text-muted-foreground'>—</span>
        ) : (
          <Badge variant={row.original.ruleAvailable ? 'default' : 'secondary'}>
            {row.original.ruleAvailable ? 'ON' : 'OFF'}
          </Badge>
        ),
    },
    {
      accessorKey: 'effective',
      header: 'Effective',
      cell: ({ row }) => <EffectiveBadge effective={row.original.effective} />,
    },
    {
      id: 'actions',
      header: () => <div className='text-right'>Actions</div>,
      cell: ({ row }) =>
        row.original.kind === 'NATIVE' ? (
          <div className='text-right text-xs text-muted-foreground'>Global only</div>
        ) : (
          <div className='text-right'>
            <Button variant='outline' size='sm' onClick={() => setEditRow(row.original)}>
              <Pencil className='mr-1 h-3 w-3' /> Override
            </Button>
          </div>
        ),
    },
  ], [])

  const table = useReactTable({
    data: rows,
    columns,
    // The server returns the complete per-product store list (store counts
    // are small); pagination is manual with a single server-backed page.
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  })

  const pickProduct = (id: string, name: string) => {
    setProductId(id)
    setProductName(name)
    setSearch('')
    setJobId(null)
  }

  const saveOverride = (available: boolean | null) => {
    if (!productId || !editRow) return
    setMut.mutate(
      { storeId: editRow.storeId, available },
      {
        onSuccess: () => {
          toast.success(available === null ? 'Override cleared — rule/default applies' : `Override ${available ? 'ON' : 'OFF'} saved`)
          setEditRow(null)
        },
        onError: handleServerError,
      },
    )
  }

  const runBulk = () => {
    if (!productId || !bulkAction) return
    bulkMut.mutate(
      { action: bulkAction, confirm: bulkAction === 'all_off' ? disableConfirm : undefined },
      {
        onSuccess: (res) => {
          if (res.enqueued && res.jobId) {
            setJobId(res.jobId)
            toast.info(`Bulk update queued (${res.total} stores) — processing in background`)
          } else {
            const nativeNote = res.excludedNativeCount > 0 ? ` (${res.excludedNativeCount} native skipped)` : ''
            toast.success(`${res.updated} store(s) updated${nativeNote}`)
          }
          setBulkAction(null)
          setDisableConfirm('')
        },
        onError: handleServerError,
      },
    )
  }

  const onJobDone = (j: BulkJobStatus) => {
    if (productId) queryClient.invalidateQueries({ queryKey: DISTRIBUTION_KEYS.availability(productId) })
    setJobId(null)
    if (j.status === 'DONE') {
      toast.success(`Background bulk update finished: ${j.done} updated${j.failed > 0 ? `, ${j.failed} failed` : ''}`)
    } else {
      handleServerError(new Error(j.error || 'Background bulk update failed'))
    }
  }

  const jobStatus = job?.status
  useEffect(() => {
    if ((jobStatus === 'DONE' || jobStatus === 'FAILED') && job) onJobDone(job)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobStatus])

  return (
    <>
      <Header fixed>
        <div className='flex items-center gap-2'>
          <Package className='h-5 w-5' />
          <h1 className='font-semibold'>Product Store Availability</h1>
        </div>
        <div className='ml-auto flex items-center gap-2'>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <Card>
          <CardHeader>
            <CardTitle className='text-base'>Product</CardTitle>
            <CardDescription>
              Pick a product to resolve per-store availability. Final = global (active + published) AND
              (manual override ?? category rule ?? default off). The native website follows global only (BR-20).
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-2'>
            <Input
              placeholder='Search products…'
              value={productId ? productName : search}
              onChange={(e) => { setProductId(null); setSearch(e.target.value) }}
            />
            {!productId && search.trim() !== '' && (
              <div className='rounded-md border'>
                {searching && <div className='p-3 text-sm text-muted-foreground'>Searching…</div>}
                {(products?.data ?? []).map((p) => (
                  <button
                    key={p.id}
                    className='block w-full px-3 py-2 text-left text-sm hover:bg-accent'
                    onClick={() => pickProduct(p.id, p.name)}
                  >
                    {p.name}
                  </button>
                ))}
                {!searching && (products?.data ?? []).length === 0 && (
                  <div className='p-3 text-sm text-muted-foreground'>No products found.</div>
                )}
              </div>
            )}
            {productId && (
              <div className='text-sm'>
                Selected: <span className='font-medium'>{productName}</span>{' '}
                <button className='underline' onClick={() => setProductId(null)}>change</button>
              </div>
            )}
          </CardContent>
        </Card>

        {productId && (
          <Card className='mt-4'>
            <CardHeader className='flex flex-row items-center justify-between'>
              <div>
                <CardTitle className='text-base'>Store matrix</CardTitle>
                <CardDescription>
                  {view && !view.globalActive && 'Product is globally off (draft/inactive) — every store resolves Off.'}
                </CardDescription>
              </div>
              <div className='flex gap-2'>
                <Button variant='outline' size='sm' onClick={() => setBulkAction('all_on')}>
                  Available on all stores
                </Button>
                <Button variant='destructive' size='sm' onClick={() => setBulkAction('all_off')}>
                  Disable on all stores
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className='flex items-center gap-2 text-sm text-muted-foreground'>
                  <Loader2 className='h-4 w-4 animate-spin' /> Loading availability…
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
                        <TableCell colSpan={7} className='h-24 text-center text-muted-foreground'>
                          No stores yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              )}
              {job?.status === 'RUNNING' && (
                <div className='mt-2 flex items-center gap-2 text-sm text-muted-foreground'>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  Background job: {job.done}/{job.total} stores…
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </Main>

      <Sheet open={editRow !== null} onOpenChange={(v) => { if (!v) setEditRow(null) }}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Store override</SheetTitle>
            <SheetDescription>
              {editRow?.name}: a manual override beats the category rule. Clearing falls back to rule ?? default off.
              Overrides never publish to NATIVE and never change the product itself.
            </SheetDescription>
          </SheetHeader>
          <div className='mt-4 flex flex-col gap-2'>
            <Button disabled={setMut.isPending} onClick={() => saveOverride(true)}>Available ON</Button>
            <Button disabled={setMut.isPending} variant='secondary' onClick={() => saveOverride(false)}>
              Available OFF
            </Button>
            <Button disabled={setMut.isPending} variant='ghost' onClick={() => saveOverride(null)}>
              Clear override (use rule)
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={bulkAction !== null}
        onOpenChange={(v) => { if (!v) { setBulkAction(null); setDisableConfirm('') } }}
        title={bulkAction === 'all_off' ? 'Disable on all stores?' : 'Available on all stores?'}
        desc={
          bulkAction === 'all_off'
            ? 'This turns the product OFF on every external store (native excluded). Type DISABLE to confirm.'
            : 'This turns the product ON on every external store where the global product is active (native excluded).'
        }
        confirmText={bulkAction === 'all_off' ? 'Disable everywhere' : 'Enable everywhere'}
        destructive={bulkAction === 'all_off'}
        isLoading={bulkMut.isPending}
        disabled={bulkAction === 'all_off' && !isDisableConfirmValid(disableConfirm)}
        handleConfirm={runBulk}
      >
        {bulkAction === 'all_off' && (
          <Input
            placeholder={DISABLE_ALL_CONFIRM_TEXT}
            value={disableConfirm}
            onChange={(e) => setDisableConfirm(e.target.value)}
          />
        )}
      </ConfirmDialog>
    </>
  )
}
