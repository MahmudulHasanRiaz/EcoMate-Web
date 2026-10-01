import { useState } from 'react'
import { AlertTriangle, ChevronRight, Clock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { DispatchRow, PurchaseEventView } from '../api'

const STATUS_TONE: Record<string, string> = {
  SENT: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  FAILED: 'bg-red-500/15 text-red-700 dark:text-red-400',
  RETRY: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  SKIPPED: 'bg-muted text-muted-foreground',
  PENDING: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  SENDING: 'bg-sky-500/15 text-sky-700 dark:text-sky-400',
  DEAD: 'bg-red-500/15 text-red-700 dark:text-red-400',
  DEDUPED: 'bg-muted text-muted-foreground',
}

const fmtTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

/**
 * Delivery metrics for one (provider, destination) pair.
 *
 * `Attempts` and `Dispatched` are different axes and are shown as such:
 * attempts counts HTTP sends (a retry increments it), dispatched counts
 * delivery-target rows (0 or 1). There is deliberately no "not accepted =
 * attempts − accepted" column — that subtraction mixes an attempt counter with
 * a row-level outcome and means nothing.
 */
function MetricsTable({ dispatches, acceptanceLabel }: { dispatches: DispatchRow[]; acceptanceLabel: string }) {
  return (
    <div className='overflow-auto rounded-md border'>
      <table className='w-full text-xs'>
        <thead className='sticky top-0 z-10 bg-muted'>
          <tr>
            {['Platform', 'Status', 'Attempts', 'Dispatched', acceptanceLabel, 'Rejected', 'Unknown', 'Failed attempts', 'Last attempt'].map((h) => (
              <th key={h} className='whitespace-nowrap border-b px-2.5 py-1.5 text-left font-medium text-muted-foreground'>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {dispatches.map((d) => (
            <tr key={`${d.provider}-${d.destinationId}`} className='hover:bg-accent/40'>
              <td className='whitespace-nowrap border-b px-2.5 py-1.5 font-medium'>
                {d.provider}
                {d.pixelId ? <span className='ml-1 font-mono text-[10px] text-muted-foreground'>{d.pixelId}</span> : null}
              </td>
              <td className='whitespace-nowrap border-b px-2.5 py-1.5'>
                <span className={cn('rounded px-1.5 py-0.5 text-[10px]', STATUS_TONE[d.status] ?? 'bg-muted')}>
                  {d.status}
                </span>
              </td>
              <td className='whitespace-nowrap border-b px-2.5 py-1.5 text-right tabular-nums'>{d.attempts}</td>
              <td className='whitespace-nowrap border-b px-2.5 py-1.5 text-right tabular-nums'>{d.dispatched}</td>
              <td className='whitespace-nowrap border-b px-2.5 py-1.5 text-right tabular-nums'>{d.accepted}</td>
              <td className='whitespace-nowrap border-b px-2.5 py-1.5 text-right tabular-nums'>{d.rejected}</td>
              <td className='whitespace-nowrap border-b px-2.5 py-1.5 text-right tabular-nums'>{d.unknown}</td>
              <td className='whitespace-nowrap border-b px-2.5 py-1.5 text-right tabular-nums'>
                {d.failedAttempts === null ? (
                  <span className='text-[10px] text-muted-foreground' title='The transition log is purged 30 days after dispatch. This is unknown, not zero.'>
                    n/a
                  </span>
                ) : (
                  d.failedAttempts
                )}
              </td>
              <td className='whitespace-nowrap border-b px-2.5 py-1.5 text-muted-foreground'>{fmtTime(d.lastAttemptAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Timeline({ event }: { event: PurchaseEventView }) {
  if (!event.transitionLogAvailable) {
    return (
      <div className='flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-700 dark:text-amber-400'>
        <Clock className='mt-0.5 size-3.5 shrink-0' />
        <span>
          Transition log purged {event.transitionLogAvailable === false ? 'after 30 days' : ''} — the
          per-attempt timeline is no longer available for this event. The durable counts above remain
          accurate.
        </span>
      </div>
    )
  }
  if (event.timeline.length === 0) {
    return <p className='text-xs text-muted-foreground'>No transitions recorded yet.</p>
  }
  return (
    <ol className='space-y-1 rounded-md border p-2.5'>
      {event.timeline.map((t) => (
        <li key={`${t.at}-${t.toStatus}-${t.attempt}`} className='flex items-start gap-2 text-xs'>
          <span className='w-32 shrink-0 font-mono text-[10px] text-muted-foreground'>
            {new Date(t.at).toLocaleTimeString()}
          </span>
          <span className='w-16 shrink-0 font-medium'>{t.provider ?? '—'}</span>
          <span className='shrink-0 font-mono text-[10px] text-muted-foreground'>
            {t.attempt != null ? `#${t.attempt}` : ''}
          </span>
          <span className='text-muted-foreground'>→</span>
          <span className={cn('font-medium', t.toStatus === 'SENT' ? 'text-emerald-600' : t.toStatus === 'FAILED' ? 'text-red-600' : '')}>
            {t.toStatus}
          </span>
          {t.message ? <span className='ml-1 text-muted-foreground'>{t.message}</span> : null}
        </li>
      ))}
    </ol>
  )
}

function PayloadInspector({ event }: { event: PurchaseEventView }) {
  return (
    <div className='space-y-3'>
      <div>
        <p className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
          As captured
        </p>
        <pre className='max-h-56 overflow-auto rounded-md border bg-muted/30 p-2.5 font-mono text-[11px] leading-relaxed'>
          {JSON.stringify(event.payloadCaptured, null, 2)}
        </pre>
      </div>
      {event.payloadSent.map((p) => (
        <div key={`${p.provider}-${p.destinationId}`}>
          <p className='mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>
            As sent (sanitized) — {p.provider}
            {p.truncated ? (
              <Badge variant='outline' className='border-amber-500/40 text-[10px] text-amber-600'>
                truncated
              </Badge>
            ) : null}
          </p>
          <pre className='max-h-56 overflow-auto rounded-md border bg-muted/30 p-2.5 font-mono text-[11px] leading-relaxed'>
            {JSON.stringify(p.value, null, 2)}
          </pre>
          {p.truncated ? (
            <p className='mt-1 text-[10px] text-amber-600'>
              This snapshot was bounded during sanitization — it is not the complete payload.
            </p>
          ) : null}
          {p.redactedPaths.length > 0 ? (
            <p className='mt-1 text-[10px] text-muted-foreground'>
              Redacted: {p.redactedPaths.join(', ')}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/**
 * Diagnostic coverage of the metrics that went out with this event.
 * Deliberately NOT a percentage or health score — a bare ratio with no
 * defined business meaning would imply more than we can honestly claim.
 */
function CoverageTable({ event }: { event: PurchaseEventView }) {
  const missing = event.coverage.filter((c) => c.state === 'missing').length
  return (
    <div className='space-y-1.5'>
      {missing > 0 && (
        <p className='text-[11px] text-muted-foreground'>
          {missing} of {event.coverage.length} metrics were not present for this event.
        </p>
      )}
      <div className='overflow-auto rounded-md border'>
        <table className='w-full text-xs'>
          <thead className='sticky top-0 bg-muted'>
            <tr>
              <th className='border-b px-2.5 py-1.5 text-left font-medium text-muted-foreground'>Field</th>
              <th className='border-b px-2.5 py-1.5 text-left font-medium text-muted-foreground'>Value</th>
              <th className='w-24 border-b px-2.5 py-1.5 text-left font-medium text-muted-foreground'>Status</th>
            </tr>
          </thead>
          <tbody>
            {event.coverage.map((c) => (
              <tr key={c.field} className='hover:bg-accent/40'>
                <td className='whitespace-nowrap border-b px-2.5 py-1 font-mono text-[11px]'>{c.field}</td>
                <td className='border-b px-2.5 py-1 font-mono text-[11px]'>
                  {c.value == null ? <span className='text-muted-foreground'>—</span> : String(c.value).slice(0, 120)}
                </td>
                <td className='whitespace-nowrap border-b px-2.5 py-1'>
                  {c.state === 'present' ? (
                    <span className='text-emerald-600'>✓ Present</span>
                  ) : (
                    <span className='text-muted-foreground'>— Missing</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EventBlock({ event }: { event: PurchaseEventView }) {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className='rounded-md border'>
      <CollapsibleTrigger asChild>
        <Button variant='ghost' className='tap-h w-full justify-between rounded-md px-2.5 text-left'>
          <span className='flex items-center gap-2'>
            <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
            <span className='font-medium'>{event.eventType}</span>
            <span className='font-mono text-[10px] text-muted-foreground'>{event.eventId}</span>
          </span>
          <span className='flex items-center gap-1.5 text-[10px] text-muted-foreground'>
            {event.dispatches.map((d) => (
              <span key={`${d.provider}-${d.destinationId}`} className={cn('rounded px-1.5 py-0.5', STATUS_TONE[d.status] ?? 'bg-muted')}>
                {d.provider}
              </span>
            ))}
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className='space-y-3 border-t p-2.5'>
        <div className='flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground'>
          <span>Event time: {fmtTime(event.eventTime)}</span>
          {event.triggerMode ? <span>· Mode: {event.triggerMode}</span> : null}
          {event.actionSource ? <span>· Action source: {event.actionSource}</span> : null}
          {event.outbox.dead > 0 ? (
            <Badge variant='outline' className='border-red-500/40 text-[10px] text-red-600'>
              {event.outbox.dead} dead outbox
            </Badge>
          ) : null}
        </div>

        <MetricsTable dispatches={event.dispatches} acceptanceLabel={event.acceptanceColumnLabel} />
        <div>
          <p className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>Timeline</p>
          <Timeline event={event} />
        </div>
        <div>
          <p className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>Payload</p>
          <PayloadInspector event={event} />
        </div>
        <div>
          <p className='mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'>Metrics coverage</p>
          <CoverageTable event={event} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export function PurchaseEvents({ events }: { events: PurchaseEventView[] }) {
  if (events.length === 0) {
    return (
      <p className='px-3 py-6 text-center text-xs text-muted-foreground'>
        No purchase event was captured for this order.
      </p>
    )
  }
  return (
    <div className='space-y-2'>
      <div className='flex items-start gap-2 rounded-md bg-muted/40 p-2 text-[11px] text-muted-foreground'>
        <AlertTriangle className='mt-0.5 size-3 shrink-0' />
        <span>
          Attempts count every send attempt including retries. Dispatched counts delivery targets.
          A provider is only shown as accepted when its own response confirms it — the system never
          claims an event was processed on evidence it does not have.
        </span>
      </div>
      {events.map((e) => (
        <EventBlock key={e.eventId} event={e} />
      ))}
    </div>
  )
}
