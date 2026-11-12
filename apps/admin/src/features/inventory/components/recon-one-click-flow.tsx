import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { CheckCircle2, Copy, Loader2, Wrench, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ReconPreview } from './recon-helpers'
import type { ReconFixAllResult } from '../reconciliation'

/**
 * Preview + result screens for the Reconciliation one-click-fix flow
 * (2026-11-12). Plain English, no R/Q codes. These are presentational —
 * the page in ../reconciliation.tsx owns the flow state and the API calls.
 */

export function ReconPreviewCard({
  preview,
  confirmed,
  onConfirmedChange,
  onConfirm,
  isPending,
}: {
  preview: ReconPreview
  confirmed: boolean
  onConfirmedChange: (v: boolean) => void
  onConfirm: () => void
  isPending: boolean
}) {
  return (
    <Card>
      <CardHeader className='pb-0'>
        <CardTitle className='text-sm'>What will be fixed</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        {preview.fixLines.length === 0 ? (
          <p className='text-sm font-medium'>Nothing to fix — nothing needs fixing right now.</p>
        ) : (
          <ul className='list-disc space-y-1 pl-5 text-sm'>
            {preview.fixLines.map((line) => (
              <li key={line.key}>{line.text}</li>
            ))}
          </ul>
        )}
        {preview.notFixedCount > 0 && (
          <p className='text-sm text-muted-foreground'>
            {preview.notFixedCount} item(s) need a manual check — these will not
            fix themselves. See them under Show details.
          </p>
        )}
        <label className='flex items-center gap-2 text-sm'>
          <input
            type='checkbox'
            checked={confirmed}
            disabled={!preview.fixable || isPending}
            onChange={(e) => onConfirmedChange(e.target.checked)}
          />
          I understand — this will write real stock.
        </label>
        <Button
          variant='destructive'
          disabled={!preview.fixable || !confirmed || isPending}
          onClick={onConfirm}
        >
          {isPending ? (
            <Loader2 className='mr-2 h-4 w-4 animate-spin' />
          ) : (
            <Wrench className='mr-2 h-4 w-4' />
          )}
          Fix
        </Button>
      </CardContent>
    </Card>
  )
}

export function ReconFixAllResultCard({
  result,
  error,
  isRefreshingReport,
  onRestart,
}: {
  result: ReconFixAllResult | null
  /** Backend message verbatim — shown when the fix-all failed closed. */
  error: string | null
  /** True while the auto re-run dry-run after a successful fix is loading. */
  isRefreshingReport: boolean
  onRestart: () => void
}) {
  const [copied, setCopied] = useState(false)

  if (error) {
    return (
      <Card>
        <CardHeader className='pb-0'>
          <CardTitle className='flex items-center gap-2 text-sm'>
            <XCircle className='h-4 w-4 text-destructive' />
            Couldn't fix
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-2 text-sm'>
          <p className='font-medium'>{error}</p>
          <p className='text-muted-foreground'>
            Nothing was written — your stock did not change.
          </p>
          <Button variant='outline' onClick={onRestart}>
            Try again
          </Button>
        </CardContent>
      </Card>
    )
  }

  if (!result) return null

  const idempotency = result.apply.idempotency
  const remainingTotal =
    idempotency.remainingR1R2 + idempotency.remainingR6 + idempotency.remainingR8

  const copyBackupId = async () => {
    try {
      await navigator.clipboard.writeText(result.backupId)
      setCopied(true)
      toast.success('Backup id copied.')
    } catch {
      toast.error("Couldn't copy — write down the backup id yourself.")
    }
  }

  return (
    <Card>
      <CardHeader className='pb-0'>
        <CardTitle className='flex items-center gap-2 text-sm'>
          <CheckCircle2 className='h-4 w-4 text-green-600' />
          Fixed
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        <p>
          {result.apply.applied.length} row(s) fixed ·{' '}
          {result.apply.skipped.length} skipped
        </p>
        {result.apply.skipped.length > 0 && (
          <ul className='list-disc pl-5'>
            {result.apply.skipped.map((s) => (
              <li key={s.id}>
                <span className='font-mono text-xs'>{s.id}</span> — {s.reason}
              </li>
            ))}
          </ul>
        )}
        {result.settle.ran ? (
          <p>
            Stuck reservations: {result.settle.releasedUnits} unit(s) released,{' '}
            {result.settle.flagsCleared} flag(s) cleared.
            {result.settle.remainingFails > 0 &&
              ` ${result.settle.remainingFails} still left.`}
          </p>
        ) : (
          <p>Q8 settle did not run: {result.settle.reason}</p>
        )}
        {result.settle.ran && result.settle.detail && (
          <p className='text-xs text-muted-foreground'>{result.settle.detail}</p>
        )}
        <p>
          {idempotency.ok
            ? 'Re-check: all good — the fixed rows have no more problems.'
            : `Re-check: ${remainingTotal} still left — do not fix again, restore from the backup and check.`}
        </p>
        <div className='space-y-1 rounded-md border p-3'>
          <p className='text-xs font-medium text-muted-foreground'>
            Backup (created automatically)
          </p>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='font-mono text-xs'>{result.backupId}</span>
            <Button variant='outline' size='sm' onClick={copyBackupId}>
              <Copy className='mr-1 h-3.5 w-3.5' />
              {copied ? 'Copied' : 'Copy'}
            </Button>
            <Link
              to='/mon/backup'
              className='text-xs font-medium text-primary hover:underline'
            >
              View backups
            </Link>
          </div>
        </div>
        {isRefreshingReport && <p className='text-muted-foreground'>Running a new check…</p>}
        <Button variant='outline' onClick={onRestart}>
          Check again
        </Button>
      </CardContent>
    </Card>
  )
}
