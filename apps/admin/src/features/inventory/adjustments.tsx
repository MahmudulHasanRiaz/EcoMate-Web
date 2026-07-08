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
import { Plus, Search, Eye, FileSpreadsheet } from 'lucide-react'

export function Adjustments() {
  const [newAdjustmentOpen, setNewAdjustmentOpen] = useState(false)

  const adjustmentsList = [
    { id: 'ADJ-0045', warehouse: 'Main Warehouse', type: 'Cycle Count', items: 250, status: 'Draft', date: '2026-07-08', user: 'Admin' },
    { id: 'ADJ-0044', warehouse: 'Retail Store', type: 'Damage Write-off', items: 4, status: 'Completed', date: '2026-07-05', user: 'Admin' },
    { id: 'ADJ-0043', warehouse: 'Main Warehouse', type: 'Full Physical Count', items: 1250, status: 'Completed', date: '2025-12-30', user: 'System' },
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
            <h1 className='text-2xl font-bold tracking-tight'>Complex Adjustments & Audits</h1>
            <p className='text-muted-foreground'>Manage full physical counts, cycle counts, and bulk adjustments.</p>
          </div>
          <Button onClick={() => setNewAdjustmentOpen(true)}>
            <Plus className='mr-2 h-4 w-4' /> New Bulk Adjustment
          </Button>
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
              <SelectItem value="main">Main Warehouse</SelectItem>
              <SelectItem value="retail">Retail Store</SelectItem>
            </SelectContent>
          </Select>
          <Select defaultValue="all_status">
            <SelectTrigger className="w-[150px] bg-background">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all_status">All Statuses</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Adjustment ID</TableHead>
                <TableHead>Warehouse</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Items Audited</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Auditor</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {adjustmentsList.map((adj) => (
                <TableRow key={adj.id}>
                  <TableCell className="font-medium">{adj.id}</TableCell>
                  <TableCell>{adj.warehouse}</TableCell>
                  <TableCell>{adj.type}</TableCell>
                  <TableCell>{adj.items}</TableCell>
                  <TableCell>
                    <Badge variant={adj.status === 'Completed' ? 'default' : 'outline'}>
                      {adj.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{adj.date}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{adj.user}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">
                      <Eye className="h-4 w-4 mr-2" /> View Report
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Main>

      <Dialog open={newAdjustmentOpen} onOpenChange={setNewAdjustmentOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" /> Start Bulk Adjustment
            </DialogTitle>
            <DialogDescription>
              Create a new document for cycle counting or bulk inventory correction.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Target Warehouse</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Select warehouse to audit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="main">Main Warehouse</SelectItem>
                  <SelectItem value="retail">Retail Store</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label>Adjustment Type</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cycle_count">Cycle Count (Partial)</SelectItem>
                  <SelectItem value="full_count">Full Physical Count</SelectItem>
                  <SelectItem value="damage">Bulk Damage Write-off</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Description / Note</Label>
              <Input placeholder="e.g. Q3 End of Quarter Audit" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewAdjustmentOpen(false)}>Cancel</Button>
            <Button onClick={() => setNewAdjustmentOpen(false)}>Create Adjustment Document</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
