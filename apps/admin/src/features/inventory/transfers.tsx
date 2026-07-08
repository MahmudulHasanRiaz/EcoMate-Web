import { useState } from 'react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Plus, ArrowRight, Truck, Search, Eye, AlertCircle, ArrowDown, ArrowUp } from 'lucide-react'

export function Transfers() {
  const [newTransferOpen, setNewTransferOpen] = useState(false)

  const transfersList = [
    { id: 'TRF-0012', from: 'Main Warehouse', to: 'Retail Store', status: 'In Transit', items: 3, date: '2026-07-08 10:30 AM', user: 'Admin' },
    { id: 'TRF-0011', from: 'Retail Store', to: 'Main Warehouse', status: 'Completed', items: 1, date: '2026-07-07 02:15 PM', user: 'Admin' },
    { id: 'TRF-0010', from: 'Supplier Depot', to: 'Main Warehouse', status: 'Draft', items: 15, date: '2026-07-06 09:00 AM', user: 'System' },
  ]

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
            <h1 className='text-2xl font-bold tracking-tight'>Stock Transfers</h1>
            <p className='text-muted-foreground'>Move inventory between physical warehouses.</p>
          </div>
          <Button onClick={() => setNewTransferOpen(true)}>
            <Plus className='mr-2 h-4 w-4' /> New Transfer
          </Button>
        </div>

        <div className="flex items-center gap-4 bg-muted/30 p-2 rounded-lg border">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search transfers by ID..." className="pl-9 bg-background" />
          </div>
          <Select defaultValue="all">
            <SelectTrigger className="w-[180px] bg-background">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="transit">In Transit</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Transfer ID</TableHead>
                <TableHead>Route</TableHead>
                <TableHead>Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Initiated By</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transfersList.map((trf) => (
                <TableRow key={trf.id}>
                  <TableCell className="font-medium">{trf.id}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{trf.from}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{trf.to}</span>
                    </div>
                  </TableCell>
                  <TableCell>{trf.items} Products</TableCell>
                  <TableCell>
                    <Badge variant={trf.status === 'Completed' ? 'default' : trf.status === 'In Transit' ? 'secondary' : 'outline'}>
                      {trf.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{trf.date}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{trf.user}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      <Eye className="h-4 w-4 mr-2" /> View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Main>

      <Dialog open={newTransferOpen} onOpenChange={setNewTransferOpen}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Truck className="h-5 w-5" /> Initiate Stock Transfer
            </DialogTitle>
            <DialogDescription>
              Select source and destination locations to begin transferring physical stock.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Source Warehouse</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select source" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main">Main Warehouse</SelectItem>
                    <SelectItem value="retail">Retail Store</SelectItem>
                    <SelectItem value="supplier">Supplier Depot</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Destination Warehouse</Label>
                <Select>
                  <SelectTrigger>
                    <SelectValue placeholder="Select destination" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="main">Main Warehouse</SelectItem>
                    <SelectItem value="retail">Retail Store</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            
            <div className="space-y-2">
              <Label>Reference Note</Label>
              <Input placeholder="e.g. Weekly restock for retail" />
            </div>

            <div className="space-y-2">
              <Label>Stock Impact Preview</Label>
              <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <div className="font-medium">Organic Cotton T-Shirt (OCT-WHT-M)</div>
                  <Badge variant="outline">Qty: 50</Badge>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Main Warehouse (Source)</div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      120 <ArrowRight className="h-3 w-3 text-red-500" /> <span className="text-red-600">70 Available</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Retail Store (Destination)</div>
                    <div className="flex items-center gap-2 text-sm font-medium">
                      45 <ArrowRight className="h-3 w-3 text-green-500" /> <span className="text-green-600">95 Available (After Receipt)</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-start gap-2 mt-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-950/20 p-2 rounded">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <p>Stock will be deducted from Main Warehouse immediately, but will not be available in Retail Store until the transfer is <strong>Received</strong>.</p>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewTransferOpen(false)}>Cancel</Button>
            <Button onClick={() => setNewTransferOpen(false)}>Confirm & Dispatch Transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
