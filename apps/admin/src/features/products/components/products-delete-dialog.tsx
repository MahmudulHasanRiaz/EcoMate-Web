import { useProductMutations } from '../hooks'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { type ProductResponse } from '../api'

type ProductsDeleteDialogProps = {
  currentRow: ProductResponse
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ProductsDeleteDialog({
  currentRow,
  open,
  onOpenChange,
}: ProductsDeleteDialogProps) {
  const { deleteProduct } = useProductMutations()

  return (
    <Dialog
      open={open}
      onOpenChange={(state) => {
        if (!state) onOpenChange(false)
      }}
    >
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Delete Product</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete{' '}
            <span className='font-medium'>{currentRow.name}</span>? This action
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant='destructive'
            onClick={() => {
              deleteProduct.mutate(currentRow.id)
              onOpenChange(false)
            }}
          >
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
