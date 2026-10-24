import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  asSnapshot,
  type CustomizationGroupDef,
  type CustomizationSelection,
} from '@/lib/customization'

/**
 * Answer input for one product's customization definition (admin order
 * create/edit). The storefront renders its own variant of the same
 * model; both send keys/text only — prices always resolve server-side.
 */
export function CustomizationInput({
  definition,
  value,
  onChange,
  disabled,
}: {
  definition: CustomizationGroupDef[]
  value: CustomizationSelection | undefined
  onChange: (next: CustomizationSelection) => void
  disabled?: boolean
}) {
  const groups = definition || []
  const answerOf = (key: string) => value?.groups.find((g) => g.key === key)

  const setAnswer = (key: string, patch: { optionKeys?: string[]; text?: string }) => {
    const rest = (value?.groups || []).filter((g) => g.key !== key)
    onChange({ groups: [...rest, { key, ...patch }] })
  }

  if (groups.length === 0) return null

  return (
    <div className='space-y-3 rounded-md border border-dashed p-3 bg-muted/20'>
      {groups.map((g) => {
        const ans = answerOf(g.key)
        return (
          <div key={g.key} className='space-y-1.5'>
            <div className='text-xs font-medium'>
              {g.label}
            </div>
            {g.type === 'text' ? (
              <div>
                <Input
                  value={ans?.text || ''}
                  disabled={disabled}
                  maxLength={g.maxLength || undefined}
                  placeholder={g.priceDelta ? `+৳${g.priceDelta}` : 'Enter text'}
                  onChange={(e) => setAnswer(g.key, { text: e.target.value })}
                  className='h-8 text-sm'
                />
                {g.maxLength ? (
                  <div className='text-[10px] text-muted-foreground mt-0.5'>
                    {(ans?.text || '').length}/{g.maxLength}
                  </div>
                ) : null}
              </div>
            ) : g.type === 'single' ? (
              <div className='flex flex-wrap gap-1.5'>
                {/* D14/D16: add-ons are always optional — a None choice exists
                    for every single-choice group, even legacy required-flagged
                    ones, so staff can always place a plain order. */}
                <button
                  type='button'
                  disabled={disabled}
                  onClick={() => setAnswer(g.key, { optionKeys: [] })}
                  className={`px-2 py-1 rounded text-xs border ${(ans?.optionKeys || []).length === 0 ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
                >
                  None
                </button>
                {(g.options || []).map((o) => {
                  const active = (ans?.optionKeys || []).includes(o.key)
                  return (
                    <button
                      key={o.key}
                      type='button'
                      disabled={disabled}
                      onClick={() => setAnswer(g.key, { optionKeys: [o.key] })}
                      className={`px-2 py-1 rounded text-xs border ${active ? 'bg-primary text-primary-foreground' : 'bg-background'}`}
                    >
                      {o.label}
                      {o.priceDelta > 0 && <span className='opacity-80'> +৳{o.priceDelta}</span>}
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className='flex flex-wrap gap-3'>
                {(g.options || []).map((o) => {
                  const selected = ans?.optionKeys || []
                  const active = selected.includes(o.key)
                  return (
                    <label key={o.key} className='flex items-center gap-1.5 text-xs cursor-pointer'>
                      <Checkbox
                        disabled={disabled}
                        checked={active}
                        onCheckedChange={(c) =>
                          setAnswer(g.key, {
                            optionKeys: c
                              ? [...selected, o.key]
                              : selected.filter((k) => k !== o.key),
                          })
                        }
                      />
                      {o.label}
                      {o.priceDelta > 0 && (
                        <span className='text-muted-foreground'>+৳{o.priceDelta}</span>
                      )}
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** Read-only snapshot lines (order detail / lists): labels + text, no prices. */
export function CustomizationSummary({ snapshot }: { snapshot: unknown }) {
  const snap = asSnapshot(snapshot)
  if (!snap) return null
  return (
    <div className='space-y-0.5'>
      <Badge variant='outline' className='text-[10px] px-1.5 py-0 uppercase'>
        Customized
      </Badge>
      {snap.groups.map((g) => (
        <div key={g.key} className='text-[11px] text-muted-foreground leading-snug'>
          <span className='font-medium text-foreground/70'>{g.label}:</span>{' '}
          {g.type === 'text'
            ? `“${g.text}”`
            : g.options.map((o) => o.label).join(', ')}
        </div>
      ))}
    </div>
  )
}
