import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { systemSettingsApi } from '@/features/settings/storage-api'
import { useLicenseStore } from '@/stores/license-store'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, AlertTriangle, Info } from 'lucide-react'
import { toast } from 'sonner'

export function InventorySettings() {
  const queryClient = useQueryClient()
  const hasInventory = useLicenseStore(s => s.hasFeature('admin_inventory'))

  const { data: settingsData, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then(r => r.data),
    staleTime: 30_000,
  })

  const inventoryEnabled = settingsData?.inventory_enabled === 'true'
  const [pending, setPending] = useState(false)

  const handleToggle = async (checked: boolean) => {
    setPending(true)
    try {
      await systemSettingsApi.set('inventory_enabled', String(checked))
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
      toast.success(checked ? 'Inventory management enabled' : 'Inventory management disabled')
    } catch {
      toast.error('Failed to update setting')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className='space-y-6'>
      <div>
        <h2 className='text-lg font-semibold'>Inventory Management</h2>
        <p className='text-sm text-muted-foreground'>
          Control inventory tracking, physical stock adjustments, and stock valuation.
        </p>
      </div>

      {!hasInventory && (
        <Card className='border-amber-200 bg-amber-50'>
          <CardContent className='p-4 flex items-start gap-3'>
            <AlertTriangle className='h-5 w-5 text-amber-600 shrink-0 mt-0.5' />
            <div>
              <p className='text-sm font-medium text-amber-800'>Inventory management requires a license upgrade</p>
              <p className='text-xs text-amber-700 mt-1'>
                Your current plan does not include the <code>admin_inventory</code> feature.
                Upgrade your license to enable inventory management.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className='pb-3'>
          <CardTitle className='text-base'>Global Inventory Tracking</CardTitle>
          <CardDescription>
            Enable or disable physical inventory management, stock adjustments, and warehouse tracking across your store.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='flex items-center justify-between'>
            <div className='space-y-0.5'>
              <Label htmlFor='inventory-toggle' className='text-sm font-medium'>
                Inventory Management
              </Label>
              <p className='text-xs text-muted-foreground'>
                {hasInventory
                  ? inventoryEnabled
                    ? 'Physical inventory, stock adjustments, and warehouse tracking are active.'
                    : 'All inventory features are currently disabled.'
                  : 'Upgrade license to access inventory features.'}
              </p>
            </div>
            <Switch
              id='inventory-toggle'
              checked={inventoryEnabled}
              onCheckedChange={handleToggle}
              disabled={pending || !hasInventory}
            />
          </div>
          {pending && <Loader2 className='animate-spin h-4 w-4 mt-2' />}
        </CardContent>
      </Card>

      {inventoryEnabled && hasInventory && (
        <div className='bg-muted/30 rounded-lg p-4 text-sm space-y-2'>
          <div className='flex items-start gap-2'>
            <Info className='h-4 w-4 text-blue-500 shrink-0 mt-0.5' />
            <p className='text-muted-foreground'>
              When enabled, you can use <strong>Physical Stock Adjustment</strong> and <strong>Managed Stock
              Adjustment</strong> tools. Product availability mode <code>INVENTORY_CONTROLLED</code> will
              be available in the product form.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
