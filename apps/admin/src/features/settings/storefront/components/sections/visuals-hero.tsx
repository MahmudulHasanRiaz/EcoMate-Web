import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ImageIcon, Plus, X } from 'lucide-react'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

interface HeroSlide {
  image: string; link?: string; alt?: string
}

export function VisualsHeroSection({ hook }: Props) {
  const sectionId = 'visuals-hero'

  const heroSlides: HeroSlide[] = (() => {
    try { return JSON.parse(hook.values.hero_slides || '[]') as HeroSlide[] } catch { return [] }
  })()

  const setHeroSlides = (slides: HeroSlide[]) => {
    hook.setValue('hero_slides', JSON.stringify(slides))
  }

  const lastSavedAt = (() => {
    const t = hook.lastSavedMap.hero_slides || hook.lastSavedMap.hero_secondary_banner || hook.lastSavedMap.hero_secondary_banner_alt
    return t || null
  })()

  return (
    <SectionShell
      id={sectionId}
      title='Hero Banner'
      description='Slider images and secondary banner on the homepage.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={lastSavedAt}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <div className='space-y-4'>
        <div>
          <Label className='text-xs font-medium text-foreground/80'>Hero Slides</Label>
          <p className='text-xs text-muted-foreground mb-2'>Banner images shown on the homepage slider.</p>
          {heroSlides.map((slide, i) => (
            <div key={i} className='flex items-start gap-3 p-4 border rounded-lg bg-muted/30 mb-3'>
              <div className='h-20 w-32 rounded border overflow-hidden bg-muted shrink-0 flex items-center justify-center'>
                {slide.image
                  ? <img src={slide.image} alt={slide.alt || ''} className='h-full w-full object-cover' />
                  : <ImageIcon className='h-6 w-6 text-muted-foreground' />}
              </div>
              <div className='flex-1 space-y-3'>
                <div className='space-y-2'>
                  <Label className='text-xs'>Image URL</Label>
                  <Input value={slide.image || ''} onChange={e => {
                    const next = [...heroSlides]; next[i] = { ...next[i], image: e.target.value }; setHeroSlides(next)
                  }} placeholder='https://example.com/banner.jpg' />
                </div>
                <div className='grid grid-cols-2 gap-3'>
                  <div className='space-y-2'>
                    <Label className='text-xs'>Link (optional)</Label>
                    <Input value={slide.link || ''} onChange={e => {
                      const next = [...heroSlides]; next[i] = { ...next[i], link: e.target.value }; setHeroSlides(next)
                    }} placeholder='/products' />
                  </div>
                  <div className='space-y-2'>
                    <Label className='text-xs'>Alt text</Label>
                    <Input value={slide.alt || ''} onChange={e => {
                      const next = [...heroSlides]; next[i] = { ...next[i], alt: e.target.value }; setHeroSlides(next)
                    }} placeholder='Slide description' />
                  </div>
                </div>
              </div>
              <Button variant='ghost' size='icon' className='mt-6 shrink-0 text-destructive' onClick={() => setHeroSlides(heroSlides.filter((_, j) => j !== i))}>
                <X className='h-4 w-4' />
              </Button>
            </div>
          ))}
          <Button variant='outline' size='sm' onClick={() => setHeroSlides([...heroSlides, { image: '' }])}>
            <Plus className='h-4 w-4 mr-1' /> Add Slide
          </Button>
        </div>
      </div>

      <div className='space-y-3'>
        <Label className='text-xs font-medium text-foreground/80'>Secondary Banner</Label>
        <div className='flex items-start gap-3'>
          <div className='h-32 w-full max-w-md rounded border overflow-hidden bg-muted shrink-0 flex items-center justify-center'>
            {hook.values.hero_secondary_banner
              ? <img src={hook.values.hero_secondary_banner} alt={hook.values.hero_secondary_banner_alt || ''} className='h-full w-full object-cover' />
              : <ImageIcon className='h-8 w-8 text-muted-foreground' />}
          </div>
        </div>
        <div className='grid gap-3 md:grid-cols-2 max-w-2xl'>
          <Field fieldKey='hero_secondary_banner' schema={FIELD_SCHEMAS.hero_secondary_banner} value={hook.values.hero_secondary_banner ?? ''} onChange={v => hook.setValue('hero_secondary_banner', v as string)} />
          <Field fieldKey='hero_secondary_banner_alt' schema={FIELD_SCHEMAS.hero_secondary_banner_alt} value={hook.values.hero_secondary_banner_alt ?? ''} onChange={v => hook.setValue('hero_secondary_banner_alt', v as string)} />
        </div>
      </div>
    </SectionShell>
  )
}
