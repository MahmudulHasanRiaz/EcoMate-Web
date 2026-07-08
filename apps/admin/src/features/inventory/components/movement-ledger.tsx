import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Filter, Download, ExternalLink, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface LedgerEntry {
  id: string
  productId: string
  variantId: string | null
  comboId: string | null
  quantity: number
  direction: 'IN' | 'OUT'
  type: string
  stockBefore: number
  stockAfter: number
  referenceType: string | null
  referenceId: string | null
  note: string | null
  performedBy: string | null
  performedAt: string
  createdAt: string
}

interface LedgerResponse {
  data: LedgerEntry[]
  meta: {
    total: number
    page: number
    perPage: number
    totalPages: number
  }
}

const typeLabels: Record<string, string> = {
  MANUAL_ADD: 'Manual Add',
  MANUAL_REMOVE: 'Manual Remove',
  SALE: 'Sale',
  PURCHASE: 'Purchase',
  RETURN: 'Return',
  TRANSFER_IN: 'Transfer In',
  TRANSFER_OUT: 'Transfer Out',
  INITIAL: 'Initial Balance',
  CORRECTION: 'Correction',
}

interface MovementLedgerProps {
  productId?: string
  variantId?: string
}

export function MovementLedger({ productId, variantId }: MovementLedgerProps) {
  const [page, setPage] = useState(1)
  const perPage = 20

  const { data, isLoading, isError } = useQuery<LedgerResponse>({
    queryKey: ['inventory-ledger', productId, variantId, page],
    queryFn: () =>
      apiClient
        .get('/inventory/ledger', {
          params: { productId, variantId, page, perPage },
        })
        .then((r) => r.data),
    enabled: !!productId,
  })

  const entries = data?.data ?? []
  const meta = data?.meta

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2">
            <Filter className="h-4 w-4" /> Filters:
          </div>
          <Select defaultValue="all_types">
            <SelectTrigger className="h-9 w-[150px] bg-background"><SelectValue placeholder="Movement Type" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all_types">All Types</SelectItem>
              <SelectItem value="receipt">Purchase Receipts</SelectItem>
              <SelectItem value="transfer">Transfers</SelectItem>
              <SelectItem value="adjustment">Adjustments</SelectItem>
              <SelectItem value="sale">Sales Dispatch</SelectItem>
              <SelectItem value="return">Customer Returns</SelectItem>
            </SelectContent>
          </Select>
          <Select defaultValue="all_wh">
            <SelectTrigger className="h-9 w-[150px] bg-background"><SelectValue placeholder="Warehouse" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all_wh">All Warehouses</SelectItem>
              <SelectItem value="main">Main Warehouse</SelectItem>
              <SelectItem value="retail">Retail Store</SelectItem>
            </SelectContent>
          </Select>
          <Input placeholder="Ref / Lot / User..." className="h-9 w-[180px] bg-background" />
          <Input type="date" className="h-9 w-[150px] bg-background" />
        </div>
        <Button variant="outline" size="sm">
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Location & Lot</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>User / Audit</TableHead>
              <TableHead className="text-right">Qty Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  <Loader2 className="animate-spin h-6 w-6 mx-auto" />
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-destructive">
                  Failed to load ledger entries.
                </TableCell>
              </TableRow>
            ) : entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  No ledger entries found.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="text-sm font-medium">{formatDate(entry.performedAt)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 text-sm text-blue-600 hover:underline cursor-pointer">
                      {entry.referenceId || '-'} <ExternalLink className="h-3 w-3" />
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">-</div>
                    <div className="text-xs text-muted-foreground">-</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={entry.direction === 'IN' ? 'default' : 'destructive'} className="text-xs">
                      {typeLabels[entry.type] || entry.type}
                    </Badge>
                    {entry.note && <div className="text-[10px] text-muted-foreground mt-1">{entry.note}</div>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{entry.performedBy || 'System'}</TableCell>
                  <TableCell
                    className={`text-right font-bold ${entry.direction === 'IN' ? 'text-green-600' : 'text-red-600'}`}
                  >
                    {entry.direction === 'IN' ? '+' : '-'}
                    {entry.quantity}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {meta && meta.totalPages > 0 && (
        <div className="flex items-center justify-between text-sm">
          <div className="text-muted-foreground">
            Page {meta.page} of {meta.totalPages} ({meta.total} total)
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= (meta.totalPages || 1)}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
