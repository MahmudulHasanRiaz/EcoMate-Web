import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { useCloseSessionMutation } from '../hooks'

export function MissingCheckoutBadge() {
  return <Badge className='border-transparent bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'>MISSING CHECKOUT</Badge>
}

export function CloseSessionAction({ dayId, size = 'sm' }: { dayId: string; size?: 'sm' | 'default' }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState(false)
  const closeMut = useCloseSessionMutation()

  function submit() {
    if (!reason.trim()) {
      setTouched(true)
      return
    }
    closeMut.mutate(
      { dayId, reason: reason.trim() },
      {
        onSuccess: () => {
          setOpen(false)
          setReason('')
          setTouched(false)
        },
      },
    )
  }

  return (
    <>
      <Button size={size} variant='outline' onClick={() => setOpen(true)}>
        Close Session
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) {
            setReason('')
            setTouched(false)
          }
        }}
      >
        <DialogContent className='sm:max-w-[460px]'>
          <DialogHeader>
            <DialogTitle>Close Session</DialogTitle>
          </DialogHeader>
          <div className='grid gap-3 py-3'>
            <p className='text-sm text-muted-foreground'>
              <MissingCheckoutBadge /> The employee has an open session with no check-out. Record the
              check-out now; the change is written to the audit trail.
            </p>
            <div className='grid gap-2'>
              <Label className={touched && !reason.trim() ? 'text-destructive' : undefined}>Reason *</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder='Why was the check-out missed?'
                aria-invalid={touched && !reason.trim()}
              />
              {touched && !reason.trim() && (
                <p className='text-xs font-medium text-destructive'>Reason is required.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={closeMut.isPending}>
              {closeMut.isPending && <Loader2 className='h-4 w-4 animate-spin mr-1' />}
              Confirm Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
