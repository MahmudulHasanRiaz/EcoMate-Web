import { useState } from 'react'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertTriangle } from 'lucide-react'

interface Props {
  onConfirm: () => void
  isPending: boolean
  trigger: React.ReactNode
}

export function RestoreConfirmDialog({ onConfirm, isPending, trigger }: Props) {
  const [typed, setTyped] = useState('')
  const [open, setOpen] = useState(false)
  const confirmed = typed === 'RESTORE'

  const handleConfirm = () => {
    onConfirm()
    setOpen(false)
    setTyped('')
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" /> Restore Backup
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will OVERWRITE your current database with the backup data.
            This action cannot be undone. Type <strong>RESTORE</strong> to confirm.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Input
          placeholder='Type "RESTORE" to confirm'
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <AlertDialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={!confirmed || isPending}
            onClick={handleConfirm}
          >
            {isPending ? 'Restoring...' : 'Restore Now'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}