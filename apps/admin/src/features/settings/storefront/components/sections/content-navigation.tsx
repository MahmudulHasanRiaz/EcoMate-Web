import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Plus, X, GripVertical } from 'lucide-react'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

interface NavItem {
  label: string; href: string
}

export function ContentNavigationSection({ hook }: Props) {
  const sectionId = 'content-navigation'

  const navItems: NavItem[] = (() => {
    try { return JSON.parse(hook.values.navigation_items || '[]') as NavItem[] } catch { return [] }
  })()

  const setNavItems = (items: NavItem[]) => {
    hook.setValue('navigation_items', JSON.stringify(items))
  }

  const lastSavedAt = hook.lastSavedMap.navigation_items ?? null

  return (
    <SectionShell
      id={sectionId}
      title='Navigation Menu'
      description='Header navigation items shown in the top bar.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={lastSavedAt}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <div className='space-y-3'>
        {navItems.map((item, i) => (
          <div key={i} className='flex items-center gap-2 p-3 border rounded-lg bg-muted/20'>
            <GripVertical className='h-4 w-4 text-muted-foreground shrink-0' />
            <Input value={item.label} onChange={e => {
              const next = [...navItems]; next[i] = { ...next[i], label: e.target.value }; setNavItems(next)
            }} placeholder='Label' className='h-8 text-sm flex-1' />
            <Input value={item.href} onChange={e => {
              const next = [...navItems]; next[i] = { ...next[i], href: e.target.value }; setNavItems(next)
            }} placeholder='/page' className='h-8 text-sm flex-1' />
            <Button variant='ghost' size='icon' className='h-8 w-8 shrink-0 text-destructive' onClick={() => setNavItems(navItems.filter((_, j) => j !== i))}>
              <X className='h-4 w-4' />
            </Button>
          </div>
        ))}
        <Button variant='outline' size='sm' onClick={() => setNavItems([...navItems, { label: '', href: '' }])}>
          <Plus className='h-4 w-4 mr-1' /> Add Item
        </Button>
      </div>
    </SectionShell>
  )
}
