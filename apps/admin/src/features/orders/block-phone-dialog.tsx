import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { blockedEntriesApi } from '@/features/blocking/api'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export function uniquePhones(phones: string[]): string[] {
  return Array.from(new Set(phones.map(p => p.trim()).filter(Boolean)))
}

interface BlockPhoneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  phones: string[]
  contextLabel?: string
}

/**
 * Blocks order placement for one or more phone numbers straight from the
 * orders list / order detail — the same authoritative rule enforced at
 * order creation (backend rejects blocked phones).
 */
export function BlockPhoneDialog({
  open,
  onOpenChange,
  phones,
  contextLabel,
}: BlockPhoneDialogProps) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const unique = uniquePhones(phones)

  const handleBlock = async () => {
    if (unique.length === 0) return
    setSubmitting(true)
    try {
      const results = await Promise.all(
        unique.map(phone =>
          blockedEntriesApi.create({
            type: 'phone',
            value: phone,
            reason: reason.trim() || `Blocked from order${contextLabel ? ` ${contextLabel}` : ''}`,
            blockType: 'order',
          }).then(() => null).catch((e) => ({ phone, error: e })),
        ),
      )
      const failedBlocks = results.filter((r): r is { phone: string; error: any } => r !== null)
      const succeeded = unique.length - failedBlocks.length
      await qc.invalidateQueries({ queryKey: ['blocked-entries'] })
      if (succeeded > 0) {
        toast.success(
          succeeded === 1 ? '1 phone blocked from ordering' : `${succeeded} phones blocked from ordering`,
        )
      }
      if (failedBlocks.length > 0) {
        toast.error(`${failedBlocks.length} phone(s) could not be blocked`)
        failedBlocks.slice(0, 3).forEach(({ phone, error }) =>
          toast.error(`${phone}: ${error?.response?.data?.message || 'Failed to block'}`, { id: phone }),
        )
        return
      }
      setReason('')
      onOpenChange(false)
    } catch {
      toast.error('Failed to block phone(s)')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Block phone from ordering</DialogTitle>
          <DialogDescription>
            Orders placed from {unique.map(p => `"${p}"`).join(', ')} will be rejected with a block message.
            {contextLabel && <> Source order: {contextLabel}.</>}
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-2'>
          <Label htmlFor='block-reason'>Reason (optional)</Label>
          <Textarea
            id='block-reason'
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder='e.g. Repeated COD refusal'
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant='destructive'
            onClick={handleBlock}
            disabled={submitting || unique.length === 0}
          >
            {submitting ? 'Blocking…' : 'Block ordering'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
