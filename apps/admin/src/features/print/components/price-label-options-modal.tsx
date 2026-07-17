import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Switch } from '@/components/ui/switch'
import { Printer } from 'lucide-react'

export type PrintScope = 'parent' | 'variants' | 'all'
export type PriceMode = 'base' | 'sale' | 'smart' | 'both'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedIds: string[]
}

export function PriceLabelOptionsModal({ open, onOpenChange, selectedIds }: Props) {
  const navigate = useNavigate()
  const [scope, setScope] = useState<PrintScope>('all')
  const [priceMode, setPriceMode] = useState<PriceMode>('smart')
  const [showAttrs, setShowAttrs] = useState(true)

  const handlePrint = () => {
    onOpenChange(false)
    navigate({
      to: '/op/print/price-labels',
      search: {
        ids: selectedIds.join(','),
        scope,
        price: priceMode,
        showAttrs: showAttrs ? 'true' : 'false',
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Print Price Labels</DialogTitle>
          <DialogDescription>
            {selectedIds.length} product(s) selected. Choose what to print.
          </DialogDescription>
        </DialogHeader>

        <div className='space-y-5 py-3'>
          <div className='space-y-3'>
            <Label>Scope</Label>
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as PrintScope)}>
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='parent' id='scope-parent' />
                <Label htmlFor='scope-parent' className='font-normal'>Parent only</Label>
              </div>
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='variants' id='scope-variants' />
                <Label htmlFor='scope-variants' className='font-normal'>Variants only</Label>
              </div>
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='all' id='scope-all' />
                <Label htmlFor='scope-all' className='font-normal'>All (parent + variants)</Label>
              </div>
            </RadioGroup>
          </div>

          <div className='space-y-3'>
            <Label>Price</Label>
            <RadioGroup value={priceMode} onValueChange={(v) => setPriceMode(v as PriceMode)}>
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='base' id='price-base' />
                <Label htmlFor='price-base' className='font-normal'>Base Price</Label>
              </div>
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='sale' id='price-sale' />
                <Label htmlFor='price-sale' className='font-normal'>Sale Price</Label>
              </div>
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='smart' id='price-smart' />
                <Label htmlFor='price-smart' className='font-normal'>Smart (sale if exists, else base)</Label>
              </div>
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='both' id='price-both' />
                <Label htmlFor='price-both' className='font-normal'>Both (base crossed + sale)</Label>
              </div>
            </RadioGroup>
          </div>

          <div className='flex items-center gap-2'>
            <Switch id='show-attrs' checked={showAttrs} onCheckedChange={setShowAttrs} />
            <Label htmlFor='show-attrs' className='font-normal'>Show variant attributes</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handlePrint}>
            <Printer className='h-4 w-4 mr-1.5' />
            Print ({selectedIds.length})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
