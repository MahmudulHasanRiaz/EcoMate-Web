import { useState } from 'react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Filter, Download, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function MovementLedger() {
  const ledgerData = [
    { id: '1', date: '2026-07-08 10:00 AM', refType: 'Purchase Receipt', refId: 'GRN-2026-104', location: 'Main Warehouse', lot: 'L-2023-11', user: 'Admin', qty: 100, cost: 150 },
    { id: '2', date: '2026-07-07 02:30 PM', refType: 'Transfer', refId: 'TRF-0012', location: 'Retail Store', lot: 'L-2023-12', user: 'System', qty: 35, cost: 150 },
    { id: '3', date: '2026-07-05 11:15 AM', refType: 'Adjustment', refId: 'ADJ-1042', location: 'Main Warehouse', lot: 'L-2023-11', user: 'Admin', qty: -5, cost: 150, reason: 'Damage' },
    { id: '4', date: '2026-07-01 09:00 AM', refType: 'Initial Balance', refId: 'SYS-INIT', location: 'Main Warehouse', lot: 'L-2023-11', user: 'System', qty: 150, cost: 150 },
  ]

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
            {ledgerData.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="text-sm font-medium">{item.date}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 text-sm text-blue-600 hover:underline cursor-pointer">
                    {item.refId} <ExternalLink className="h-3 w-3" />
                  </div>
                </TableCell>
                <TableCell>
                  <div className="text-sm">{item.location}</div>
                  <div className="text-xs text-muted-foreground">Lot: {item.lot}</div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-xs">{item.refType}</Badge>
                  {item.reason && <div className="text-[10px] text-muted-foreground mt-1">Reason: {item.reason}</div>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{item.user}</TableCell>
                <TableCell className={`text-right font-bold ${item.qty > 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {item.qty > 0 ? '+' : ''}{item.qty}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
