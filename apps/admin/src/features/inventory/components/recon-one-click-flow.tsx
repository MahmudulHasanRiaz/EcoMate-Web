import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { CheckCircle2, Copy, Loader2, Wrench, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toBnDigits, type ReconPreview } from './recon-helpers'
import type { ReconFixAllResult } from '../reconciliation'

/**
 * Preview + result screens for the Reconciliation one-click-fix flow
 * (2026-11-12). Plain Bengali, no R/Q codes. These are presentational —
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
        <CardTitle className='text-sm'>যা ঠিক হবে</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        {preview.fixLines.length === 0 ? (
          <p className='text-sm font-medium'>ঠিক করার মতো কিছু নেই — এখন কিছু ঠিক করার দরকার নেই।</p>
        ) : (
          <ul className='list-disc space-y-1 pl-5 text-sm'>
            {preview.fixLines.map((line) => (
              <li key={line.key}>{line.text}</li>
            ))}
          </ul>
        )}
        {preview.notFixedCount > 0 && (
          <p className='text-sm text-muted-foreground'>
            {toBnDigits(preview.notFixedCount)}টা জিনিস নিজে দেখতে হবে — এগুলো নিজে
            থেকে ঠিক হবে না। বিস্তারিত দেখুন-এ গিয়ে সেগুলো দেখতে পারবেন।
          </p>
        )}
        <label className='flex items-center gap-2 text-sm'>
          <input
            type='checkbox'
            checked={confirmed}
            disabled={!preview.fixable || isPending}
            onChange={(e) => onConfirmedChange(e.target.checked)}
          />
          আমি বুঝেছি — এতে আসল স্টক লেখা হবে
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
          ঠিক করুন
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
            ঠিক করা যায়নি
          </CardTitle>
        </CardHeader>
        <CardContent className='space-y-2 text-sm'>
          <p className='font-medium'>{error}</p>
          <p className='text-muted-foreground'>
            কিছু লেখা হয়নি — আপনার স্টকে কোনো পরিবর্তন হয়নি।
          </p>
          <Button variant='outline' onClick={onRestart}>
            আবার চেষ্টা করুন
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
      toast.success('Backup id কপি হয়েছে।')
    } catch {
      toast.error('কপি করা যায়নি — backup id টি নিজে লিখে নিন।')
    }
  }

  return (
    <Card>
      <CardHeader className='pb-0'>
        <CardTitle className='flex items-center gap-2 text-sm'>
          <CheckCircle2 className='h-4 w-4 text-green-600' />
          ঠিক করা হয়েছে
        </CardTitle>
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        <p>
          {toBnDigits(result.apply.applied.length)}টা সারি ঠিক হয়েছে ·{' '}
          {toBnDigits(result.apply.skipped.length)}টা বাদ গেছে
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
            আটকে থাকা reservation: {toBnDigits(result.settle.releasedUnits)} ইউনিট
            ছেড়ে দেওয়া হয়েছে, {toBnDigits(result.settle.flagsCleared)}টা flag
            পরিষ্কার হয়েছে।
            {result.settle.remainingFails > 0 &&
              ` এখনো ${toBnDigits(result.settle.remainingFails)}টা বাকি আছে।`}
          </p>
        ) : (
          <p>Q8 settle হয়নি: {result.settle.reason}</p>
        )}
        {result.settle.ran && result.settle.detail && (
          <p className='text-xs text-muted-foreground'>{result.settle.detail}</p>
        )}
        <p>
          {idempotency.ok
            ? 'আবার যাচাই: ঠিক আছে — ঠিক করা সারিগুলোতে আর কোনো সমস্যা নেই।'
            : `আবার যাচাই: এখনো ${toBnDigits(remainingTotal)}টা বাকি আছে — আবার ঠিক করবেন না, ব্যাকআপ থেকে ফেরত নিয়ে দেখুন।`}
        </p>
        <div className='space-y-1 rounded-md border p-3'>
          <p className='text-xs font-medium text-muted-foreground'>
            ব্যাকআপ (নিজে থেকে তৈরি হয়েছে)
          </p>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='font-mono text-xs'>{result.backupId}</span>
            <Button variant='outline' size='sm' onClick={copyBackupId}>
              <Copy className='mr-1 h-3.5 w-3.5' />
              {copied ? 'কপি হয়েছে' : 'কপি করুন'}
            </Button>
            <Link
              to='/mon/backup'
              className='text-xs font-medium text-primary hover:underline'
            >
              ব্যাকআপ দেখুন
            </Link>
          </div>
        </div>
        {isRefreshingReport && <p className='text-muted-foreground'>নতুন যাচাই চলছে…</p>}
        <Button variant='outline' onClick={onRestart}>
          আবার যাচাই করুন
        </Button>
      </CardContent>
    </Card>
  )
}
