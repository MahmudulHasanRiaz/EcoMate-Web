import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Trash2 } from 'lucide-react'
import type {
  CustomizationGroupDef,
  CustomizationOptionDef,
} from '@/lib/customization'

/**
 * Definition editor for product customization (owner Q15): groups of
 * priced options (single/multi choice) or a free-text field. Every
 * option carries BOTH a sell price and a cost price; pricing kind says
 * whether the delta applies per unit or once per order line.
 */

function slugKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
}

/**
 * The key follows the label while it is still the auto-derived value of
 * the PREVIOUS label (or empty). The moment the stored key differs from
 * what the previous label derives to, the user edited it by hand and it
 * is never overwritten. (Deriving only from an empty key froze the key
 * at the first typed character — "G" → "g" — for every group/option.)
 */
function deriveKey(currentKey: string, previousLabel: string, nextLabel: string): string {
  if (!currentKey || currentKey === slugKey(previousLabel)) return slugKey(nextLabel)
  return currentKey
}

const num = (v: string) => {
  const n = parseFloat(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function CustomizationEditor({
  value,
  onChange,
}: {
  value: CustomizationGroupDef[]
  onChange: (next: CustomizationGroupDef[]) => void
}) {
  const groups = value || []

  const patchGroup = (gi: number, patch: Partial<CustomizationGroupDef>) => {
    onChange(groups.map((g, i) => (i === gi ? { ...g, ...patch } : g)))
  }
  const patchOption = (gi: number, oi: number, patch: Partial<CustomizationOptionDef>) => {
    onChange(
      groups.map((g, i) =>
        i === gi
          ? { ...g, options: (g.options || []).map((o, j) => (j === oi ? { ...o, ...patch } : o)) }
          : g,
      ),
    )
  }
  const addGroup = () => {
    onChange([
      ...groups,
      {
        key: '',
        label: '',
        type: 'single',
        required: false,
        options: [{ key: '', label: '', priceDelta: 0, costDelta: 0, pricingKind: 'per_unit' }],
      },
    ])
  }
  const removeGroup = (gi: number) => onChange(groups.filter((_, i) => i !== gi))
  const addOption = (gi: number) => {
    const g = groups[gi]
    patchGroup(gi, {
      options: [
        ...(g.options || []),
        { key: '', label: '', priceDelta: 0, costDelta: 0, pricingKind: 'per_unit' },
      ],
    })
  }
  const removeOption = (gi: number, oi: number) => {
    const g = groups[gi]
    patchGroup(gi, { options: (g.options || []).filter((_, j) => j !== oi) })
  }

  return (
    <div className='space-y-4'>
      <p className='text-xs text-muted-foreground'>
        Customers pick these on the product page. Prices are extra amounts added to the
        product price; cost is your internal expense and flows into profit reports.
        Changes apply to new orders only — placed orders keep the prices they were
        ordered with.
      </p>

      {groups.map((g, gi) => (
        <div key={gi} className='border rounded-lg p-4 space-y-3'>
          <div className='flex items-start gap-3'>
            <div className='flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3'>
              <div className='space-y-1.5'>
                <Label className='text-xs'>Group label</Label>
                <Input
                  value={g.label}
                  placeholder='e.g. Name Engraving'
                  onChange={(e) => {
                    const label = e.target.value
                    patchGroup(gi, { label, key: deriveKey(g.key, g.label, label) })
                  }}
                />
              </div>
              <div className='space-y-1.5'>
                <Label className='text-xs'>Group key (stable id)</Label>
                <Input
                  value={g.key}
                  placeholder='engraving'
                  onChange={(e) => patchGroup(gi, { key: e.target.value })}
                />
              </div>
            </div>
            <Button type='button' variant='ghost' size='icon' onClick={() => removeGroup(gi)}>
              <Trash2 className='h-4 w-4 text-destructive' />
            </Button>
          </div>

          <div className='flex flex-wrap items-center gap-4'>
            <div className='space-y-1.5'>
              <Label className='text-xs'>Type</Label>
              <Select
                value={g.type}
                onValueChange={(v) =>
                  patchGroup(gi, {
                    type: v as CustomizationGroupDef['type'],
                    ...(v === 'text'
                      ? { options: undefined, maxLength: g.maxLength ?? 20, priceDelta: g.priceDelta ?? 0, costDelta: g.costDelta ?? 0 }
                      : { options: g.options?.length ? g.options : [{ key: '', label: '', priceDelta: 0, costDelta: 0, pricingKind: 'per_unit' as const }] }),
                  })
                }
              >
                <SelectTrigger className='w-44'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='single'>Single choice</SelectItem>
                  <SelectItem value='multi'>Multiple choice</SelectItem>
                  <SelectItem value='text'>Free text</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className='flex items-center gap-2 pt-5 cursor-pointer'>
              <Checkbox
                checked={!!g.required}
                onCheckedChange={(c) => patchGroup(gi, { required: c === true })}
              />
              <span className='text-sm'>Required</span>
            </label>
          </div>

          {g.type === 'text' ? (
            <div className='grid grid-cols-1 sm:grid-cols-3 gap-3'>
              <div className='space-y-1.5'>
                <Label className='text-xs'>Max characters</Label>
                <Input
                  type='number'
                  min='1'
                  max='1000'
                  value={g.maxLength ?? 20}
                  onChange={(e) => patchGroup(gi, { maxLength: Math.max(1, parseInt(e.target.value) || 1) })}
                />
              </div>
              <div className='space-y-1.5'>
                <Label className='text-xs'>Extra price (৳)</Label>
                <Input
                  type='number'
                  min='0'
                  value={g.priceDelta ?? 0}
                  onChange={(e) => patchGroup(gi, { priceDelta: num(e.target.value) })}
                />
              </div>
              <div className='space-y-1.5'>
                <Label className='text-xs'>Extra cost (৳)</Label>
                <Input
                  type='number'
                  min='0'
                  value={g.costDelta ?? 0}
                  onChange={(e) => patchGroup(gi, { costDelta: num(e.target.value) })}
                />
              </div>
            </div>
          ) : (
            <div className='space-y-2'>
              <div className='grid grid-cols-[1fr_110px_110px_130px_32px] gap-2 text-xs text-muted-foreground px-1'>
                <span>Option label</span>
                <span>Extra price (৳)</span>
                <span>Extra cost (৳)</span>
                <span>Charged</span>
                <span />
              </div>
              {(g.options || []).map((o, oi) => (
                <div key={oi} className='grid grid-cols-[1fr_110px_110px_130px_32px] gap-2 items-center'>
                  <Input
                    value={o.label}
                    placeholder='e.g. Gold Foil'
                    onChange={(e) => {
                      const label = e.target.value
                      patchOption(gi, oi, { label, key: deriveKey(o.key, o.label, label) })
                    }}
                  />
                  <Input
                    type='number'
                    min='0'
                    value={o.priceDelta}
                    onChange={(e) => patchOption(gi, oi, { priceDelta: num(e.target.value) })}
                  />
                  <Input
                    type='number'
                    min='0'
                    value={o.costDelta}
                    onChange={(e) => patchOption(gi, oi, { costDelta: num(e.target.value) })}
                  />
                  <Select
                    value={o.pricingKind}
                    onValueChange={(v) =>
                      patchOption(gi, oi, { pricingKind: v as 'per_unit' | 'per_line' })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value='per_unit'>Per unit</SelectItem>
                      <SelectItem value='per_line'>Per order line</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button type='button' variant='ghost' size='icon' onClick={() => removeOption(gi, oi)}>
                    <Trash2 className='h-4 w-4 text-destructive' />
                  </Button>
                </div>
              ))}
              <Button type='button' variant='outline' size='sm' onClick={() => addOption(gi)}>
                <Plus className='h-3.5 w-3.5 mr-1' /> Add option
              </Button>
            </div>
          )}
        </div>
      ))}

      <Button type='button' variant='outline' onClick={addGroup}>
        <Plus className='h-4 w-4 mr-1' /> Add customization group
      </Button>
    </div>
  )
}
