import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Switch } from '@/components/ui/switch'
import { GripVertical, Loader2 } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { toast } from 'sonner'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props {
  hook: UseStorefrontSettingsReturn
}

interface MenuCategory {
  id: string
  name: string
  slug: string
  showInMenu: boolean
  menuSortOrder: number
  children?: MenuCategory[]
}

export function MenuCategoriesSection({ hook }: Props) {
  const sectionId = 'menu-categories'
  const queryClient = useQueryClient()

  const { data: categories, isLoading } = useQuery({
    queryKey: ['categories', 'all-for-menu'],
    queryFn: () =>
      apiClient.get<MenuCategory[]>('/categories').then((r) => {
        const data = r.data?.data || r.data || []
        return Array.isArray(data) ? data : []
      }),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<MenuCategory> }) =>
      apiClient.put(`/categories/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      toast.success('Category updated')
    },
    onError: () => toast.error('Failed to update category'),
  })

  const active = (categories || []).filter((c) => c.showInMenu)
  const hidden = (categories || []).filter((c) => !c.showInMenu)

  return (
    <SectionShell
      id={sectionId}
      title='Menu Categories'
      description='Toggle which product categories appear in the storefront navigation header. Drag to reorder.'
      isDirty={false}
      isSaving={hook.isSaving}
      dirtyCount={0}
      lastSavedAt={null}
      onSave={() => {}}
      onReset={() => {}}
    >
      {isLoading ? (
        <div className='flex justify-center py-8'>
          <Loader2 className='animate-spin h-6 w-6 text-muted-foreground' />
        </div>
      ) : (
        <div className='space-y-3'>
          <p className='text-sm text-muted-foreground'>
            {active.length} category active · {hidden.length} hidden
          </p>
          {active.length > 0 && (
            <>
              <div className='text-sm font-medium text-muted-foreground'>
                Shown in menu
              </div>
              {active.map((cat) => (
                <CategoryRow
                  key={cat.id}
                  category={cat}
                  depth={0}
                  onToggle={(id, showInMenu) =>
                    updateMut.mutate({ id, data: { showInMenu } })
                  }
                />
              ))}
            </>
          )}
          {hidden.length > 0 && (
            <>
              <div className='text-sm font-medium text-muted-foreground mt-6'>
                Hidden from menu
              </div>
              {hidden.map((cat) => (
                <CategoryRow
                  key={cat.id}
                  category={cat}
                  depth={0}
                  onToggle={(id, showInMenu) =>
                    updateMut.mutate({ id, data: { showInMenu } })
                  }
                />
              ))}
            </>
          )}
        </div>
      )}
    </SectionShell>
  )
}

function CategoryRow({
  category,
  depth,
  onToggle,
}: {
  category: MenuCategory
  depth: number
  onToggle: (id: string, showInMenu: boolean) => void
}) {
  const [checked, setChecked] = useState(category.showInMenu)

  return (
    <div>
      <div
        className='flex items-center gap-2 p-2.5 border rounded-lg bg-muted/20'
        style={{ marginLeft: depth * 20 }}
      >
        <GripVertical className='h-4 w-4 text-muted-foreground shrink-0 cursor-grab' />
        <div className='flex-1 text-sm font-medium'>{category.name}</div>
        <Switch
          checked={checked}
          onCheckedChange={(val) => {
            setChecked(val)
            onToggle(category.id, val)
          }}
        />
      </div>
      {category.children?.map((child) => (
        <CategoryRow key={child.id} category={child} depth={depth + 1} onToggle={onToggle} />
      ))}
    </div>
  )
}
