import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Wallet } from 'lucide-react'
import { format } from 'date-fns'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { creditApi } from '../api'

const fmtSigned = (v: number | string) => {
  const n = Number(v)
  const sign = n < 0 ? '-' : '+'
  return `${sign}৳${Math.abs(n).toLocaleString()}`
}

/**
 * Customer credit balance + mini-ledger (Task 11, JOB E).
 *
 * Live balance + newest-first entries from GET /customers/:id/credit.
 * Positive entries are credit granted (overpayment), negative are applied
 * against orders. D1 simple: balance, signed amounts, reason source, order
 * link, date. Empty state when the balance is zero.
 */
export function CreditBalanceCard({ customerId }: { customerId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['customer-credit', customerId],
    queryFn: () => creditApi.get(customerId),
    enabled: !!customerId,
  })

  const balance = Number(data?.balance ?? 0)
  const entries = data?.entries ?? []

  return (
    <Card className='shadow-2xs'>
      <CardHeader className='px-4 sm:px-5 pt-4 pb-2'>
        <div className='flex items-center justify-between gap-2 flex-wrap'>
          <div className='flex items-center gap-2'>
            <Wallet className='h-4 w-4 text-primary shrink-0' />
            <CardTitle className='text-sm sm:text-base font-semibold tracking-tight'>
              Credit Balance
            </CardTitle>
          </div>
          <div className='text-xl sm:text-2xl font-bold tracking-tight'>
            {`৳${balance.toLocaleString()}`}
          </div>
        </div>
      </CardHeader>
      <CardContent className='px-4 sm:px-5 pb-4'>
        {isLoading ? (
          <div className='h-16 rounded-xl border bg-card animate-pulse' />
        ) : entries.length === 0 ? (
          <p className='text-sm text-muted-foreground rounded-xl border border-dashed px-3 py-4 text-center'>
            No credit yet for this customer.
          </p>
        ) : (
          <div className='overflow-x-auto rounded-xl border'>
            <table className='w-full text-xs sm:text-sm'>
              <tbody>
                {entries.map((e) => {
                  const negative = Number(e.amount) < 0
                  // Reasons are `kind:orderId` (e.g. `overpayment:order-9`).
                  // Show the kind as the source and link the order separately
                  // so the order reference appears exactly once.
                  const kind = e.reason?.includes(':') ? e.reason.split(':')[0] : e.reason
                  return (
                    <tr key={e.id} className='border-b border-border/40 last:border-0 hover:bg-muted/30'>
                      <td className='px-3 py-2 text-muted-foreground whitespace-nowrap'>
                        {e.createdAt ? format(new Date(e.createdAt), 'MMM d, yyyy') : '—'}
                      </td>
                      <td className='px-3 py-2 text-muted-foreground'>
                        <span className='break-all'>{kind}</span>
                        {e.orderId && (
                          <Link
                            to='/op/orders/$id'
                            params={{ id: e.orderId }}
                            className='ml-1.5 font-mono text-[11px] font-semibold text-primary hover:underline whitespace-nowrap'
                          >
                            {e.orderId}
                          </Link>
                        )}
                      </td>
                      <td
                        className={`px-3 py-2 text-right font-bold whitespace-nowrap ${
                          negative
                            ? 'text-pink-600 dark:text-pink-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {fmtSigned(e.amount)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
