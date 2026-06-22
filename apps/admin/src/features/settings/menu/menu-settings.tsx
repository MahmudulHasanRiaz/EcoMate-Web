import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { systemSettingsApi } from '../storage-api'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  Loader2, Save, Plus, Trash2, GripVertical, Link, FolderTree,
  ChevronRight, ChevronDown, Edit2, X, Check, Smartphone, Layout, Columns3, List, CornerUpLeft
} from 'lucide-react'

interface MenuItem {
  id: string
  type: 'custom' | 'category'
  label: string
  url?: string
  categoryId?: string
  children: MenuItem[]
}

interface MenuSection {
  mode: 'include' | 'exclude'
  showAllCategories: boolean
  excludedCategories: string[]
  items: MenuItem[]
}

interface FooterColumn {
  id: string
  title: string
  items: MenuItem[]
}

interface MenuConfig {
  header: MenuSection
  mobile: MenuSection
  footer: { columns: FooterColumn[] }
}

interface Category {
  id: string
  name: string
  slug: string
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function emptySection(): MenuSection {
  return { mode: 'include', showAllCategories: false, excludedCategories: [], items: [] }
}

function defaultConfig(): MenuConfig {
  return { header: emptySection(), mobile: emptySection(), footer: { columns: [] } }
}

function catItem(cat: Category): MenuItem {
  return { id: genId(), type: 'category', label: cat.name, categoryId: cat.id, children: [] }
}

function customItem(label?: string, url?: string): MenuItem {
  return { id: genId(), type: 'custom', label: label || 'New Link', url: url || '/', children: [] }
}

function columnItem(): FooterColumn {
  return { id: genId(), title: '', items: [] }
}

function flattenCats(list: any[]): Category[] {
  const out: Category[] = []
  function walk(arr: any[]) {
    for (const c of arr) {
      out.push({ id: c.id, name: c.name, slug: c.slug })
      if (c.children?.length) walk(c.children)
    }
  }
  walk(list)
  return out
}

export function MenuSettings() {
  const queryClient = useQueryClient()
  const [config, setConfig] = useState<MenuConfig>(defaultConfig)
  const [activeTab, setActiveTab] = useState('header')
  const [isDirty, setIsDirty] = useState(false)
  const [ready, setReady] = useState(false)

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then(r => r.data),
  })

  const { data: categoriesData } = useQuery({
    queryKey: ['categories'],
    queryFn: () =>
      apiClient.get<any>('/categories').then(r => {
        const d = r.data?.data || r.data || []
        return Array.isArray(d) ? flattenCats(d) : []
      }),
    staleTime: 60000,
  })

  const categories: Category[] = categoriesData || []

  useEffect(() => {
    if (settings && !ready) {
      try {
        const saved = JSON.parse(settings.menu_config || '{}')
        setConfig({
          header: { ...emptySection(), ...saved.header },
          mobile: { ...emptySection(), ...saved.mobile },
          footer: saved.footer || { columns: [] },
        })
      } catch {
        setConfig(defaultConfig())
      }
      setReady(true)
    }
  }, [settings, ready])

  useEffect(() => {
    if (!ready || categories.length === 0) return
    setConfig(prev => {
      const next = { ...prev }
      for (const key of ['header', 'mobile'] as const) {
        const s = next[key]
        const existing = new Set(s.items.filter(i => i.type === 'category' && i.categoryId).map(i => i.categoryId))
        if (s.mode === 'include' && s.showAllCategories) {
          const missing = categories.filter(c => !existing.has(c.id))
          if (missing.length > 0) {
            next[key] = { ...s, items: [...s.items, ...missing.map(catItem)] }
          }
        } else if (s.mode === 'exclude') {
          const missing = categories
            .filter(c => !s.excludedCategories.includes(c.id))
            .filter(c => !existing.has(c.id))
          if (missing.length > 0) {
            next[key] = { ...s, items: [...s.items, ...missing.map(catItem)] }
          }
        }
      }
      return next
    })
  }, [ready, categories])

  const saveMut = useMutation({
    mutationFn: (cfg: MenuConfig) => systemSettingsApi.set('menu_config', JSON.stringify(cfg)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
      setIsDirty(false)
      toast.success('Menu configuration saved')
    },
    onError: () => toast.error('Failed to save menu configuration'),
  })

  const handleSave = () => saveMut.mutate(config)

  const updateSection = useCallback((key: 'header' | 'mobile', s: MenuSection) => {
    setConfig(p => ({ ...p, [key]: s }))
    setIsDirty(true)
  }, [])

  const updateFooter = useCallback((columns: FooterColumn[]) => {
    setConfig(p => ({ ...p, footer: { columns } }))
    setIsDirty(true)
  }, [])

  if (settingsLoading || !ready) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="animate-spin h-8 w-8 text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6 w-full pb-8">
      <div className="space-y-0.5">
        <h2 className="text-2xl font-bold tracking-tight">Menu Configuration</h2>
        <p className="text-muted-foreground">
          Configure header navigation, mobile menu, and footer columns.
        </p>
      </div>
      <Separator />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="header"><Layout className="h-4 w-4 mr-2" />Header Menu</TabsTrigger>
          <TabsTrigger value="mobile"><Smartphone className="h-4 w-4 mr-2" />Mobile Menu</TabsTrigger>
          <TabsTrigger value="footer"><Columns3 className="h-4 w-4 mr-2" />Footer Menu</TabsTrigger>
          <TabsTrigger value="categories"><List className="h-4 w-4 mr-2" />Menu Categories</TabsTrigger>
        </TabsList>
        <TabsContent value="header" className="space-y-4 pt-4">
          <MenuSectionBuilder section={config.header} onChange={s => updateSection('header', s)} categories={categories} />
        </TabsContent>
        <TabsContent value="mobile" className="space-y-4 pt-4">
          <MenuSectionBuilder section={config.mobile} onChange={s => updateSection('mobile', s)} categories={categories} />
        </TabsContent>
        <TabsContent value="footer" className="space-y-4 pt-4">
          <FooterMenuBuilder columns={config.footer.columns} onChange={updateFooter} categories={categories} />
        </TabsContent>
        <TabsContent value="categories" className="space-y-4 pt-4">
          <MenuCategoriesPanel />
        </TabsContent>
      </Tabs>

      <div className="flex items-center justify-between p-4 bg-muted/40 rounded-xl border border-dashed border-muted-foreground/20">
        <div className="text-sm text-muted-foreground">
          Changes affect the storefront immediately after saving.
        </div>
        <Button onClick={handleSave} size="lg" className="px-8" disabled={saveMut.isPending}>
          {saveMut.isPending ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save Changes
        </Button>
      </div>
    </div>
  )
}

function MenuSectionBuilder({ section, onChange, categories }: {
  section: MenuSection
  onChange: (s: MenuSection) => void
  categories: Category[]
}) {
  const catInItems = new Set<string>(
    section.items
      .filter(i => i.type === 'category' && i.categoryId)
      .map(i => i.categoryId!)
  )

  const toggleCat = (catId: string) => {
    const cat = categories.find(c => c.id === catId)
    if (!cat) return
    if (catInItems.has(catId)) {
      onChange({ ...section, items: section.items.filter(i => i.categoryId !== catId) })
    } else {
      onChange({ ...section, items: [...section.items, catItem(cat)] })
    }
  }

  const toggleExclude = (catId: string) => {
    const isExcluded = section.excludedCategories.includes(catId)
    const nextExcluded = isExcluded
      ? section.excludedCategories.filter(id => id !== catId)
      : [...section.excludedCategories, catId]
    const cat = categories.find(c => c.id === catId)
    if (!cat) return
    let nextItems = section.items.filter(i => i.categoryId !== catId)
    if (isExcluded) {
      nextItems = [...nextItems, catItem(cat)]
    }
    onChange({ ...section, excludedCategories: nextExcluded, items: nextItems })
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Menu Items</CardTitle>
            <CardDescription>Configure which items appear in this menu and their order.</CardDescription>
          </div>
          <ModeToggle mode={section.mode} onChange={m => onChange({ ...section, mode: m })} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {section.mode === 'include' && (
          <div className="flex items-center gap-2">
            <Switch checked={section.showAllCategories} onCheckedChange={v => onChange({ ...section, showAllCategories: v })} id="show-all" />
            <Label htmlFor="show-all">Show all categories</Label>
          </div>
        )}

        <CategoryPicker
          mode={section.mode}
          categories={categories}
          selectedIds={catInItems}
          excludedIds={new Set(section.excludedCategories)}
          showAllCategories={section.showAllCategories}
          onToggle={toggleCat}
          onToggleExclude={toggleExclude}
        />

        <Separator />

        <div>
          <Label className="text-sm font-medium mb-2 block">Ordered items ({section.items.length})</Label>
          <p className="text-xs text-muted-foreground mb-2">Drag items to reorder. Drag to the <span className="text-primary font-medium">right edge</span> of an item to make it a sub-menu (child).</p>
          {section.items.length === 0 ? (
            <p className="text-sm text-muted-foreground italic py-4 text-center border rounded-lg bg-muted/20">
              No menu items yet. Select categories above or add custom links.
            </p>
          ) : (
            <MenuItemList 
              items={section.items} 
              onChange={items => onChange({ ...section, items })} 
              categories={categories} 
              onExtractToRoot={(item) => onChange({ ...section, items: [...section.items, item] })}
            />
          )}
          <Button variant="outline" size="sm" className="mt-2" onClick={() => onChange({ ...section, items: [...section.items, customItem()] })}>
            <Plus className="h-4 w-4 mr-1" /> Add Custom Link
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ModeToggle({ mode, onChange }: { mode: 'include' | 'exclude'; onChange: (m: 'include' | 'exclude') => void }) {
  return (
    <div className="flex items-center gap-1.5 bg-muted rounded-lg p-0.5">
      <button
        type="button"
        onClick={() => onChange('include')}
        className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${mode === 'include' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
      >
        Include
      </button>
      <button
        type="button"
        onClick={() => onChange('exclude')}
        className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${mode === 'exclude' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
      >
        Exclude
      </button>
    </div>
  )
}

function CategoryPicker({ mode, categories, selectedIds, excludedIds, showAllCategories, onToggle, onToggleExclude }: {
  mode: 'include' | 'exclude'
  categories: Category[]
  selectedIds: Set<string>
  excludedIds: Set<string>
  showAllCategories: boolean
  onToggle: (id: string) => void
  onToggleExclude: (id: string) => void
}) {
  if (categories.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No categories found.</p>
  }
  if (mode === 'include' && showAllCategories) {
    return <p className="text-sm text-muted-foreground">All categories are shown. Use the list below to reorder or nest them, or add custom links.</p>
  }

  const hint = mode === 'include'
    ? 'Select categories to include in the menu:'
    : 'Select categories to exclude from the menu:'

  return (
    <div>
      <Label className="text-sm font-medium mb-2 block">{hint}</Label>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-1">
        {categories.map(cat => {
          if (mode === 'exclude') {
            const excluded = excludedIds.has(cat.id)
            return (
              <label
                key={cat.id}
                className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer text-sm transition-colors ${
                  excluded ? 'bg-destructive/10 border-destructive/30' : 'bg-muted/30'
                }`}
              >
                <input type="checkbox" checked={excluded} onChange={() => onToggleExclude(cat.id)} className="rounded" />
                <span className={excluded ? 'line-through text-muted-foreground' : ''}>{cat.name}</span>
              </label>
            )
          }
          const selected = selectedIds.has(cat.id)
          return (
            <label
              key={cat.id}
              className={`flex items-center gap-2 p-2 rounded-md border cursor-pointer text-sm transition-colors ${
                selected ? 'bg-primary/10 border-primary/30' : 'bg-muted/30'
              }`}
            >
              <input type="checkbox" checked={selected} onChange={() => onToggle(cat.id)} className="rounded" />
              <span>{cat.name}</span>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function MenuItemList({ items, onChange, categories, depth = 0, onExtractToRoot }: {
  items: MenuItem[]
  onChange: (items: MenuItem[]) => void
  categories: Category[]
  depth?: number
  onExtractToRoot?: (item: MenuItem) => void
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [nestTarget, setNestTarget] = useState<number | null>(null)

  const handleDragStart = (idx: number) => {
    setDragIdx(idx)
    setDragId(items[idx]?.id || null)
  }

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    if (dragIdx === null) return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const isNest = x / rect.width > 0.6

    if (isNest && idx !== dragIdx) {
      setNestTarget(idx)
      return
    }
    setNestTarget(null)

    if (dragIdx === idx) return
    const next = [...items]
    const [moved] = next.splice(dragIdx, 1)
    next.splice(idx, 0, moved)
    onChange(next)
    setDragIdx(idx)
  }

  const handleDrop = (e: React.DragEvent, targetIdx: number) => {
    e.preventDefault()
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const isNest = x / rect.width > 0.6

    if (isNest && dragId && targetIdx !== dragIdx) {
      const next = [...items]
      const srcIdx = next.findIndex(i => i.id === dragId)
      if (srcIdx > -1) {
        const [moved] = next.splice(srcIdx, 1)
        const adjustedTarget = srcIdx < targetIdx ? targetIdx - 1 : targetIdx
        if (adjustedTarget >= 0 && adjustedTarget < next.length) {
          next[adjustedTarget] = {
            ...next[adjustedTarget],
            children: [...(next[adjustedTarget].children || []), moved],
          }
          onChange(next)
        }
      }
    }
    setDragIdx(null)
    setDragId(null)
    setNestTarget(null)
  }

  const handleDragEnd = () => {
    setDragIdx(null)
    setDragId(null)
    setNestTarget(null)
  }

  const update = (idx: number, item: MenuItem) => {
    const next = [...items]
    next[idx] = item
    onChange(next)
  }

  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx))

  const updateChildren = (idx: number, children: MenuItem[]) => {
    const next = [...items]
    next[idx] = { ...next[idx], children }
    onChange(next)
  }

  return (
    <div className="space-y-1">
      {items.map((item, idx) => (
        <MenuItemRow
          key={item.id}
          item={item}
          onUpdate={v => update(idx, v)}
          onDelete={() => remove(idx)}
          onChildrenChange={c => updateChildren(idx, c)}
          onExtractToRoot={onExtractToRoot ? () => {
             remove(idx);
             onExtractToRoot(item);
          } : undefined}
          categories={categories}
          depth={depth}
          isDragging={dragIdx === idx}
          isNestTarget={nestTarget === idx}
          dragHandlers={{
            onDragStart: () => handleDragStart(idx),
            onDragOver: (e) => handleDragOver(e, idx),
            onDragEnd: handleDragEnd,
          }}
          onDrop={(e) => handleDrop(e, idx)}
        />
      ))}
    </div>
  )
}

function MenuItemRow({ item, onUpdate, onDelete, onChildrenChange, onExtractToRoot, categories, depth, isDragging, isNestTarget, dragHandlers, onDrop }: {
  item: MenuItem
  onUpdate: (item: MenuItem) => void
  onDelete: () => void
  onChildrenChange: (children: MenuItem[]) => void
  onExtractToRoot?: () => void
  categories: Category[]
  depth: number
  isDragging: boolean
  isNestTarget: boolean
  dragHandlers: {
    onDragStart: () => void
    onDragOver: (e: React.DragEvent) => void
    onDragEnd: () => void
  }
  onDrop: (e: React.DragEvent) => void
}) {
  const [editing, setEditing] = useState(false)
  const [expanded, setExpanded] = useState(true)
  const [editLabel, setEditLabel] = useState(item.label)
  const [editUrl, setEditUrl] = useState(item.url || '')
  const [editCategoryId, setEditCategoryId] = useState(item.categoryId || '')

  useEffect(() => {
    setEditLabel(item.label)
    setEditUrl(item.url || '')
    setEditCategoryId(item.categoryId || '')
  }, [item])

  const cat = item.categoryId ? categories.find(c => c.id === item.categoryId) : null

  const commitEdit = () => {
    if (item.type === 'custom') {
      onUpdate({ ...item, label: editLabel || 'Link', url: editUrl })
    } else {
      const found = categories.find(c => c.id === editCategoryId)
      onUpdate({ ...item, label: found?.name || editLabel, categoryId: editCategoryId })
    }
    setEditing(false)
  }

  return (
    <div style={{ marginLeft: depth * 16 }} className={depth > 0 ? 'border-l-2 border-muted pl-2' : ''}>
      <div
        draggable
        onDragStart={dragHandlers.onDragStart}
        onDragOver={dragHandlers.onDragOver}
        onDragEnd={dragHandlers.onDragEnd}
        onDrop={onDrop}
        className={`flex items-center gap-2 p-2.5 border rounded-lg bg-card transition-all ${
          isDragging ? 'opacity-50 shadow-md' : ''
        } ${isNestTarget ? 'ring-2 ring-primary/50 bg-primary/5' : ''}`}
      >
        <GripVertical className="h-4 w-4 text-muted-foreground shrink-0 cursor-grab" />

        {item.children.length > 0 ? (
          <button type="button" onClick={() => setExpanded(!expanded)} className="p-0.5 hover:bg-muted rounded shrink-0">
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <div className="w-4 shrink-0" />
        )}

        {item.type === 'custom' ? (
          <Link className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <FolderTree className="h-4 w-4 text-primary/60 shrink-0" />
        )}

        {editing ? (
          <div className="flex-1 flex items-center gap-2 flex-wrap min-w-0">
            {item.type === 'custom' ? (
              <>
                <Input value={editLabel} onChange={e => setEditLabel(e.target.value)} placeholder="Label" className="h-8 text-sm w-32" autoFocus />
                <Input value={editUrl} onChange={e => setEditUrl(e.target.value)} placeholder="/path" className="h-8 text-sm w-36" />
              </>
            ) : (
              <Select value={editCategoryId} onValueChange={setEditCategoryId}>
                <SelectTrigger className="h-8 text-sm w-44">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={commitEdit}><Check className="h-4 w-4 text-green-600" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setEditing(false)}><X className="h-4 w-4 text-destructive" /></Button>
          </div>
        ) : (
          <>
            <span className="flex-1 text-sm font-medium truncate min-w-0">
              {item.type === 'category' && cat ? cat.name : item.label}
            </span>
            {item.type === 'custom' && item.url && (
              <span className="text-xs text-muted-foreground hidden sm:inline truncate max-w-[120px]">{item.url}</span>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => setEditing(true)}><Edit2 className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => onChildrenChange([...item.children, customItem()])}><Plus className="h-3.5 w-3.5" /></Button>
            {depth > 0 && onExtractToRoot && (
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-amber-600" title="Extract to Main Menu" onClick={onExtractToRoot}><CornerUpLeft className="h-3.5 w-3.5" /></Button>
            )}
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
          </>
        )}
      </div>

      {expanded && item.children.length > 0 && (
        <MenuItemList 
           items={item.children} 
           onChange={onChildrenChange} 
           categories={categories} 
           depth={depth + 1} 
           onExtractToRoot={onExtractToRoot}
        />
      )}
    </div>
  )
}

function FooterMenuBuilder({ columns, onChange, categories }: {
  columns: FooterColumn[]
  onChange: (cols: FooterColumn[]) => void
  categories: Category[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Footer Columns</CardTitle>
        <CardDescription>Configure the column structure and links in the storefront footer.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {columns.length === 0 ? (
          <p className="text-sm text-muted-foreground italic py-4 text-center border rounded-lg bg-muted/20">
            No columns yet. Add your first footer column.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {columns.map((col, idx) => (
              <FooterColumnCard
                key={col.id}
                column={col}
                onChange={c => { const next = [...columns]; next[idx] = c; onChange(next) }}
                onDelete={() => onChange(columns.filter((_, i) => i !== idx))}
                categories={categories}
              />
            ))}
          </div>
        )}
        <Button variant="outline" onClick={() => onChange([...columns, columnItem()])}>
          <Plus className="h-4 w-4 mr-1" /> Add Column
        </Button>
      </CardContent>
    </Card>
  )
}

function FooterColumnCard({ column, onChange, onDelete, categories }: {
  column: FooterColumn
  onChange: (col: FooterColumn) => void
  onDelete: () => void
  categories: Category[]
}) {
  return (
    <Card className="border-dashed">
      <CardHeader className="p-3 pb-0 space-y-0">
        <div className="flex items-center gap-2">
          <Input
            value={column.title}
            onChange={e => onChange({ ...column, title: e.target.value })}
            placeholder="Column title"
            className="h-8 text-sm font-medium flex-1"
          />
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        {!column.title && <p className="text-xs text-muted-foreground mt-1">Unnamed column</p>}
      </CardHeader>
      <CardContent className="p-3 space-y-2">
        {column.items.length > 0 ? (
          <MenuItemList items={column.items} onChange={items => onChange({ ...column, items })} categories={categories} />
        ) : (
          <p className="text-xs text-muted-foreground italic text-center py-2">No links yet</p>
        )}
        <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => onChange({ ...column, items: [...column.items, customItem()] })}>
          <Plus className="h-3 w-3 mr-1" /> Add Link
        </Button>
      </CardContent>
    </Card>
  )
}

interface MenuCategory {
  id: string
  name: string
  slug: string
  showInMenu: boolean
  menuSortOrder: number
  children?: MenuCategory[]
}

function MenuCategoriesPanel() {
  const queryClient = useQueryClient()

  const { data: categories, isLoading } = useQuery({
    queryKey: ['categories', 'all-for-menu'],
    queryFn: () =>
      apiClient.get<MenuCategory[]>('/categories').then((r) => {
        const data = (r.data as any)?.data || r.data || []
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
    <Card>
      <CardHeader>
        <CardTitle>Menu Categories</CardTitle>
        <CardDescription>
          Toggle which product categories appear in the storefront navigation header. Drag to reorder.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
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

  useEffect(() => {
    setChecked(category.showInMenu)
  }, [category.showInMenu])

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
