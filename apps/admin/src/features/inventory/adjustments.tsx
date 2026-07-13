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

interface AdjustmentLog {
  id: string
  productId: string
  variantId: string | null
  variantName?: string | null
  quantity: number
  direction: string
  type: string
  stockBefore: number
  stockAfter: number
  note: string | null
  performedBy: string
  performedAt: string
  productName: string
  warehouseName?: string
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

  const { data: logsData, isLoading, isError } = useQuery<LogsResponse>({
    queryKey: ['inventory-adjustment-logs', page],
    queryFn: () =>
      apiClient.get('/inventory/logs', { params: { type: 'adjustment', page, perPage: 15 } }).then(r => r.data),
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
            <h1 className='text-2xl font-bold tracking-tight'>Adjustment History</h1>
            <p className='text-muted-foreground'>Audit trail of all physical inventory adjustments.</p>
          </div>
        </div>

        <div className="flex items-center gap-4 bg-muted/30 p-2 rounded-lg border">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search adjustment ID..." className="pl-9 bg-background" />
          </div>
          <Select defaultValue="all_wh">
            <SelectTrigger className="w-[180px] bg-background">
              <SelectValue placeholder="Warehouse" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_wh">All Warehouses</SelectItem>
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
                        <div className="text-xs text-muted-foreground">{log.note || '—'}</div>
                      </div>
                    </TableCell>
                    <TableCell>{log.warehouseName || '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">{log.type}</Badge>
                    </TableCell>
                    <TableCell>
                      <span className={log.direction === 'IN' ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                        {log.direction === 'IN' ? '+' : ''}{log.quantity}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.stockBefore}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.stockAfter}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(log.performedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{log.performedBy}</TableCell>
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
