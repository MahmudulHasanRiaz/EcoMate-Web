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

  const [orderedCats, setOrderedCats] = useState<MenuCategory[]>([])
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  useEffect(() => {
    if (categories) {
      const shown = categories.filter(c => c.showInMenu)
      setOrderedCats([...shown].sort((a, b) => a.menuSortOrder - b.menuSortOrder))
    }
  }, [categories])

  const handleDragStart = (idx: number) => { setDragIdx(idx) }

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    if (dragIdx === null || dragIdx === idx) return
    const next = [...orderedCats]
    const [moved] = next.splice(dragIdx, 1)
    next.splice(idx, 0, moved)
    setOrderedCats(next)
    setDragIdx(idx)
  }

  const handleDragEnd = async () => {
    setDragIdx(null)
    for (let i = 0; i < orderedCats.length; i++) {
      if (orderedCats[i].menuSortOrder !== i) {
        try {
          await apiClient.put(`/categories/${orderedCats[i].id}`, { menuSortOrder: i })
        } catch {
          toast.error('Failed to save category order')
          break
        }
      }
    }
    toast.success('Menu order saved')
    queryClient.invalidateQueries({ queryKey: ['categories'] })
  }

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
            {orderedCats.length} category active · {hidden.length} hidden
          </p>
          {orderedCats.length > 0 && (
            <>
              <div className='text-sm font-medium text-muted-foreground'>
                Shown in menu
              </div>
              {orderedCats.map((cat, idx) => (
                <CategoryRow
                  key={cat.id}
                  category={cat}
                  depth={0}
                  onToggle={(id, showInMenu) =>
                    updateMut.mutate({ id, data: { showInMenu } })
                  }
                  draggable
                  onDragStart={() => handleDragStart(idx)}
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDragEnd={handleDragEnd}
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
  draggable,
  onDragStart,
  onDragOver,
  onDragEnd,
}: {
  category: MenuCategory
  depth: number
  onToggle: (id: string, showInMenu: boolean) => void
  draggable?: boolean
  onDragStart?: () => void
  onDragOver?: (e: React.DragEvent) => void
  onDragEnd?: () => void
}) {
  const [checked, setChecked] = useState(category.showInMenu)

  return (
    <div>
      <div
        draggable={draggable}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        className='flex items-center gap-2 p-2.5 border rounded-lg bg-muted/20 cursor-grab active:cursor-grabbing'
        style={{ marginLeft: depth * 20 }}
      >
        <GripVertical className='h-4 w-4 text-muted-foreground shrink-0' />
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
