import { useQuery } from '@tanstack/react-query'
import { apiClient } from '@/lib/api-client'
import { Label } from '@/components/ui/label'
import { SelectDropdown } from '@/components/select-dropdown'

export interface SteadfastSetMeta {
  id: string
  label: string
  isDefault: boolean
  hasApiKey: boolean
  hasSecret: boolean
  hasWebhook: boolean
}

export function useSteadfastSets() {
  return useQuery({
    queryKey: ['steadfast-credential-sets'],
    queryFn: async (): Promise<SteadfastSetMeta[]> => {
      const res = await apiClient.get('/couriers/credential-sets')
      const body = (res as any)?.data
      return (Array.isArray(body) ? body : body?.data ?? []) as SteadfastSetMeta[]
    },
  })
}

// Task 8: order-level account picker. Renders NOTHING unless >1 set is
// configured (zero friction for single-business). Labels only — the list
// endpoint never sends keys, so they cannot leak into the DOM.
export function SteadfastSetPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (id: string) => void
}) {
  const { data: sets = [], isLoading } = useSteadfastSets()

  if (isLoading || sets.length <= 1) return null

  return (
    <div className='space-y-1'>
      <Label>Steadfast Account</Label>
      <SelectDropdown
        defaultValue={value}
        onValueChange={onChange}
        placeholder='Default account'
        items={sets.map((s) => ({
          label: `${s.label}${s.isDefault ? ' (default)' : ''}`,
          value: s.id,
        }))}
      />
      <p className='text-[11px] text-muted-foreground'>
        Leave on default unless this order belongs to another merchant account.
      </p>
    </div>
  )
}
