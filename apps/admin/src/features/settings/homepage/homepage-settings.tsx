import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { systemSettingsApi } from '../storage-api'
import { apiClient } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Loader2, Save, Plus, Trash2, ArrowUp, ArrowDown, LayoutGrid } from 'lucide-react'

interface HomepageSection {
  id: string
  title: string
  type: 'featured' | 'new_arrivals' | 'popular' | 'category'
  categoryId?: string
  categorySort?: 'default' | 'new_arrivals' | 'popular'
  limit: number
  enabled: boolean
}

interface Category {
  id: string
  name: string
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

export function HomepageSettings() {
  const queryClient = useQueryClient()
  const [sections, setSections] = useState<HomepageSection[]>([])
  const [isDirty, setIsDirty] = useState(false)
  const [ready, setReady] = useState(false)

  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then(r => r.data),
  })

  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () =>
      apiClient.get<any>('/categories').then(r => {
        const d = r.data?.data || r.data || []
        return Array.isArray(d) ? d.map((c: any) => ({ id: c.id, name: c.name })) : []
      }),
    staleTime: 60000,
  })

  useEffect(() => {
    if (settings && !ready) {
      try {
        const saved = JSON.parse(settings.homepage_sections || '[]')
        if (Array.isArray(saved) && saved.length > 0) {
          setSections(saved)
        } else {
          setSections([
            { id: '1', title: 'Featured Gadgets', type: 'featured', limit: 4, enabled: true },
            { id: '2', title: 'New Arrivals', type: 'new_arrivals', limit: 4, enabled: true },
            { id: '3', title: 'Popular Items', type: 'popular', limit: 4, enabled: true },
          ])
        }
      } catch {
        setSections([
          { id: '1', title: 'Featured Gadgets', type: 'featured', limit: 4, enabled: true },
          { id: '2', title: 'New Arrivals', type: 'new_arrivals', limit: 4, enabled: true },
          { id: '3', title: 'Popular Items', type: 'popular', limit: 4, enabled: true },
        ])
      }
      setReady(true)
    }
  }, [settings, ready])

  const saveMut = useMutation({
    mutationFn: (data: HomepageSection[]) => systemSettingsApi.set('homepage_sections', JSON.stringify(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
      setIsDirty(false)
      toast.success('Homepage configuration saved')
    },
    onError: () => toast.error('Failed to save homepage configuration'),
  })

  const handleSave = () => saveMut.mutate(sections)

  const addSection = () => {
    setSections(prev => [
      ...prev,
      { id: genId(), title: 'New Product Section', type: 'featured', limit: 4, enabled: true },
    ])
    setIsDirty(true)
  }

  const deleteSection = (id: string) => {
    setSections(prev => prev.filter(s => s.id !== id))
    setIsDirty(true)
  }

  const updateSection = (id: string, updates: Partial<HomepageSection>) => {
    setSections(prev => prev.map(s => (s.id === id ? { ...s, ...updates } : s)))
    setIsDirty(true)
  }

  const moveUp = (idx: number) => {
    if (idx === 0) return
    setSections(prev => {
      const next = [...prev]
      const [moved] = next.splice(idx, 1)
      next.splice(idx - 1, 0, moved)
      return next
    })
    setIsDirty(true)
  }

  const moveDown = (idx: number) => {
    if (idx === sections.length - 1) return
    setSections(prev => {
      const next = [...prev]
      const [moved] = next.splice(idx, 1)
      next.splice(idx + 1, 0, moved)
      return next
    })
    setIsDirty(true)
  }

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
        <h2 className="text-2xl font-bold tracking-tight">Homepage Product Sections</h2>
        <p className="text-muted-foreground">
          Customize, filter, and order product grids shown on the storefront home page.
        </p>
      </div>
      <Separator />

      <div className="space-y-4">
        {sections.map((section, idx) => (
          <Card key={section.id} className={!section.enabled ? 'opacity-60 transition-opacity' : ''}>
            <CardHeader className="py-4 px-6 flex flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-3">
                <LayoutGrid className="h-5 w-5 text-muted-foreground" />
                <div>
                  <CardTitle className="text-base">{section.title || 'Untitled Section'}</CardTitle>
                  <CardDescription className="text-xs uppercase tracking-wider font-semibold text-primary mt-0.5">{section.type.replace('_', ' ')}</CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveUp(idx)} disabled={idx === 0}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveDown(idx)} disabled={idx === sections.length - 1}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" onClick={() => deleteSection(section.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-6 pb-6 pt-0 grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 items-end">
              <div className="space-y-2">
                <Label htmlFor={`title-${section.id}`}>Section Title</Label>
                <Input
                  id={`title-${section.id}`}
                  value={section.title}
                  onChange={e => updateSection(section.id, { title: e.target.value })}
                  placeholder="e.g. New Arrivals"
                />
              </div>

              <div className="space-y-2">
                <Label>Product Type</Label>
                <Select value={section.type} onValueChange={(val: any) => updateSection(section.id, { type: val })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="featured">Featured Products</SelectItem>
                    <SelectItem value="new_arrivals">New Arrivals</SelectItem>
                    <SelectItem value="popular">Popular Items</SelectItem>
                    <SelectItem value="category">Category-specific</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {section.type === 'category' ? (
                <>
                  <div className="space-y-2">
                    <Label>Category</Label>
                    <Select
                      value={section.categoryId || ''}
                      onValueChange={val => updateSection(section.id, { categoryId: val })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select Category" />
                      </SelectTrigger>
                      <SelectContent>
                        {(categories || []).map(cat => (
                          <SelectItem key={cat.id} value={cat.id}>
                            {cat.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Filter / Sort</Label>
                    <Select
                      value={section.categorySort || 'default'}
                      onValueChange={val => updateSection(section.id, { categorySort: val as any })}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="default">Default</SelectItem>
                        <SelectItem value="new_arrivals">New Arrivals</SelectItem>
                        <SelectItem value="popular">Popular Items</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2 opacity-40 select-none pointer-events-none">
                    <Label>Category</Label>
                    <Select disabled value="">
                      <SelectTrigger>
                        <SelectValue placeholder="N/A" />
                      </SelectTrigger>
                      <SelectContent />
                    </Select>
                  </div>

                  <div className="space-y-2 opacity-40 select-none pointer-events-none">
                    <Label>Filter / Sort</Label>
                    <Select disabled value="default">
                      <SelectTrigger>
                        <SelectValue placeholder="N/A" />
                      </SelectTrigger>
                      <SelectContent />
                    </Select>
                  </div>
                </>
              )}

              <div className="flex items-center justify-between gap-4">
                <div className="space-y-2 flex-1">
                  <Label htmlFor={`limit-${section.id}`}>Product Limit</Label>
                  <Input
                    id={`limit-${section.id}`}
                    type="number"
                    value={section.limit}
                    onChange={e => updateSection(section.id, { limit: parseInt(e.target.value) || 4 })}
                    min="1"
                    max="20"
                  />
                </div>
                <div className="flex flex-col items-center gap-1">
                  <Label className="text-[10px] uppercase text-muted-foreground font-bold">Enabled</Label>
                  <Switch
                    checked={section.enabled}
                    onCheckedChange={val => updateSection(section.id, { enabled: val })}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {sections.length === 0 && (
          <div className="text-center py-12 border border-dashed rounded-2xl bg-muted/10">
            <p className="text-muted-foreground text-sm">No homepage product sections configured.</p>
            <Button variant="outline" size="sm" className="mt-4" onClick={addSection}>
              <Plus className="h-4 w-4 mr-2" /> Add Your First Section
            </Button>
          </div>
        )}

        {sections.length > 0 && (
          <Button variant="outline" className="w-full py-6 border-dashed" onClick={addSection}>
            <Plus className="h-4 w-4 mr-2" /> Add Homepage Product Section
          </Button>
        )}
      </div>

      <div className="flex items-center justify-between p-4 bg-muted/40 rounded-xl border border-dashed border-muted-foreground/20">
        <div className="text-sm text-muted-foreground">
          {isDirty ? 'You have unsaved changes.' : 'All changes are saved.'}
        </div>
        <Button onClick={handleSave} size="lg" className="px-8" disabled={saveMut.isPending || !isDirty}>
          {saveMut.isPending ? <Loader2 className="animate-spin h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />}
          Save Changes
        </Button>
      </div>
    </div>
  )
}
