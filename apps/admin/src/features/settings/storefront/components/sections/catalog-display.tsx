import { useMemo } from 'react'
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { Image as ImageIcon } from 'lucide-react'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

type Preset = 'square' | '4-3' | '3-4' | '16-9'
type Scope = 'all' | 'product' | 'combo'
type Mode = 'preset' | 'custom'

interface CatalogImageRatio {
  mode: Mode
  preset?: Preset
  custom?: { width: number; height: number }
  scope: Scope
}

const DEFAULT_RATIO: CatalogImageRatio = {
  mode: 'preset',
  preset: 'square',
  scope: 'all',
}

const PRESET_OPTIONS: { value: Preset; label: string; description: string }[] = [
  { value: 'square', label: 'Square (1:1)', description: 'Balanced grid; current default' },
  { value: '4-3', label: '4:3 Landscape', description: 'Slightly wider than tall' },
  { value: '3-4', label: '3:4 Portrait', description: 'Taller, more vertical emphasis' },
  { value: '16-9', label: '16:9 Widescreen', description: 'Wide cinematic look' },
]

const SCOPE_OPTIONS: { value: Scope; label: string; description: string }[] = [
  { value: 'all', label: 'All', description: 'Products, combos, and wishlist' },
  { value: 'product', label: 'Products only', description: 'Product cards and wishlist' },
  { value: 'combo', label: 'Combos only', description: 'Combo deal cards' },
]

function parseRatio(raw: string | undefined): CatalogImageRatio {
  if (!raw) return { ...DEFAULT_RATIO }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_RATIO }
    const scope: Scope =
      parsed.scope === 'product' || parsed.scope === 'combo' || parsed.scope === 'all'
        ? parsed.scope
        : 'all'
    if (parsed.mode === 'custom' && parsed.custom) {
      const w = Number(parsed.custom.width)
      const h = Number(parsed.custom.height)
      if (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 && w <= 999 && h <= 999) {
        return { mode: 'custom', custom: { width: w, height: h }, scope }
      }
      return { ...DEFAULT_RATIO, scope }
    }
    if (parsed.mode === 'preset') {
      const preset: Preset =
        parsed.preset === 'square' ||
        parsed.preset === '4-3' ||
        parsed.preset === '3-4' ||
        parsed.preset === '16-9'
          ? parsed.preset
          : 'square'
      return { mode: 'preset', preset, scope }
    }
    return { ...DEFAULT_RATIO, scope }
  } catch {
    return { ...DEFAULT_RATIO }
  }
}

function ratioToAspect(ratio: CatalogImageRatio): string {
  if (ratio.mode === 'custom' && ratio.custom) {
    return `${ratio.custom.width} / ${ratio.custom.height}`
  }
  switch (ratio.preset) {
    case '4-3': return '4 / 3'
    case '3-4': return '3 / 4'
    case '16-9': return '16 / 9'
    default: return '1 / 1'
  }
}

function PreviewTile({ ratio, label }: { ratio: CatalogImageRatio; label: string }) {
  const aspect = ratioToAspect(ratio)
  return (
    <div className='flex flex-col items-center gap-2 flex-1 min-w-0'>
      <div
        className='w-full max-w-[120px] rounded-md border bg-muted/40 overflow-hidden flex items-center justify-center'
        style={{ aspectRatio: aspect }}
      >
        <ImageIcon className='h-5 w-5 text-muted-foreground' />
      </div>
      <span className='text-[10px] uppercase tracking-wider text-muted-foreground font-bold'>{label}</span>
    </div>
  )
}

interface Props { hook: UseStorefrontSettingsReturn }

export function CatalogDisplaySection({ hook }: Props) {
  const sectionId = 'catalog-display'

  const ratio = useMemo(() => parseRatio(hook.values.catalogImageRatio), [hook.values.catalogImageRatio])

  const mode = ratio.mode
  const preset = ratio.preset ?? 'square'
  const customWidth = ratio.custom?.width ?? 3
  const customHeight = ratio.custom?.height ?? 4
  const scope = ratio.scope

  const customValid =
    Number.isInteger(customWidth) &&
    Number.isInteger(customHeight) &&
    customWidth >= 1 &&
    customHeight >= 1 &&
    customWidth <= 999 &&
    customHeight <= 999

  const setRatio = (next: CatalogImageRatio) => {
    hook.setValue('catalogImageRatio', JSON.stringify(next))
  }

  const setModeAndPreset = (v: string) => {
    if (v === 'custom') {
      setRatio({ ...ratio, mode: 'custom' })
    } else {
      setRatio({ mode: 'preset', preset: v as Preset, scope })
    }
  }

  const setCustomWidth = (w: number) => {
    setRatio({ mode: 'custom', custom: { width: w, height: customHeight }, scope })
  }

  const setCustomHeight = (h: number) => {
    setRatio({ mode: 'custom', custom: { width: customWidth, height: h }, scope })
  }

  const setScope = (s: Scope) => {
    setRatio({ ...ratio, scope: s })
  }

  const previewRatio = useMemo<CatalogImageRatio>(() => {
    if (mode === 'custom') {
      return { mode: 'custom', custom: { width: customWidth, height: customHeight }, scope }
    }
    return { mode: 'preset', preset, scope }
  }, [mode, preset, customWidth, customHeight, scope])

  const lastSavedAt = hook.lastSavedMap.catalogImageRatio || hook.lastSavedMap.hide_oos_products || hook.lastSavedMap.default_variant_selected || hook.lastSavedMap.show_reviews || null

  return (
    <SectionShell
      id={sectionId}
      title='Catalog Image Ratio'
      description='Control how catalog grids present product and combo images across the storefront.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={lastSavedAt}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <div className='grid gap-6 lg:grid-cols-2'>
        <RadioGroup
          value={mode === 'custom' ? 'custom' : preset}
          onValueChange={setModeAndPreset}
          className='space-y-3'
        >
          {PRESET_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className='flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/30 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5'
            >
              <RadioGroupItem value={opt.value} id={`preset-${opt.value}`} className='mt-0.5' />
              <div className='flex-1'>
                <Label htmlFor={`preset-${opt.value}`} className='text-sm font-semibold cursor-pointer'>
                  {opt.label}
                </Label>
                <p className='text-xs text-muted-foreground mt-0.5'>{opt.description}</p>
              </div>
            </label>
          ))}
          <label className='flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/30 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5'>
            <RadioGroupItem value='custom' id='preset-custom' className='mt-0.5' />
            <div className='flex-1 space-y-2'>
              <Label htmlFor='preset-custom' className='text-sm font-semibold cursor-pointer'>
                Custom
              </Label>
              <p className='text-xs text-muted-foreground'>Any positive integer ratio up to 999.</p>
              {mode === 'custom' && (
                <div className='flex items-center gap-2 pt-1'>
                  <div className='space-y-1'>
                    <Label htmlFor='custom-width' className='text-xs'>Width</Label>
                    <Input
                      id='custom-width'
                      type='number'
                      min={1}
                      max={999}
                      step={1}
                      value={customWidth}
                      onChange={(e) => setCustomWidth(Math.floor(Number(e.target.value) || 0))}
                      className='w-20'
                    />
                  </div>
                  <span className='text-muted-foreground font-bold mt-6'>/</span>
                  <div className='space-y-1'>
                    <Label htmlFor='custom-height' className='text-xs'>Height</Label>
                    <Input
                      id='custom-height'
                      type='number'
                      min={1}
                      max={999}
                      step={1}
                      value={customHeight}
                      onChange={(e) => setCustomHeight(Math.floor(Number(e.target.value) || 0))}
                      className='w-20'
                    />
                  </div>
                </div>
              )}
            </div>
          </label>
        </RadioGroup>

        <div className='rounded-lg border bg-muted/20 p-4'>
          <div className='flex items-center justify-between mb-3'>
            <span className='text-xs font-bold uppercase tracking-wider text-muted-foreground'>
              Live preview
            </span>
            <span className='text-xs text-muted-foreground'>{ratioToAspect(previewRatio)}</span>
          </div>
          <div className='flex items-end gap-3'>
            <PreviewTile ratio={previewRatio} label='Tile 1' />
            <PreviewTile ratio={previewRatio} label='Tile 2' />
            <PreviewTile ratio={previewRatio} label='Tile 3' />
            <PreviewTile ratio={previewRatio} label='Tile 4' />
          </div>
        </div>
      </div>

      <Separator />

      <div>
        <div className='text-sm font-semibold mb-3'>Apply to</div>
        <RadioGroup
          value={scope}
          onValueChange={(v) => setScope(v as Scope)}
          className='grid gap-3 md:grid-cols-3'
        >
          {SCOPE_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className='flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/30 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5'
            >
              <RadioGroupItem value={opt.value} id={`scope-${opt.value}`} className='mt-0.5' />
              <div className='flex-1'>
                <Label htmlFor={`scope-${opt.value}`} className='text-sm font-semibold cursor-pointer'>
                  {opt.label}
                </Label>
                <p className='text-xs text-muted-foreground mt-0.5'>{opt.description}</p>
              </div>
            </label>
          ))}
        </RadioGroup>
      </div>

      <Separator />

      <Field
        fieldKey='hide_oos_products'
        schema={FIELD_SCHEMAS.hide_oos_products}
        value={hook.values.hide_oos_products ?? 'false'}
        onChange={v => hook.setValue('hide_oos_products', v as string)}
      />

      <Separator />

      <Field
        fieldKey='default_variant_selected'
        schema={FIELD_SCHEMAS.default_variant_selected}
        value={hook.values.default_variant_selected ?? 'true'}
        onChange={v => hook.setValue('default_variant_selected', v as string)}
      />

      <Separator />

      <Field
        fieldKey='show_reviews'
        schema={FIELD_SCHEMAS.show_reviews}
        value={hook.values.show_reviews ?? 'true'}
        onChange={v => hook.setValue('show_reviews', v as string)}
      />
    </SectionShell>
  )
}
