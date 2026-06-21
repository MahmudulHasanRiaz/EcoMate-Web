import { useEffect, useMemo, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useStorefrontSettings } from '@/features/settings/storefront/hooks/use-storefront-settings'
import { CategorySidebar } from '@/features/settings/storefront/components/category-sidebar'
import { CommandPalette, useCommandPalette } from '@/features/settings/storefront/components/command-palette'
import { IdentityStoreSection } from '@/features/settings/storefront/components/sections/identity-store'
import { IdentityBrandsSection } from '@/features/settings/storefront/components/sections/identity-brands'
import { VisualsHeroSection } from '@/features/settings/storefront/components/sections/visuals-hero'
import { VisualsFooterSection } from '@/features/settings/storefront/components/sections/visuals-footer'
import { ContentFaqSection } from '@/features/settings/storefront/components/sections/content-faq'
import { ContentHoursSection } from '@/features/settings/storefront/components/sections/content-hours'
import { ContentAboutSection } from '@/features/settings/storefront/components/sections/content-about'
import { DiscoverySeoSection } from '@/features/settings/storefront/components/sections/discovery-seo'
import { DiscoverySocialSection } from '@/features/settings/storefront/components/sections/discovery-social'
import { CommerceCheckoutSection } from '@/features/settings/storefront/components/sections/commerce-checkout'
import { CommerceOrderSection } from '@/features/settings/storefront/components/sections/commerce-order'
import { CatalogDisplaySection } from '@/features/settings/storefront/components/sections/catalog-display'
import {
  CATEGORIES,
  SECTIONS,
  getAllSections,
  type SectionId,
} from '@/features/settings/storefront/lib/categories'
import { Button } from '@/components/ui/button'

export function StorefrontSettings() {
  const hook = useStorefrontSettings()
  const palette = useCommandPalette()
  const [activeSectionId, setActiveSectionId] = useState<SectionId>('identity-store')

  const allSections = useMemo(() => getAllSections(), [])

  useEffect(() => {
    const sectionElements = allSections
      .map(s => document.querySelector(`[data-section-id="${s.id}"]`))
      .filter(Boolean) as HTMLElement[]

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.getAttribute('data-section-id') as SectionId
            if (id) setActiveSectionId(id)
          }
        }
      },
      { rootMargin: '-10% 0px -60% 0px', threshold: 0.4 }
    )

    sectionElements.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [allSections])

  const dirtySectionIds = useMemo(() => {
    return new Set(allSections.filter(s => hook.isSectionDirty(s.id)).map(s => s.id))
  }, [allSections, hook])

  const blocker = useBlocker({
    shouldBlockFn: () => dirtySectionIds.size > 0,
    enableBeforeUnload: true,
  }) as any

  const handleBlockerProceed = () => {
    blocker.proceed?.()
  }

  const handleBlockerReset = () => {
    blocker.reset?.()
  }

  const handleSectionClick = (sectionId: SectionId) => {
    const el = document.querySelector(`[data-section-id="${sectionId}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  if (hook.isLoading) {
    return (
      <div className='flex items-center justify-center min-h-[400px]'>
        <Loader2 className='animate-spin h-8 w-8 text-primary' />
      </div>
    )
  }

  return (
    <div className='space-y-6 w-full pb-8'>
      <div className='space-y-0.5'>
        <h2 className='text-2xl font-bold tracking-tight'>Storefront Settings</h2>
        <p className='text-muted-foreground'>
          Configure how your storefront looks and behaves. Changes are saved per section.
        </p>
      </div>
      <Separator className='my-6' />

      <div className='flex lg:hidden overflow-x-auto gap-2 pb-2 -mx-1 px-1 no-scrollbar snap-x snap-mandatory'>
        {allSections.map(section => {
          const Icon = section.icon
          const isActive = section.id === activeSectionId
          const isDirty = dirtySectionIds.has(section.id)
          return (
            <button
              key={section.id}
              onClick={() => handleSectionClick(section.id)}
              className={`snap-start shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border transition-colors ${
                isActive
                  ? 'bg-foreground text-background border-foreground'
                  : 'border-border/60 text-foreground/70 hover:text-foreground hover:bg-muted/30'
              }`}
            >
              <Icon className='h-3 w-3' />
              <span>{section.title}</span>
              {isDirty && <span className='w-1 h-1 rounded-full bg-current' />}
            </button>
          )
        })}
      </div>

      <div className='flex flex-col gap-6 lg:flex-row lg:gap-8'>
        <aside className='hidden lg:block w-full shrink-0 lg:w-64 lg:sticky lg:top-0 lg:self-start'>
          <CategorySidebar
            categories={CATEGORIES}
            sections={SECTIONS}
            activeSectionId={activeSectionId}
            dirtySectionIds={dirtySectionIds}
            onSectionClick={handleSectionClick}
            onOpenPalette={() => palette.setOpen(true)}
          />
        </aside>

        <div className='flex-1 min-w-0 space-y-8'>
          <IdentityStoreSection hook={hook} />
          <IdentityBrandsSection hook={hook} />
          <VisualsHeroSection hook={hook} />
          <VisualsFooterSection hook={hook} />
          <ContentFaqSection hook={hook} />
          <ContentHoursSection hook={hook} />
          <ContentAboutSection hook={hook} />

          <DiscoverySeoSection hook={hook} />
          <DiscoverySocialSection hook={hook} />
          <CommerceCheckoutSection hook={hook} />
          <CatalogDisplaySection hook={hook} />
          <CommerceOrderSection hook={hook} />
        </div>
      </div>

      <CommandPalette
        open={palette.open}
        onOpenChange={palette.setOpen}
        onNavigateToSection={handleSectionClick}
      />

      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(v) => { if (!v) handleBlockerReset() }}
        title='Unsaved Changes'
        desc='You have unsaved changes in one or more sections. What would you like to do?'
        confirmText='Discard & Leave'
        destructive
        handleConfirm={handleBlockerProceed}
      >
        <div className='flex flex-wrap gap-2 py-2'>
          <span className='text-xs text-muted-foreground'>
            {dirtySectionIds.size} section{dirtySectionIds.size > 1 ? 's' : ''} with unsaved changes.
          </span>
          <Button
            variant='outline'
            size='sm'
            className='w-full mt-2'
            onClick={() => {
              for (const id of dirtySectionIds) {
                hook.saveSection(id as SectionId)
              }
              handleBlockerProceed()
            }}
          >
            Save all sections &amp; leave
          </Button>
        </div>
      </ConfirmDialog>
    </div>
  )
}
