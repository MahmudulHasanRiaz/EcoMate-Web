import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Boxes, RefreshCw } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from '@/components/ui/table'

function money(n: number | string | null | undefined, currency: string) {
  const v = typeof n === 'string' ? parseFloat(n) : (n ?? 0)
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(v)
}

const fmtUSD = (n: number | string | null | undefined) => money(n, 'USD')
const fmtBDT = (n: number | string | null | undefined) => money(n, 'BDT')

const dayOffset = (days: number) => {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

interface ProductSnapshotRow {
  productId: string
  productName: string
  spend: number
  revenue: number
  cost: number
  profit: number
  orders: number
  quantity: number
  roas: number | null
  margin: number | null
}

export function SpendSnapshots() {
  const queryClient = useQueryClient()
  const [fromDate, setFromDate] = useState(dayOffset(29))
  const [toDate, setToDate] = useState(dayOffset(0))

  const { data: snapshots, isLoading } = useQuery({
    queryKey: ['marketing-snapshot-products', fromDate, toDate],
    queryFn: () =>
      apiClient
        .get('/marketing/snapshots/products', { params: { fromDate, toDate } })
        .then((r) => r.data.data as ProductSnapshotRow[]),
  })

  const rebuildMut = useMutation({
    mutationFn: () =>
      apiClient
        .post('/marketing/snapshots/products/rebuild', null, { params: { fromDate, toDate } })
        .then((r) => r.data as { rebuilt: number }),
    onSuccess: (res) => {
      toast.success(`Snapshots rebuilt: ${res.rebuilt} product-day rows`)
      queryClient.invalidateQueries({ queryKey: ['marketing-snapshot-products'] })
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Rebuild failed'),
  })

  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <Boxes className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Spend Snapshots</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={rebuildMut.isPending} onClick={() => rebuildMut.mutate()}>
            <RefreshCw className={`mr-1 h-4 w-4 ${rebuildMut.isPending ? 'animate-spin' : ''}`} />
            Rebuild snapshots
          </Button>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-end gap-3 p-4">
            <label className="text-xs text-muted-foreground">
              From
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="mt-1 block h-9 rounded-md border bg-background px-3 text-sm"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              To
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="mt-1 block h-9 rounded-md border bg-background px-3 text-sm"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Product-level daily cost/profit from recorded allocations. Rebuild to refresh the window.
            </p>
          </CardContent>
        </Card>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!isLoading && (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead className="text-right">Spend</TableHead>
                    <TableHead className="text-right">Revenue</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Profit</TableHead>
                    <TableHead className="text-right">Orders</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">ROAS</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(snapshots ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={8} className="py-6 text-center text-sm text-muted-foreground">
                      No snapshots for this window yet — run "Rebuild snapshots".
                    </TableCell></TableRow>
                  )}
                  {(snapshots ?? []).map((s) => (
                    <TableRow key={s.productId}>
                      <TableCell className="text-sm font-medium">{s.productName}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtUSD(s.spend)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtBDT(s.revenue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtBDT(s.cost)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${s.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {fmtBDT(s.profit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{s.orders}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.roas !== null ? s.roas.toFixed(2) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </Main>
    </>
  )
}