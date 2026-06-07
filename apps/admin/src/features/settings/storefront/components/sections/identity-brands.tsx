import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Palette, Plus, X } from 'lucide-react'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

export function IdentityBrandsSection({ hook }: Props) {
  const sectionId = 'identity-brands'

  const storeSystems: { id: string; name: string; logo: string; display: 'name' | 'logo' | 'name+logo' }[] = (() => {
    try { return JSON.parse(hook.values.store_systems || '[]') } catch { return [] }
  })()

  const setStoreSystems = (systems: typeof storeSystems) => {
    hook.setValue('store_systems', JSON.stringify(systems))
  }

  const lastSavedAt = hook.lastSavedMap.store_systems ?? null

  return (
    <SectionShell
      id={sectionId}
      title='Brands & Systems'
      description='Manage brand systems shown in the storefront header and footer.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={lastSavedAt}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <div className='space-y-4'>
        {storeSystems.map((sys, idx) => (
          <div key={sys.id} className='flex items-start gap-3 rounded-lg border p-4 bg-muted/10'>
            <div className='flex items-center gap-3 flex-1 flex-wrap'>
              <div className='w-10 h-10 rounded border bg-background flex items-center justify-center overflow-hidden shrink-0'>
                {sys.logo ? (
                  <img src={sys.logo} alt='' className='w-full h-full object-contain' />
                ) : (
                  <Palette className='h-5 w-5 text-muted-foreground' />
                )}
              </div>
              <div className='space-y-1.5 min-w-0 flex-1'>
                <Input
                  value={sys.name}
                  onChange={e => {
                    const next = [...storeSystems]
                    next[idx] = { ...next[idx], name: e.target.value }
                    setStoreSystems(next)
                  }}
                  placeholder='System name'
                  className='h-8 text-sm'
                />
                <div className='flex items-center gap-2 flex-wrap'>
                  <select
                    value={sys.display}
                    onChange={e => {
                      const next = [...storeSystems]
                      next[idx] = { ...next[idx], display: e.target.value as 'name' | 'logo' | 'name+logo' }
                      setStoreSystems(next)
                    }}
                    className='h-8 rounded-md border border-input bg-background px-2 text-xs'
                  >
                    <option value='name'>Name only</option>
                    <option value='logo'>Logo only</option>
                    <option value='name+logo'>Name + Logo</option>
                  </select>
                </div>
              </div>
              <Button variant='ghost' size='icon' className='h-8 w-8 shrink-0 text-destructive' onClick={() => setStoreSystems(storeSystems.filter((_, i) => i !== idx))}>
                <X className='h-4 w-4' />
              </Button>
            </div>
          </div>
        ))}
        <Button variant='outline' size='sm' className='mt-2' onClick={() => setStoreSystems([...storeSystems, { id: crypto.randomUUID(), name: '', logo: '', display: 'name' }])}>
          <Plus className='h-4 w-4 mr-1' /> Add System
        </Button>
      </div>
    </SectionShell>
  )
}
