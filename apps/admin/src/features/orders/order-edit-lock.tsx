import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { apiClient } from '@/lib/api-client'
import { useAuthStore } from '@/stores/auth-store'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Unlock, AlertTriangle, ShieldAlert } from 'lucide-react'

const HEARTBEAT_MS = 25_000

const LOCKABLE_ROLES = new Set(['superadmin', 'admin', 'manager'])

interface LockInfo {
  orderId: string
  userId: string
  userName?: string | null
  acquiredAt: string
  expiresAt: string
}

type LockState =
  | { status: 'idle' }
  | { status: 'acquiring' }
  | { status: 'heldByMe' }
  | { status: 'heldByOther'; lock: LockInfo }
  | { status: 'conflict' }

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

export function OrderEditLockGuard({ orderId, disabled }: { orderId: string | undefined; disabled?: boolean }) {
  const queryClient = useQueryClient()
  const role = useAuthStore(s => s.auth.user?.role)
  const canLock = !!role && LOCKABLE_ROLES.has(role)

  const [state, setState] = useState<LockState>({ status: 'idle' })
  const [overrideOpen, setOverrideOpen] = useState(false)
  const stateRef = useRef(state)
  const stoppedRef = useRef(false)

  useEffect(() => {
    stateRef.current = state
  }, [state])

  const acquire = useCallback(async () => {
    if (!orderId || stoppedRef.current) return
    setState({ status: 'acquiring' })
    try {
      const res = await apiClient.post(`/orders/${orderId}/lock/acquire`)
      const data = res.data as { acquired: boolean; lock?: LockInfo; heldBy?: LockInfo }
      if (data.acquired) {
        setState({ status: 'heldByMe' })
        queryClient.invalidateQueries({ queryKey: ['order', orderId] })
      } else if (data.heldBy) {
        setState({ status: 'heldByOther', lock: data.heldBy })
      } else {
        setState({ status: 'idle' })
      }
    } catch (e: any) {
      const status = e?.response?.status
      if (status === 403 || status === 401) setState({ status: 'idle' })
      else setState({ status: 'conflict' })
    }
  }, [orderId, queryClient])

  const heartbeat = useCallback(async () => {
    const current = stateRef.current
    if (current.status !== 'heldByMe' || stoppedRef.current) return
    try {
      const res = await apiClient.post(`/orders/${orderId}/lock/heartbeat`)
      const data = res.data as { ok: boolean; heldBy?: LockInfo }
      if (!data.ok && data.heldBy) setState({ status: 'heldByOther', lock: data.heldBy })
    } catch {
      setState({ status: 'conflict' })
    }
  }, [orderId])

  useEffect(() => {
    if (!orderId || !canLock || disabled) return
    stoppedRef.current = false
    const t = setTimeout(acquire, 0)
    const interval = setInterval(heartbeat, HEARTBEAT_MS)
    return () => {
      stoppedRef.current = true
      clearTimeout(t)
      clearInterval(interval)
      apiClient.delete(`/orders/${orderId}/lock`).catch(() => {})
    }
  }, [orderId, canLock, disabled, acquire, heartbeat])

  const doOverride = useCallback(async () => {
    if (!orderId) return
    setOverrideOpen(false)
    try {
      await apiClient.post(`/orders/${orderId}/lock/override`)
      setState({ status: 'heldByMe' })
      toast.success('Lock overridden — you are now editing')
      queryClient.invalidateQueries({ queryKey: ['order', orderId] })
    } catch {
      toast.error('Override failed')
      setState({ status: 'conflict' })
    }
  }, [orderId, queryClient])

  if (!canLock || disabled || !orderId) return null

  if (state.status === 'heldByOther' || state.status === 'conflict' || state.status === 'acquiring') {
    const other = state.status === 'heldByOther' ? state.lock : null
    return (
      <>
        <div className={`flex items-center gap-3 rounded-lg px-4 py-2 text-sm ${state.status === 'acquiring' ? 'bg-muted/50 text-muted-foreground' : 'border border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}>
          {state.status === 'acquiring' ? (
            <>
              <Loader2 className='h-4 w-4 animate-spin' /> Taking edit lock...
            </>
          ) : other ? (
            <>
<AlertTriangle className='h-4 w-4 shrink-0' />
              <span className='flex-1'>
                <ShieldAlert className='h-3.5 w-3.5 mr-1 inline -mt-0.5' />
                <strong>{other.userName || 'Another staff member'}</strong> is editing this order
                {other.acquiredAt ? <> · {timeAgo(other.acquiredAt)}</> : null}
              </span>
              <Button size='sm' variant='outline' className='h-8' onClick={() => setOverrideOpen(true)}>Override lock</Button>
            </>
          ) : (
            <>
              <AlertTriangle className='h-4 w-4 shrink-0' />
              <span className='flex-1'>Could not verify the edit lock. Saving is blocked until the lock is resolved.</span>
            </>
          )}
        </div>
        <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Override edit lock?</DialogTitle>
              <DialogDescription>
                {other?.userName
                  ? `${other.userName} is currently editing this order. Overriding lets you edit simultaneously — changes may overwrite theirs.`
                  : 'Another staff member is currently editing this order. Overriding lets you edit simultaneously — changes may overwrite theirs.'}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant='outline' onClick={() => setOverrideOpen(false)}>Cancel</Button>
              <Button variant='destructive' onClick={doOverride}>Override</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  if (state.status === 'heldByMe') {
    return (
      <div className='flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/25 px-4 py-2 text-sm text-emerald-700 dark:text-emerald-400'>
        <Unlock className='h-4 w-4 shrink-0' />
        <span className='flex-1'>You hold the edit lock — other staff will be warned while you edit.</span>
        <span className='text-xs opacity-70'>Auto-updates every {HEARTBEAT_MS / 1000}s</span>
      </div>
    )
  }

  return null
}