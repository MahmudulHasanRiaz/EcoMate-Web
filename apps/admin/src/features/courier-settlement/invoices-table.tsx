import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useInvoices } from './hooks'
import { InvoiceStateBadge } from './state-badge'
import type { InvoiceState } from './api'

/** Analyzed-but-not-imported drafts: resumable from the table. */
export const DRAFT_STATES: InvoiceState[] = ['UPLOADED', 'ANALYZED', 'MAPPING_REQUIRED']
const isDraft = (s: InvoiceState) => DRAFT_STATES.includes(s)

const STATES: (InvoiceState | 'all')[] = [
  'all',
  'DRAFTS',
  'READY_FOR_REVIEW',
  'REVIEW_REQUIRED',
  'ISSUE_FOUND',
  'FINALIZED_PENDING_ACCOUNTING',
  'ACCOUNTING_POSTED',
  'ACCOUNTING_FAILED',
  'ADJUSTED',
  'RECONCILED',
  'DISCARDED',
]

const money = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `৳${v.toLocaleString('en-US', { minimumFractionDigits: 2 })}`

export function InvoicesTable({ onResumeDraft }: { onResumeDraft?: (id: string) => void } = {}) {
  const [search, setSearch] = useState('')
  const [state, setState] = useState<string>('all')
  const [page, setPage] = useState(1)
  const { data, isLoading } = useInvoices({
    page,
    limit: 25,
    search: search || undefined,
    state: state === 'all' ? undefined : state === 'DRAFTS' ? undefined : state,
    draft: state === 'DRAFTS' ? true : undefined,
  })

  const rows = data?.data ?? []
  const meta = data?.meta

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b p-3">
          <Input
            placeholder="Search display ID or invoice no…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="max-w-xs"
          />
          <Select
            value={state}
            onValueChange={(v) => {
              setState(v)
              setPage(1)
            }}
          >
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === 'all'
                    ? 'All states'
                    : s === 'DRAFTS'
                      ? 'Drafts (not imported)'
                      : s.replace(/_/g, ' ').toLowerCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Courier</TableHead>
              <TableHead>Invoice no</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead>State</TableHead>
              <TableHead className="text-right">Exceptions</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">
                  Loading invoices…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                  No invoices yet. Use <span className="font-medium">Import</span> to add one.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>
                    {isDraft(inv.state) ? (
                      <span className="font-medium">{inv.displayId}</span>
                    ) : (
                      <Link
                        to="/op/courier-settlement/$id"
                        params={{ id: inv.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {inv.displayId}
                      </Link>
                    )}
                    {inv.isRevision ? (
                      <Badge variant="outline" className="ml-2">
                        revision
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="capitalize">{inv.courier}</TableCell>
                  <TableCell className="font-mono text-xs">{inv.invoiceNo ?? '—'}</TableCell>
                  <TableCell>
                    {inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{inv.rowCount}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {isDraft(inv.state) ? '—' : money(inv.effectiveTotals?.net)}
                  </TableCell>
                  <TableCell>
                    <InvoiceStateBadge state={inv.state} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {inv.openExceptions ? (
                      <Badge variant="outline" className="bg-amber-100 text-amber-800">
                        {inv.openExceptions}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {isDraft(inv.state) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onResumeDraft?.(inv.id)}
                        title="Resume this analyzed draft — nothing has been imported yet"
                      >
                        Continue
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <div className="flex items-center justify-between border-t p-3 text-sm text-muted-foreground">
          <span>
            {meta ? `${meta.total} invoice(s) · page ${meta.page} of ${Math.max(meta.pages, 1)}` : ''}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!meta || page >= meta.pages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
