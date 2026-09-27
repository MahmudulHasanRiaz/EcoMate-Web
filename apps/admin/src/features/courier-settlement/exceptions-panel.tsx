import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useExceptions, useCourierSettlementMutations } from './hooks'
import { ExceptionBadge, InvoiceStateBadge } from './state-badge'

/**
 * Workspace Exceptions tab: the cross-invoice queue. Every entry carries the
 * invoice and (when it is a row rule) the row identifier + row number so an
 * operator can go straight to the place that must be fixed — no list of bare
 * "something failed" messages.
 */
export function ExceptionsPanel() {
  const [severity, setSeverity] = useState<'all' | 'red' | 'yellow'>('all')
  const [status, setStatus] = useState<'all' | 'open' | 'acknowledged' | 'resolved'>('all')
  const { data, isLoading, isError } = useExceptions({
    severity: severity === 'all' ? undefined : severity,
    status: status === 'all' ? undefined : status,
    limit: 50,
  })
  const { acknowledge } = useCourierSettlementMutations()

  const rows = Array.isArray(data) ? data : (data as { data?: unknown[] })?.data ?? []

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Exceptions across all invoices</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Select value={severity} onValueChange={(v) => setSeverity(v as typeof severity)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="red">RED (blocking)</SelectItem>
              <SelectItem value="yellow">YELLOW</SelectItem>
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as typeof status)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="acknowledged">Acknowledged</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {isLoading ? (
          <div className="py-10 text-center text-muted-foreground">Loading exceptions…</div>
        ) : isError ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
            Failed to load the exception queue. Nothing is shown rather than a partial list that
            could hide a blocking issue.
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-muted-foreground">
            {severity === 'all' && status === 'all'
              ? 'No exceptions — nothing is blocking a settlement.'
              : 'No exceptions match this filter.'}
          </div>
        ) : (
          <ul className="divide-y rounded-md border">
            {rows.map((e: any) => (
              <li key={e.id} className="flex flex-wrap items-start gap-3 p-3 text-sm">
                <ExceptionBadge severity={e.severity} status={e.status} />
                <div className="min-w-0 flex-1">
                  <p>{e.message ?? e.ruleId}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">{e.ruleId}</span>
                    {e.invoice ? (
                      <>
                        <span>·</span>
                        <Link
                          to="/op/courier-settlement/$id"
                          params={{ id: e.invoiceId }}
                          className="font-medium text-primary hover:underline"
                        >
                          {e.invoice.displayId}
                        </Link>
                        <span className="capitalize">({e.invoice.courier})</span>
                        <InvoiceStateBadge state={e.invoice.state} />
                      </>
                    ) : null}
                    {e.row ? (
                      <span className="font-mono">
                        · row {e.row.rowNumber} · {e.row.identifier ?? '—'}
                      </span>
                    ) : null}
                    {e.resolvedAt ? (
                      <span>
                        · resolved {new Date(e.resolvedAt).toLocaleString()}
                        {e.resolvedBy ? ` by ${e.resolvedBy}` : ''}
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {e.blocked ? (
                    <Badge variant="outline" className="bg-red-100 text-red-800">
                      blocks finalize
                    </Badge>
                  ) : null}
                  {e.status === 'open' && e.severity === 'yellow' ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        acknowledge.mutate({ invoiceId: e.invoiceId, exceptionId: e.id })
                      }
                    >
                      Acknowledge
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
