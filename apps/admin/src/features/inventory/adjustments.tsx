import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Search, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { UserBadge } from '@/components/user-badge'
import { PageInfo } from '@/components/page-info'

interface AdjustmentLog {
  id: string
  productId: string
  variantId: string | null
  variantName?: string | null
  quantity: number
  direction: string
  type: string
  reason?: string | null
  stockBefore: number
  stockAfter: number
  note: string | null
  performedBy: string
  performedAt: string
  productName: string
  warehouseName?: string
}

/**
 * Human labels for the reason codes / adjustment types the ledgers store
 * (the page used to print raw codes like "physical_count" /
 * "Physical_adjustment"). Unknown codes fall back to a title-cased
 * rendering of the raw value instead of leaking the snake_case code.
 */
const ADJUSTMENT_LABELS: Record<string, string> = {
  physical_count: 'Physical Count',
  physical_adjustment: 'Physical Adjustment',
  adjustment: 'Adjustment',
  damage: 'Damage',
  lost: 'Lost',
  found: 'Found',
  correction: 'Correction',
  initial: 'Initial Balance',
  other: 'Other',
}

function humanLabel(code: string | null | undefined): string {
  if (!code) return '—'
  return (
    ADJUSTMENT_LABELS[code.toLowerCase()] ??
    code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  )
}

interface PaginationMeta {
  total: number
  page: number
  perPage: number
  totalPages: number
}

interface LogsResponse {
  data: AdjustmentLog[]
  meta: PaginationMeta
}

export function Adjustments() {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [warehouseId, setWarehouseId] = useState('all_wh')

  const { data: warehouses } = useQuery<any[]>({
    queryKey: ['warehouses'],
    queryFn: () => apiClient.get('/warehouses').then(r => r.data?.data || r.data || []),
  })

  const { data: logsData, isLoading, isError } = useQuery<LogsResponse>({
    queryKey: ['inventory-adjustment-logs', page, search, warehouseId],
    queryFn: () =>
      apiClient.get('/inventory/logs', {
        params: {
          type: 'adjustment',
          page,
          perPage: 15,
          search: search || undefined,
          warehouseId: warehouseId !== 'all_wh' ? warehouseId : undefined,
        },
      }).then(r => r.data),
  })

  const logs = logsData?.data ?? []
  const meta = logsData?.meta
  const totalPages = meta?.totalPages ?? 1

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      <Main className='flex flex-col gap-6'>
        <div className='flex items-center justify-between'>
          <div>
            <div className='flex items-center gap-1.5'>
              <h1 className='text-2xl font-bold tracking-tight'>Adjustment History</h1>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 bg-muted/30 p-2 rounded-lg border">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search product, adjustment ID or reason..."
              className="pl-9 bg-background"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
          <Select value={warehouseId} onValueChange={(v) => { setWarehouseId(v); setPage(1) }}>
            <SelectTrigger className="w-[180px] bg-background">
              <SelectValue placeholder="Warehouse" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_wh">All Warehouses</SelectItem>
              {(warehouses || []).map((w: any) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Adjustment ID</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Stock Before</TableHead>
                <TableHead>Stock After</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Auditor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={9} className='text-center py-8'>
                    <Loader2 className='animate-spin h-6 w-6 mx-auto' />
                  </TableCell>
                </TableRow>
              ) : isError ? (
                <TableRow>
                  <TableCell colSpan={9} className='text-center py-8 text-destructive'>
                    Failed to load adjustments. Try again.
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className='text-center py-12 text-muted-foreground'>
                    No adjustments found.
                  </TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-medium">{log.id.slice(0, 8).toUpperCase()}</TableCell>
                    <TableCell>
                      <div>
                        <div className="font-medium text-sm">{log.productName}{log.variantName ? ` — ${log.variantName}` : ''}</div>
                        <div className="text-xs text-muted-foreground">
                          {[log.reason ? humanLabel(log.reason) : null, log.note].filter(Boolean).join(' — ') || '—'}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{log.warehouseName || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{humanLabel(log.type)}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={log.direction === 'IN' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                        {log.direction === 'IN' ? '+' : '-'}{log.quantity}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.stockBefore}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.stockAfter}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(log.performedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {log.performedBy && log.performedBy.toLowerCase() !== 'system' ? (
                        <UserBadge email={log.performedBy} showEmail={false} size="sm" />
                      ) : (
                        <Badge variant="secondary" className="text-[10px] h-4">System</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {meta && totalPages > 1 && (
          <div className='flex items-center justify-center gap-4'>
            <Button variant='outline' size='sm' onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>
              <ChevronLeft className='h-4 w-4' />
            </Button>
            <span className='text-sm text-muted-foreground'>
              Page {meta.page} of {totalPages} ({meta.total} total)
            </span>
            <Button variant='outline' size='sm' onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
              <ChevronRight className='h-4 w-4' />
            </Button>
          </div>
        )}
      </Main>
    </>
  )
}
