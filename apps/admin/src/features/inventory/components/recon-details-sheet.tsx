import { Fragment, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { ReconReport } from '../reconciliation'
import { buildReconSheetRows } from './recon-helpers'

/**
 * Details sheet for the Reconciliation one-click-fix flow (2026-11-12).
 * One row per finding — Problem | Order / Item | Qty | Result — plain
 * English, no R-codes, no UUIDs in the main view. The backend evidence
 * and the full quantity breakdown stay reachable behind each row's
 * expansion, never dropped. The row id is used only as the React key /
 * expansion identity; it is never rendered (it embeds R-codes and UUIDs).
 */
export function ReconDetailsSheet({ report }: { report: ReconReport }) {
  const rows = buildReconSheetRows(report)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)

  return (
    <Card>
      <CardHeader className='pb-0'>
        <CardTitle className='text-sm'>Findings ({rows.length})</CardTitle>
      </CardHeader>
      <CardContent className='px-0 pb-0'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Problem</TableHead>
              <TableHead>Order / Item</TableHead>
              <TableHead className='text-right'>Qty</TableHead>
              <TableHead>Result</TableHead>
              <TableHead className='w-10' />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className='text-center text-muted-foreground'
                >
                  No findings — every received return has its matching ledger
                  adds.
                </TableCell>
              </TableRow>
            )}
            {rows.map((row) => {
              const open = expandedKey === row.key
              return (
                <Fragment key={row.key}>
                  <TableRow>
                    <TableCell className='font-medium'>{row.problem}</TableCell>
                    <TableCell>
                      <div className='font-medium'>{row.orderLabel}</div>
                      <div className='text-xs text-muted-foreground'>
                        {row.itemLabel}
                      </div>
                    </TableCell>
                    <TableCell className='text-right'>
                      {row.qty ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant='outline'
                        className={
                          row.result === 'Auto-fix'
                            ? 'border-green-600/30 bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200'
                            : 'border-amber-600/30 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                        }
                      >
                        {row.result}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant='ghost'
                        size='sm'
                        aria-label={`Details for ${row.orderLabel} ${row.itemLabel}`}
                        aria-expanded={open}
                        onClick={() =>
                          setExpandedKey((v) =>
                            v === row.key ? null : row.key
                          )
                        }
                      >
                        {open ? (
                          <ChevronUp className='h-4 w-4' />
                        ) : (
                          <ChevronDown className='h-4 w-4' />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                  {open && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <div className='space-y-1 text-xs text-muted-foreground'>
                          <p>{row.detail}</p>
                          <p>
                            Return: {row.returnLabel ?? '—'} · Layer:{' '}
                            {row.layer} · Ordered {row.orderedQty} · Received
                            good {row.receivedGoodQty} · Damaged{' '}
                            {row.damagedQty} · Restored{' '}
                            {row.alreadyRestoredManaged}/
                            {row.alreadyRestoredPhysical} · Missing{' '}
                            {row.missingManagedQty}/{row.missingPhysicalQty}
                          </p>
                          <p>
                            <span className='font-medium text-foreground'>
                              Evidence:{' '}
                            </span>
                            {row.evidence}
                          </p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
