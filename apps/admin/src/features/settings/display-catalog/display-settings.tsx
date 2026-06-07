import { useState, useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { systemSettingsApi } from '../storage-api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { Loader2, Save, Image as ImageIcon } from 'lucide-react'

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

export function DisplaySettings() {
  const queryClient = useQueryClient()
  const { data: settings, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then(r => r.data),
  })

  const [mode, setMode] = useState<Mode>('preset')
  const [preset, setPreset] = useState<Preset>('square')
  const [customWidth, setCustomWidth] = useState<number>(3)
  const [customHeight, setCustomHeight] = useState<number>(4)
  const [scope, setScope] = useState<Scope>('all')

  useEffect(() => {
    if (settings) {
      const r = parseRatio(settings.catalogImageRatio)
      setMode(r.mode)
      setPreset(r.preset ?? 'square')
      setScope(r.scope)
      if (r.custom) {
        setCustomWidth(r.custom.width)
        setCustomHeight(r.custom.height)
      }
    }
  }, [settings])

  const setMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) => systemSettingsApi.set(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-settings'] }),
  })

  const previewRatio = useMemo<CatalogImageRatio>(() => {
    if (mode === 'custom') {
      return { mode: 'custom', custom: { width: customWidth, height: customHeight }, scope }
    }
    return { mode: 'preset', preset, scope }
  }, [mode, preset, customWidth, customHeight, scope])

  const customValid =
    Number.isInteger(customWidth) && Number.isInteger(customHeight) &&
    customWidth >= 1 && customHeight >= 1 &&
    customWidth <= 999 && customHeight <= 999

  const handleSave = () => {
    if (mode === 'custom' && !customValid) {
      toast.error('Custom ratio requires integers between 1 and 999')
      return
    }
    const value: CatalogImageRatio =
      mode === 'custom'
        ? { mode: 'custom', custom: { width: customWidth, height: customHeight }, scope }
        : { mode: 'preset', preset, scope }
    setMut.mutateAsync({ key: 'catalogImageRatio', value: JSON.stringify(value) })
      .then(() => toast.success('Display settings saved.'))
      .catch((err) => toast.error(err?.message || 'Failed to save display settings'))
  }

  if (isLoading) {
    return (
      <div className='flex items-center justify-center min-h-[400px]'>
        <Loader2 className='animate-spin h-8 w-8 text-primary' />
      </div>
    )
  }

  return (
    <div className='space-y-6 w-full pb-8'>
      <div className='space-y-0.5'>
        <h2 className='text-2xl font-bold tracking-tight'>Display</h2>
        <p className='text-muted-foreground'>
          Control how catalog grids present product and combo images across the storefront.
          Changes apply on next storefront request.
        </p>
      </div>
      <Separator className='my-6' />

      <Card>
        <CardHeader>
          <div className='flex items-center gap-2'>
            <ImageIcon className='h-5 w-5 text-primary' />
            <div>
              <CardTitle>Catalog Image Ratio</CardTitle>
              <CardDescription>Pick a preset or define a custom width-to-height ratio for catalog cards.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className='space-y-6'>
          <div className='grid gap-6 lg:grid-cols-2'>
            <RadioGroup
              value={mode === 'custom' ? 'custom' : preset}
              onValueChange={(v) => {
                if (v === 'custom') { setMode('custom') }
                else { setMode('preset'); setPreset(v as Preset) }
              }}
              className='space-y-3'
            >
              {PRESET_OPTIONS.map((opt) => (
                <label key={opt.value} className='flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/30 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5'>
                  <RadioGroupItem value={opt.value} id={`preset-${opt.value}`} className='mt-0.5' />
                  <div className='flex-1'>
                    <Label htmlFor={`preset-${opt.value}`} className='text-sm font-semibold cursor-pointer'>{opt.label}</Label>
                    <p className='text-xs text-muted-foreground mt-0.5'>{opt.description}</p>
                  </div>
                </label>
              ))}
              <label className='flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/30 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5'>
                <RadioGroupItem value='custom' id='preset-custom' className='mt-0.5' />
                <div className='flex-1 space-y-2'>
                  <Label htmlFor='preset-custom' className='text-sm font-semibold cursor-pointer'>Custom</Label>
                  <p className='text-xs text-muted-foreground'>Any positive integer ratio up to 999.</p>
                  {mode === 'custom' && (
                    <div className='flex items-center gap-2 pt-1'>
                      <div className='space-y-1'>
                        <Label htmlFor='custom-width' className='text-xs'>Width</Label>
                        <Input id='custom-width' type='number' min={1} max={999} step={1} value={customWidth} onChange={(e) => setCustomWidth(Math.floor(Number(e.target.value) || 0))} className='w-20' />
                      </div>
                      <span className='text-muted-foreground font-bold mt-6'>/</span>
                      <div className='space-y-1'>
                        <Label htmlFor='custom-height' className='text-xs'>Height</Label>
                        <Input id='custom-height' type='number' min={1} max={999} step={1} value={customHeight} onChange={(e) => setCustomHeight(Math.floor(Number(e.target.value) || 0))} className='w-20' />
                      </div>
                    </div>
                  )}
                </div>
              </label>
            </RadioGroup>

            <div className='rounded-lg border bg-muted/20 p-4'>
              <div className='flex items-center justify-between mb-3'>
                <span className='text-xs font-bold uppercase tracking-wider text-muted-foreground'>Live preview</span>
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
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)} className='grid gap-3 md:grid-cols-3'>
              {SCOPE_OPTIONS.map((opt) => (
                <label key={opt.value} className='flex items-start gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/30 transition-colors has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5'>
                  <RadioGroupItem value={opt.value} id={`scope-${opt.value}`} className='mt-0.5' />
                  <div className='flex-1'>
                    <Label htmlFor={`scope-${opt.value}`} className='text-sm font-semibold cursor-pointer'>{opt.label}</Label>
                    <p className='text-xs text-muted-foreground mt-0.5'>{opt.description}</p>
                  </div>
                </label>
              ))}
            </RadioGroup>
          </div>
        </CardContent>
      </Card>

      <div className='flex items-center justify-between p-4 bg-muted/40 rounded-xl border border-dashed border-muted-foreground/20'>
        <div className='text-sm text-muted-foreground'>Changes apply on the next storefront page load (or after the 5-minute config revalidate).</div>
        <Button onClick={handleSave} size='lg' className='px-8 shadow-lg shadow-primary/20 transition-all hover:scale-[1.02]' disabled={setMut.isPending || (mode === 'custom' && !customValid)}>
          {setMut.isPending ? <Loader2 className='animate-spin h-4 w-4 mr-2' /> : <Save className='h-4 w-4 mr-2' />}
          Save Display
        </Button>
      </div>
    </div>
  )
}
