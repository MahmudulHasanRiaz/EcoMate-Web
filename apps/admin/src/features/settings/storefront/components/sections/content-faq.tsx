import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Plus, X } from 'lucide-react'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

interface FaqItem {
  question: string; answer: string
}

export function ContentFaqSection({ hook }: Props) {
  const sectionId = 'content-faq'

  const faqItems: FaqItem[] = (() => {
    try { return JSON.parse(hook.values.faq_items || '[]') as FaqItem[] } catch { return [] }
  })()

  const setFaqItems = (items: FaqItem[]) => {
    hook.setValue('faq_items', JSON.stringify(items))
  }

  const lastSavedAt = hook.lastSavedMap.faq_items ?? null

  return (
    <SectionShell
      id={sectionId}
      title='FAQ Items'
      description='Frequently asked questions on the FAQ page.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={lastSavedAt}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <div className='space-y-4'>
        {faqItems.map((item, i) => (
          <div key={i} className='p-4 border rounded-lg bg-muted/20 space-y-3'>
            <div className='flex items-center gap-2'>
              <Input value={item.question} onChange={e => {
                const next = [...faqItems]; next[i] = { ...next[i], question: e.target.value }; setFaqItems(next)
              }} placeholder='Question' className='h-8 text-sm flex-1' />
              <Button variant='ghost' size='icon' className='h-8 w-8 shrink-0 text-destructive' onClick={() => setFaqItems(faqItems.filter((_, j) => j !== i))}>
                <X className='h-4 w-4' />
              </Button>
            </div>
            <Textarea value={item.answer} onChange={e => {
              const next = [...faqItems]; next[i] = { ...next[i], answer: e.target.value }; setFaqItems(next)
            }} placeholder='Answer' className='text-sm min-h-[60px]' />
          </div>
        ))}
        <Button variant='outline' size='sm' onClick={() => setFaqItems([...faqItems, { question: '', answer: '' }])}>
          <Plus className='h-4 w-4 mr-1' /> Add FAQ
        </Button>
      </div>
    </SectionShell>
  )
}
