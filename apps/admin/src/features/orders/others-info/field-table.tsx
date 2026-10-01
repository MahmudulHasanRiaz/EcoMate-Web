import { Fragment, useMemo, useState } from 'react'
import { Search, Copy, Check } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { copyToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import type { OthersField, OthersFieldState } from '../api'

/** Visual treatment per state. Never a fake value — a real "we don't know". */
export const STATE_STYLE: Record<OthersFieldState, { label: string; className: string }> = {
  present: { label: 'Present', className: 'text-foreground' },
  missing: { label: 'Missing', className: 'text-amber-600 dark:text-amber-500' },
  not_collected: { label: 'Not collected', className: 'text-muted-foreground italic' },
  not_applicable: { label: 'N/A', className: 'text-muted-foreground' },
  null: { label: 'Null', className: 'text-muted-foreground italic' },
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

/** Values that read better in a monospace face (IPs, ids, tokens, emails). */
const ID_LIKE = /^(https?:\/\/|[\d.:a-f-]{8,})|@/i;

function isIdLike(value: unknown): boolean {
  return typeof value === 'string' && ID_LIKE.test(value);
}

export function CopyableValue({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false)
  const text = renderValue(value)
  if (text === '—') return <span className='text-muted-foreground'>—</span>
  const long = text.length > 400
  return (
    <button
      type='button'
      onClick={() => {
        copyToClipboard(text, 'value')
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      className='group flex w-full items-start gap-1 text-left hover:text-foreground'
      title={text}
    >
      {/* min-w-0 is required: a flex child will otherwise refuse to shrink
          below its content width, which is what forced one-char-per-line. */}
      <span
        className={cn(
          'min-w-0 flex-1 break-words text-xs',
          long && 'line-clamp-3',
          isIdLike(value) && 'font-mono',
        )}
      >
        {long ? `${text.slice(0, 400)}…` : text}
      </span>
      <span className='mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-100'>
        {copied ? <Check className='size-3 text-emerald-500' /> : <Copy className='size-3' />}
      </span>
    </button>
  )
}

/**
 * Dense, spreadsheet-style key/value table.
 *
 * Sticky header, grouped rows, per-row state badge, click-to-copy values, and
 * an in-section field filter. Kept hand-rolled rather than using the full
 * virtualized source-sheet grid: section sizes are small, and the wide-column
 * machinery would add weight without buying anything here.
 */
export function FieldTable({
  fields,
  emptyMessage = 'Nothing to show.',
}: {
  fields: OthersField[]
  emptyMessage?: string
}) {
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? fields.filter(
          (f) =>
            f.label.toLowerCase().includes(q) ||
            f.key.toLowerCase().includes(q) ||
            String(renderValue(f.value)).toLowerCase().includes(q),
        )
      : fields
    const map = new Map<string, OthersField[]>()
    for (const f of filtered) {
      const g = f.group ?? ''
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(f)
    }
    return [...map.entries()]
  }, [fields, query])

  if (fields.length === 0) {
    return <p className='px-3 py-6 text-center text-xs text-muted-foreground'>{emptyMessage}</p>
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col gap-2'>
      <div className='flex items-center gap-2'>
        <div className='relative max-w-xs flex-1'>
          <Search className='pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground' />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder='Filter fields…'
            className='h-7 pl-7 text-xs'
          />
        </div>
        <Button
          variant='ghost'
          size='sm'
          className='tap-h text-xs'
          onClick={() =>
            copyToClipboard(
              fields
                .map((f) => `${f.label}: ${renderValue(f.value)}`)
                .join('\n'),
              'section',
            )
          }
        >
          Copy section
        </Button>
      </div>

      <div className='min-h-0 flex-1 overflow-auto rounded-md border'>
        <table className='w-full table-fixed border-separate border-spacing-0 text-xs'>
          <colgroup>
            {/* Fixed side columns; the value column takes the remainder. Using
                percentages collapses the middle column once the nav rail takes
                its share — the value is the column that must stay readable. */}
            <col style={{ width: '13rem' }} />
            <col />
            <col style={{ width: '7.5rem' }} />
          </colgroup>
          <thead className='sticky top-0 z-10'>
            <tr>
              {['Field', 'Value', 'State'].map((h) => (
                <th
                  key={h}
                  className='border-b bg-muted px-2.5 py-1.5 text-left font-medium text-muted-foreground'
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([group, rows]) => (
              <Fragment key={group || '__ungrouped'}>
                {group ? (
                  <tr>
                    <td
                      colSpan={3}
                      className='border-b bg-muted/40 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground'
                    >
                      {group}
                    </td>
                  </tr>
                ) : null}
                {rows.map((f) => {
                  const style = STATE_STYLE[f.state] ?? STATE_STYLE.not_collected
                  return (
                    <tr key={f.key} className='group align-top hover:bg-accent/40'>
                      <td className='border-b border-r px-2.5 py-1.5 font-medium leading-snug'>
                        {f.label}
                      </td>
                      <td className='border-b px-2.5 py-1.5 align-top'>
                        <CopyableValue value={f.value} />
                      </td>
                      <td className='border-b px-2.5 py-1.5 align-top'>
                        <Badge
                          variant='outline'
                          className={cn('px-1.5 py-0 text-[10px] font-normal whitespace-nowrap', style.className)}
                        >
                          {style.label}
                        </Badge>
                      </td>
                    </tr>
                  )
                })}
              </Fragment>
            ))}
            {groups.length === 0 && (
              <tr>
                <td colSpan={3} className='px-2.5 py-6 text-center text-muted-foreground'>
                  No field matches “{query}”.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
