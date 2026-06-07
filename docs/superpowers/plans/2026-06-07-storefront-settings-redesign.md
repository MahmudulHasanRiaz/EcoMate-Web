# Storefront Settings Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `/mon/settings/storefront` from a 14-tab monolithic form into a two-pane layout with 5 categories, per-section autosave, and Cmd/Ctrl+K command palette.

**Architecture:** Two-pane layout (persistent sidebar + scrollable content) within the existing `/mon/settings/storefront` route. No backend changes. New `useStorefrontSettings` hook manages state with per-section dirty tracking. 12 section components each wrapped in a shared `SectionShell`. All 40 system-setting keys preserved.

**Tech Stack:** React 19, TanStack Router, TanStack Query, shadcn/ui components, cmdk for command palette, Vitest + browser (playwright/chromium) for tests.

---

### Task 1: Create directory structure + lib registry files

**Files:**
- Create: `apps/admin/src/features/settings/storefront/`
- Create: `apps/admin/src/features/settings/storefront/index.ts`
- Create: `apps/admin/src/features/settings/storefront/lib/categories.ts`
- Create: `apps/admin/src/features/settings/storefront/lib/field-schemas.ts`

- [ ] **Step 1: Create directory structure**

Run:
```bash
mkdir -p apps/admin/src/features/settings/storefront/lib \
  apps/admin/src/features/settings/storefront/hooks \
  apps/admin/src/features/settings/storefront/components/sections
```

- [ ] **Step 2: Create `lib/categories.ts`** — single source of truth for all sections and categories

```typescript
import {
  Store, Palette, ImageIcon, Layout, List, HelpCircle, Clock, Info,
  Search, Share2, ShoppingCart, Phone,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type SectionId =
  | 'identity-store'
  | 'identity-brands'
  | 'visuals-hero'
  | 'visuals-footer'
  | 'content-navigation'
  | 'content-faq'
  | 'content-hours'
  | 'content-about'
  | 'discovery-seo'
  | 'discovery-social'
  | 'commerce-checkout'
  | 'commerce-order'

export interface SectionMeta {
  id: SectionId
  categoryId: CategoryId
  title: string
  description: string
  icon: LucideIcon
  fields: string[]
}

export type CategoryId =
  | 'identity'
  | 'visuals'
  | 'content'
  | 'discovery'
  | 'commerce'

export interface CategoryMeta {
  id: CategoryId
  label: string
  description: string
  sections: SectionId[]
}

export const CATEGORIES: CategoryMeta[] = [
  {
    id: 'identity',
    label: 'Identity',
    description: 'Brand basics: name, contact, currency',
    sections: ['identity-store', 'identity-brands'],
  },
  {
    id: 'visuals',
    label: 'Visuals',
    description: 'Hero banner, footer appearance',
    sections: ['visuals-hero', 'visuals-footer'],
  },
  {
    id: 'content',
    label: 'Content',
    description: 'Navigation, FAQ, hours, about page',
    sections: ['content-navigation', 'content-faq', 'content-hours', 'content-about'],
  },
  {
    id: 'discovery',
    label: 'Discovery',
    description: 'SEO defaults and social media links',
    sections: ['discovery-seo', 'discovery-social'],
  },
  {
    id: 'commerce',
    label: 'Commerce',
    description: 'Checkout form fields and order contact',
    sections: ['commerce-checkout', 'commerce-order'],
  },
]

export const SECTIONS: Record<SectionId, SectionMeta> = {
  'identity-store': {
    id: 'identity-store',
    categoryId: 'identity',
    title: 'Store Identity',
    description: 'Basic information that appears across your storefront.',
    icon: Store,
    fields: [
      'store_name', 'store_tagline', 'store_email', 'store_phone',
      'store_address', 'currency', 'currency_symbol',
    ],
  },
  'identity-brands': {
    id: 'identity-brands',
    categoryId: 'identity',
    title: 'Brands & Systems',
    description: 'Manage brand systems shown in the storefront header and footer.',
    icon: Palette,
    fields: ['store_systems'],
  },
  'visuals-hero': {
    id: 'visuals-hero',
    categoryId: 'visuals',
    title: 'Hero Banner',
    description: 'Slider images and secondary banner on the homepage.',
    icon: ImageIcon,
    fields: ['hero_slides', 'hero_secondary_banner', 'hero_secondary_banner_alt'],
  },
  'visuals-footer': {
    id: 'visuals-footer',
    categoryId: 'visuals',
    title: 'Footer Content',
    description: 'Text and copyright shown in the storefront footer.',
    icon: Layout,
    fields: ['footer_description', 'footer_copyright'],
  },
  'content-navigation': {
    id: 'content-navigation',
    categoryId: 'content',
    title: 'Navigation Menu',
    description: 'Header navigation items shown in the top bar.',
    icon: List,
    fields: ['navigation_items'],
  },
  'content-faq': {
    id: 'content-faq',
    categoryId: 'content',
    title: 'FAQ Items',
    description: 'Frequently asked questions on the FAQ page.',
    icon: HelpCircle,
    fields: ['faq_items'],
  },
  'content-hours': {
    id: 'content-hours',
    categoryId: 'content',
    title: 'Operating Hours',
    description: 'Store hours displayed on support and stores pages.',
    icon: Clock,
    fields: ['hours_label', 'hours_details'],
  },
  'content-about': {
    id: 'content-about',
    categoryId: 'content',
    title: 'About & Company',
    description: 'About-us text, payment & shipping policy, company information.',
    icon: Info,
    fields: [
      'about_us_text', 'payment_info', 'shipping_info',
      'company_name', 'company_registration', 'company_certifications',
      'company_team_size', 'company_ceo_name',
    ],
  },
  'discovery-seo': {
    id: 'discovery-seo',
    categoryId: 'discovery',
    title: 'SEO Defaults',
    description: 'Default meta tags for search engine optimization.',
    icon: Search,
    fields: ['seo_title', 'seo_description', 'seo_keywords'],
  },
  'discovery-social': {
    id: 'discovery-social',
    categoryId: 'discovery',
    title: 'Social Links',
    description: 'Social media URLs and messaging usernames.',
    icon: Share2,
    fields: [
      'social_facebook', 'social_instagram', 'social_youtube',
      'social_whatsapp', 'social_messenger_username',
    ],
  },
  'commerce-checkout': {
    id: 'commerce-checkout',
    categoryId: 'commerce',
    title: 'Checkout Configuration',
    description: 'Form fields and payment options available to customers.',
    icon: ShoppingCart,
    fields: [
      'checkout_district_enabled', 'checkout_thana_enabled',
      'checkout_district_required', 'checkout_thana_required',
      'checkout_payment_modes',
    ],
  },
  'commerce-order': {
    id: 'commerce-order',
    categoryId: 'commerce',
    title: 'Order Contact',
    description: 'WhatsApp and phone for order-related customer contact.',
    icon: Phone,
    fields: ['order_whatsapp', 'order_call_number'],
  },
}

export function getSectionById(id: SectionId): SectionMeta {
  const section = SECTIONS[id]
  if (!section) throw new Error(`Unknown section id: ${id}`)
  return section
}

export function getFieldsInSection(id: SectionId): string[] {
  return SECTIONS[id]?.fields ?? []
}

export function getAllFieldKeys(): string[] {
  return Object.values(SECTIONS).flatMap(s => s.fields)
}

export function getSectionForField(key: string): SectionMeta | null {
  for (const section of Object.values(SECTIONS)) {
    if (section.fields.includes(key)) return section
  }
  return null
}

export function getCategoryById(id: CategoryId): CategoryMeta {
  const cat = CATEGORIES.find(c => c.id === id)
  if (!cat) throw new Error(`Unknown category id: ${id}`)
  return cat
}

export function getSectionsInCategory(id: CategoryId): SectionMeta[] {
  const cat = getCategoryById(id)
  return cat.sections.map(getSectionById)
}

export function getAllSections(): SectionMeta[] {
  return Object.values(SECTIONS)
}
```

- [ ] **Step 3: Create `lib/field-schemas.ts`** — field metadata for rendering + command palette search

```typescript
export type FieldType =
  | 'text' | 'email' | 'tel' | 'url'
  | 'textarea'
  | 'switch'
  | 'image'
  | 'currency'
  | 'array-store-systems'
  | 'array-hero-slides'
  | 'array-nav'
  | 'array-faq'
  | 'array-hours'
  | 'payment-modes'

export interface FieldSchema {
  label: string
  type: FieldType
  hint?: string
  placeholder?: string
  rows?: number
}

export const FIELD_SCHEMAS: Record<string, FieldSchema> = {
  store_name:                    { label: 'Store Name', type: 'text' },
  store_tagline:                 { label: 'Tagline', type: 'text' },
  store_email:                   { label: 'Email', type: 'email' },
  store_phone:                   { label: 'Phone', type: 'tel' },
  store_address:                 { label: 'Address', type: 'textarea', rows: 2 },
  currency:                      { label: 'Currency Code', type: 'text', placeholder: 'BDT' },
  currency_symbol:               { label: 'Currency Symbol', type: 'text', placeholder: '৳' },
  hero_slides:                   { label: 'Hero Slides', type: 'array-hero-slides' },
  hero_secondary_banner:         { label: 'Secondary Banner', type: 'image' },
  hero_secondary_banner_alt:     { label: 'Banner Alt Text', type: 'text' },
  social_facebook:               { label: 'Facebook URL', type: 'url', placeholder: 'https://facebook.com/...' },
  social_instagram:              { label: 'Instagram URL', type: 'url', placeholder: 'https://instagram.com/...' },
  social_youtube:                { label: 'YouTube URL', type: 'url', placeholder: 'https://youtube.com/...' },
  social_whatsapp:               { label: 'WhatsApp Number', type: 'tel', placeholder: '+8801700000000' },
  social_messenger_username:     { label: 'Messenger Username', type: 'text', placeholder: 'ecopage.bd' },
  order_whatsapp:                { label: 'Order WhatsApp', type: 'tel', placeholder: '+8801700000000' },
  order_call_number:             { label: 'Order Call Number', type: 'tel', placeholder: '+8801700000000' },
  seo_title:                     { label: 'Default Page Title', type: 'text' },
  seo_description:               { label: 'Meta Description', type: 'textarea', rows: 3 },
  seo_keywords:                  { label: 'Keywords (comma separated)', type: 'text' },
  footer_description:            { label: 'Footer Description', type: 'textarea', rows: 4 },
  footer_copyright:              { label: 'Copyright Text', type: 'text' },
  about_us_text:                 { label: 'About Us Text', type: 'textarea', rows: 4 },
  payment_info:                  { label: 'Payment Information', type: 'textarea', rows: 3 },
  shipping_info:                 { label: 'Shipping Policy Text', type: 'textarea', rows: 3, hint: 'Per-district delivery charges are configured in Shipping Settings.' },
  navigation_items:              { label: 'Navigation Items', type: 'array-nav' },
  faq_items:                     { label: 'FAQ Items', type: 'array-faq' },
  hours_label:                   { label: 'Hours Summary (text)', type: 'text', placeholder: 'Sat-Thu 10AM-10PM, Fri 3PM-10PM' },
  hours_details:                 { label: 'Daily Schedule', type: 'array-hours' },
  company_name:                  { label: 'Company Name', type: 'text' },
  company_registration:          { label: 'Registration Number', type: 'text' },
  company_certifications:        { label: 'Certifications', type: 'text' },
  company_team_size:             { label: 'Team Size', type: 'text' },
  company_ceo_name:              { label: 'CEO / Founder Name', type: 'text' },
  store_systems:                 { label: 'Store Brands / Systems', type: 'array-store-systems' },
  checkout_district_enabled:     { label: 'District Field', type: 'switch', hint: 'Show district dropdown in checkout' },
  checkout_thana_enabled:        { label: 'Thana/Upazila Field', type: 'switch', hint: 'Show thana dropdown in checkout' },
  checkout_district_required:    { label: 'District Required', type: 'switch', hint: 'Customer must select a district', },
  checkout_thana_required:       { label: 'Thana/Upazila Required', type: 'switch', hint: 'Customer must select a thana' },
  checkout_payment_modes:        { label: 'Payment Modes', type: 'payment-modes' },
}
```

- [ ] **Step 4: Create `storefront/index.ts`** — re-export

```typescript
export { StorefrontSettings } from './storefront-settings'
```

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/settings/storefront/
git commit -m "feat(storefront-settings): add directory structure and lib registry files"
```

---

### Task 2: Create `useStorefrontSettings` hook

**Files:**
- Create: `apps/admin/src/features/settings/storefront/hooks/use-storefront-settings.ts`
- Create: `apps/admin/src/features/settings/storefront/hooks/use-storefront-settings.test.tsx`

- [ ] **Step 1: Write the hook implementation**

```typescript
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { systemSettingsApi } from '@/features/settings/storage-api'
import { toast } from 'sonner'
import type { SectionId } from '@/features/settings/storefront/lib/categories'
import { getFieldsInSection } from '@/features/settings/storefront/lib/categories'

function extractSettings(data: Record<string, string> | undefined): Record<string, string> {
  if (!data) return {}
  return { ...data }
}

export function useStorefrontSettings() {
  const queryClient = useQueryClient()
  const { data: rawData, isLoading } = useQuery({
    queryKey: ['system-settings'],
    queryFn: () => systemSettingsApi.getAll().then(r => r.data),
  })

  const [values, setValues] = useState<Record<string, string>>({})
  const originalRef = useRef<Record<string, string>>({})
  const [lastSavedMap, setLastSavedMap] = useState<Record<string, Date | null>>({})

  const initialLoadDone = useRef(false)
  useEffect(() => {
    if (rawData && !initialLoadDone.current) {
      const extracted = extractSettings(rawData)
      setValues(extracted)
      originalRef.current = { ...extracted }
      initialLoadDone.current = true
    }
  }, [rawData])

  const setValue = useCallback((key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }, [])

  const setMany = useCallback((updates: Record<string, string>) => {
    setValues(prev => ({ ...prev, ...updates }))
  }, [])

  const isDirty = useCallback((key: string): boolean => {
    return values[key] !== originalRef.current[key]
  }, [values])

  const dirtyKeys = useMemo(() => {
    const keys = new Set<string>()
    for (const key of Object.keys(values)) {
      if (values[key] !== originalRef.current[key]) {
        keys.add(key)
      }
    }
    return keys
  }, [values])

  const isSectionDirty = useCallback((sectionId: SectionId): boolean => {
    const fields = getFieldsInSection(sectionId)
    return fields.some(f => values[f] !== originalRef.current[f])
  }, [values])

  const dirtyKeysInSection = useCallback((sectionId: SectionId): string[] => {
    const fields = getFieldsInSection(sectionId)
    return fields.filter(f => values[f] !== originalRef.current[f])
  }, [values])

  const setMut = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      systemSettingsApi.set(key, value),
    onSuccess: (_data, variables) => {
      originalRef.current = {
        ...originalRef.current,
        [variables.key]: values[variables.key],
      }
      setLastSavedMap(prev => ({ ...prev, [variables.key]: new Date() }))
    },
  })

  const saveSection = useCallback(async (sectionId: SectionId) => {
    const changedKeys = dirtyKeysInSection(sectionId)
    if (changedKeys.length === 0) return

    try {
      await Promise.all(
        changedKeys.map(key =>
          setMut.mutateAsync({ key, value: values[key] })
        )
      )
      queryClient.invalidateQueries({ queryKey: ['system-settings'] })
      toast.success('Section saved successfully')
    } catch {
      toast.error('Some settings failed to save. Please retry.')
    }
  }, [dirtyKeysInSection, values, setMut, queryClient])

  const resetSection = useCallback((sectionId: SectionId) => {
    const fields = getFieldsInSection(sectionId)
    setValues(prev => {
      const next = { ...prev }
      for (const field of fields) {
        next[field] = originalRef.current[field] ?? ''
      }
      return next
    })
  }, [])

  const isSaving = setMut.isPending

  return {
    values,
    isLoading,
    setValue,
    setMany,
    isDirty,
    dirtyKeys,
    isSectionDirty,
    dirtyKeysInSection,
    saveSection,
    resetSection,
    isSaving,
    lastSavedMap,
  }
}
```

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useStorefrontSettings } from './use-storefront-settings'
import { systemSettingsApi } from '@/features/settings/storage-api'

vi.mock('@/features/settings/storage-api', () => ({
  systemSettingsApi: {
    getAll: vi.fn(),
    set: vi.fn(),
  },
}))

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const MOCK_SETTINGS = {
  store_name: 'EcoMate',
  store_tagline: 'Shop Green',
  store_email: 'hello@ecomate.com',
  store_phone: '+8801700000000',
  store_address: 'Dhaka',
  currency: 'BDT',
  currency_symbol: '৳',
  seo_title: 'EcoMate - Shop Green',
  seo_description: 'Bangladesh eco store',
  seo_keywords: 'eco, green, bangladesh',
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useStorefrontSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(systemSettingsApi.getAll).mockResolvedValue({ data: MOCK_SETTINGS })
  })

  it('loads settings and sets initial values', async () => {
    const { result } = renderHook(() => useStorefrontSettings(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.values.store_name).toBe('EcoMate')
  })

  it('setValue changes a value and marks it dirty', async () => {
    const { result } = renderHook(() => useStorefrontSettings(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => result.current.setValue('store_name', 'New Name'))
    expect(result.current.values.store_name).toBe('New Name')
    expect(result.current.isDirty('store_name')).toBe(true)
  })

  it('isSectionDirty returns true when a field in the section is changed', async () => {
    const { result } = renderHook(() => useStorefrontSettings(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => result.current.setValue('store_name', 'New Name'))
    expect(result.current.isSectionDirty('identity-store')).toBe(true)
    expect(result.current.isSectionDirty('discovery-seo')).toBe(false)
  })

  it('dirtyKeysInSection returns only changed keys', async () => {
    const { result } = renderHook(() => useStorefrontSettings(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => result.current.setValue('store_name', 'New Name'))
    expect(result.current.dirtyKeysInSection('identity-store')).toEqual(['store_name'])
  })

  it('resetSection reverts all fields in that section', async () => {
    const { result } = renderHook(() => useStorefrontSettings(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => result.current.setValue('store_name', 'New Name'))
    act(() => result.current.setValue('seo_title', 'New SEO'))
    act(() => result.current.resetSection('identity-store'))
    expect(result.current.values.store_name).toBe('EcoMate')
    expect(result.current.values.seo_title).toBe('New SEO')
  })

  it('saveSection calls API for changed keys only', async () => {
    vi.mocked(systemSettingsApi.set).mockResolvedValue({} as any)
    const { result } = renderHook(() => useStorefrontSettings(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    act(() => result.current.setValue('store_name', 'New Name'))
    await act(async () => { await result.current.saveSection('identity-store') })
    expect(systemSettingsApi.set).toHaveBeenCalledTimes(1)
    expect(systemSettingsApi.set).toHaveBeenCalledWith('store_name', 'New Name')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx vitest run src/features/settings/storefront/hooks/use-storefront-settings.test.tsx --reporter verbose 2>&1 | head -40`
Expected: Fails (file not found or compilation error)

- [ ] **Step 4: Create the test file with the above code**

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx vitest run src/features/settings/storefront/hooks/use-storefront-settings.test.tsx --reporter verbose 2>&1 | tail -20`
Expected: 6 tests passing

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/features/settings/storefront/hooks/
git commit -m "feat(storefront-settings): add useStorefrontSettings hook with tests"
```

---

### Task 3: Create shared primitive components — Field, DirtyDot, SaveBar

**Files:**
- Create: `apps/admin/src/features/settings/storefront/components/field.tsx`
- Create: `apps/admin/src/features/settings/storefront/components/dirty-dot.tsx`
- Create: `apps/admin/src/features/settings/storefront/components/save-bar.tsx`

- [ ] **Step 1: Create `field.tsx`**

```typescript
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { FieldSchema, FieldType } from '@/features/settings/storefront/lib/field-schemas'

interface FieldProps {
  fieldKey: string
  schema: FieldSchema
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  hint?: string
}

export function Field({ fieldKey, schema, value, onChange, disabled, placeholder, hint }: FieldProps) {
  const inputProps = {
    id: fieldKey,
    'data-field-key': fieldKey,
    disabled,
  }

  const renderInput = () => {
    switch (schema.type) {
      case 'textarea':
        return (
          <Textarea
            {...inputProps}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder ?? schema.placeholder}
            rows={schema.rows ?? 3}
          />
        )

      case 'switch':
        return (
          <Switch
            {...inputProps}
            checked={value === 'true'}
            onCheckedChange={c => onChange(String(c))}
          />
        )

      case 'email':
        return (
          <Input
            {...inputProps}
            type='email'
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder ?? schema.placeholder}
          />
        )

      case 'tel':
        return (
          <Input
            {...inputProps}
            type='tel'
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder ?? schema.placeholder}
          />
        )

      case 'url':
        return (
          <Input
            {...inputProps}
            type='url'
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder ?? schema.placeholder}
          />
        )

      default:
        return (
          <Input
            {...inputProps}
            type='text'
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder ?? schema.placeholder}
          />
        )
    }
  }

  return (
    <div className='space-y-1.5'>
      <Label htmlFor={fieldKey} className='text-xs font-medium text-foreground/80'>
        {schema.label}
      </Label>
      {renderInput()}
      {(hint || schema.hint) && (
        <p className='text-xs text-muted-foreground'>{hint ?? schema.hint}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `dirty-dot.tsx`**

```typescript
interface DirtyDotProps {
  isDirty: boolean
  isSaving?: boolean
  className?: string
}

export function DirtyDot({ isDirty, isSaving, className = '' }: DirtyDotProps) {
  if (!isDirty && !isSaving) return null
  return (
    <span
      className={`inline-block w-1.5 h-1.5 rounded-full bg-primary transition-opacity duration-300 ${isSaving ? 'animate-pulse' : ''} ${className}`}
      aria-label={isSaving ? 'Saving...' : 'Unsaved changes'}
    />
  )
}
```

- [ ] **Step 3: Create `save-bar.tsx`**

```typescript
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'

interface SaveBarProps {
  isDirty: boolean
  isSaving: boolean
  dirtyCount: number
  lastSavedAt: Date | null
  onSave: () => void
  onReset: () => void
}

function formatRelativeTime(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 5) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ago`
}

export function SaveBar({ isDirty, isSaving, dirtyCount, lastSavedAt, onSave, onReset }: SaveBarProps) {
  if (!isDirty && !isSaving) return null

  const metaText = lastSavedAt
    ? `${dirtyCount} unsaved change${dirtyCount !== 1 ? 's' : ''} · saved ${formatRelativeTime(lastSavedAt)}`
    : `${dirtyCount} unsaved change${dirtyCount !== 1 ? 's' : ''}`

  return (
    <div className='border-t border-border/40 pt-4 mt-6 flex items-center justify-between'>
      <span className='text-xs text-muted-foreground'>{metaText}</span>
      <div className='flex items-center gap-2'>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          className='h-8 text-xs text-muted-foreground hover:text-foreground'
          onClick={onReset}
          disabled={isSaving}
        >
          Discard
        </Button>
        <Button
          type='button'
          size='sm'
          className='h-8 px-4 text-xs font-medium'
          onClick={onSave}
          disabled={isSaving}
        >
          {isSaving && <Loader2 className='animate-spin h-3.5 w-3.5 mr-1.5' />}
          Save Section
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/features/settings/storefront/components/field.tsx \
  apps/admin/src/features/settings/storefront/components/dirty-dot.tsx \
  apps/admin/src/features/settings/storefront/components/save-bar.tsx
git commit -m "feat(storefront-settings): add Field, DirtyDot, SaveBar primitives"
```

---

### Task 4: Create SectionShell component

**Files:**
- Create: `apps/admin/src/features/settings/storefront/components/section-shell.tsx`
- Create: `apps/admin/src/features/settings/storefront/components/section-shell.test.tsx`

- [ ] **Step 1: Write `section-shell.tsx`**

```typescript
import type { ReactNode } from 'react'
import { SaveBar } from './save-bar'
import { DirtyDot } from './dirty-dot'
import type { SectionId } from '@/features/settings/storefront/lib/categories'

interface SectionShellProps {
  id: SectionId
  title: string
  description: string
  isDirty: boolean
  isSaving: boolean
  dirtyCount: number
  lastSavedAt: Date | null
  onSave: () => void
  onReset: () => void
  children: ReactNode
}

export function SectionShell({
  id,
  title,
  description,
  isDirty,
  isSaving,
  dirtyCount,
  lastSavedAt,
  onSave,
  onReset,
  children,
}: SectionShellProps) {
  return (
    <div
      data-section-id={id}
      className='border border-border/60 rounded-xl bg-card p-6 scroll-mt-4'
    >
      <div className='flex items-center gap-2 mb-1'>
        <h3 className='text-base font-medium text-foreground'>{title}</h3>
        <DirtyDot isDirty={isDirty} isSaving={isSaving} />
      </div>
      <p className='text-sm text-muted-foreground mb-4'>{description}</p>
      <div className='border-t border-border/40 pt-4 space-y-4'>
        {children}
      </div>
      <SaveBar
        isDirty={isDirty}
        isSaving={isSaving}
        dirtyCount={dirtyCount}
        lastSavedAt={lastSavedAt}
        onSave={onSave}
        onReset={onReset}
      />
    </div>
  )
}
```

- [ ] **Step 2: Write the test**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { SectionShell } from './section-shell'

describe('SectionShell', () => {
  it('renders title and description', async () => {
    const screen = render(
      <SectionShell
        id='identity-store'
        title='Store Identity'
        description='Basic info'
        isDirty={false}
        isSaving={false}
        dirtyCount={0}
        lastSavedAt={null}
        onSave={vi.fn()}
        onReset={vi.fn()}
      >
        <div>child</div>
      </SectionShell>
    )
    await expect.element(screen.getByText('Store Identity')).toBeInTheDocument()
    await expect.element(screen.getByText('Basic info')).toBeInTheDocument()
    await expect.element(screen.getByText('child')).toBeInTheDocument()
  })

  it('shows save bar when dirty', async () => {
    const screen = render(
      <SectionShell
        id='identity-store'
        title='Store Identity'
        description='Basic info'
        isDirty={true}
        isSaving={false}
        dirtyCount={2}
        lastSavedAt={null}
        onSave={vi.fn()}
        onReset={vi.fn()}
      >
        <div>child</div>
      </SectionShell>
    )
    await expect.element(screen.getByText('2 unsaved changes')).toBeInTheDocument()
    await expect.element(screen.getByText('Save Section')).toBeInTheDocument()
  })

  it('hides save bar when not dirty and not saving', async () => {
    const screen = render(
      <SectionShell
        id='identity-store'
        title='Store Identity'
        description='Basic info'
        isDirty={false}
        isSaving={false}
        dirtyCount={0}
        lastSavedAt={null}
        onSave={vi.fn()}
        onReset={vi.fn()}
      >
        <div>child</div>
      </SectionShell>
    )
    expect(screen.queryByText('Save Section')).toBeNull()
  })

  it('calls onSave when Save Section is clicked', async () => {
    const onSave = vi.fn()
    const screen = render(
      <SectionShell
        id='identity-store'
        title='Store Identity'
        description='Basic info'
        isDirty={true}
        isSaving={false}
        dirtyCount={1}
        lastSavedAt={null}
        onSave={onSave}
        onReset={vi.fn()}
      >
        <div>child</div>
      </SectionShell>
    )
    await screen.getByText('Save Section').click()
    expect(onSave).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx vitest run src/features/settings/storefront/components/section-shell.test.tsx --reporter verbose 2>&1 | tail -20`
Expected: 4 tests passing

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/features/settings/storefront/components/section-shell.tsx \
  apps/admin/src/features/settings/storefront/components/section-shell.test.tsx
git commit -m "feat(storefront-settings): add SectionShell with tests"
```

---

### Task 5: Create CategorySidebar component

**Files:**
- Create: `apps/admin/src/features/settings/storefront/components/category-sidebar.tsx`

- [ ] **Step 1: Write `category-sidebar.tsx`**

```typescript
import { cn } from '@/lib/utils'
import { DirtyDot } from './dirty-dot'
import type { CategoryMeta, SectionId, SectionMeta } from '@/features/settings/storefront/lib/categories'

interface CategorySidebarProps {
  categories: CategoryMeta[]
  sections: Record<SectionId, SectionMeta>
  activeSectionId: SectionId
  dirtySectionIds: Set<SectionId>
  onSectionClick: (id: SectionId) => void
  onOpenPalette: () => void
}

export function CategorySidebar({
  categories,
  sections,
  activeSectionId,
  dirtySectionIds,
  onSectionClick,
  onOpenPalette,
}: CategorySidebarProps) {
  return (
    <nav className='w-full space-y-3' aria-label='Settings categories'>
      <button
        onClick={onOpenPalette}
        className='w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground border border-border/60 rounded-md hover:bg-muted/50 transition-colors'
      >
        <kbd className='inline-flex items-center gap-0.5 text-[10px] font-medium text-muted-foreground/60'>
          <span className='text-xs'>⌘</span>K
        </kbd>
        <span>Search settings...</span>
      </button>

      {categories.map(category => (
        <div key={category.id}>
          <h4 className='px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1'>
            {category.label}
          </h4>
          <div className='space-y-0.5'>
            {category.sections.map(sectionId => {
              const section = sections[sectionId]
              const isActive = sectionId === activeSectionId
              const isDirty = dirtySectionIds.has(sectionId)
              const Icon = section.icon
              return (
                <button
                  key={sectionId}
                  onClick={() => onSectionClick(sectionId)}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-1.5 text-sm rounded-md transition-colors text-left',
                    isActive
                      ? 'bg-accent/50 text-foreground font-medium border-l-2 border-primary'
                      : 'text-foreground/70 hover:text-foreground hover:bg-muted/30 border-l-2 border-transparent'
                  )}
                >
                  <Icon className='h-3.5 w-3.5 shrink-0' />
                  <span className='flex-1 truncate'>{section.title}</span>
                  <DirtyDot isDirty={isDirty} className='shrink-0' />
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </nav>
  )
}
```

- [ ] **Step 2: Use IntersectionObserver for active section tracking**

In the main container component (Task 9), implement an IntersectionObserver:

```typescript
const [activeSectionId, setActiveSectionId] = useState<SectionId>(allSections[0].id)

useEffect(() => {
  const sectionElements = allSections.map(s =>
    document.querySelector(`[data-section-id="${s.id}"]`)
  ).filter(Boolean) as HTMLElement[]

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute('data-section-id') as SectionId
          if (id) setActiveSectionId(id)
        }
      }
    },
    {
      rootMargin: '-10% 0px -60% 0px',
      threshold: 0.1,
    }
  )

  sectionElements.forEach(el => observer.observe(el))
  return () => observer.disconnect()
}, [allSections])
```

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/features/settings/storefront/components/category-sidebar.tsx
git commit -m "feat(storefront-settings): add CategorySidebar component"
```

---

### Task 6: Create CommandPalette component

**Files:**
- Create: `apps/admin/src/features/settings/storefront/components/command-palette.tsx`

- [ ] **Step 1: Write `command-palette.tsx`**

```typescript
import { useEffect, useMemo, useState } from 'react'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { getAllSections, getCategoryById, type SectionId } from '@/features/settings/storefront/lib/categories'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'

interface CommandPaletteProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNavigateToSection: (sectionId: SectionId) => void
}

interface SearchResult {
  type: 'section' | 'field'
  sectionId: SectionId
  label: string
  categoryLabel: string
}

export function CommandPalette({ open, onOpenChange, onNavigateToSection }: CommandPaletteProps) {
  const results = useMemo<SearchResult[]>(() => {
    const items: SearchResult[] = []
    for (const section of getAllSections()) {
      const category = getCategoryById(section.categoryId)
      items.push({
        type: 'section',
        sectionId: section.id,
        label: section.title,
        categoryLabel: category.label,
      })
      for (const fieldKey of section.fields) {
        const schema = FIELD_SCHEMAS[fieldKey]
        if (schema) {
          items.push({
            type: 'field',
            sectionId: section.id,
            label: schema.label,
            categoryLabel: category.label,
          })
        }
      }
    }
    return items
  }, [])

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title='Settings Search'>
      <CommandInput placeholder='Search settings and fields...' />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {['identity', 'visuals', 'content', 'discovery', 'commerce'].map(catId => {
          const catResults = results.filter(r => r.categoryLabel === getCategoryById(catId).label)
          if (catResults.length === 0) return null
          return (
            <CommandGroup key={catId} heading={getCategoryById(catId).label}>
              {catResults.map((result, idx) => (
                <CommandItem
                  key={`${result.sectionId}-${result.type}-${idx}`}
                  onSelect={() => {
                    onNavigateToSection(result.sectionId)
                    onOpenChange(false)
                    // Focus the first field in the section if it was a field search
                    if (result.type === 'field') {
                      setTimeout(() => {
                        const sectionEl = document.querySelector(`[data-section-id="${result.sectionId}"]`)
                        if (sectionEl) {
                          sectionEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
                          // Wait a tick and try focusing
                          setTimeout(() => {
                            const firstInput = sectionEl.querySelector('[data-field-key]') as HTMLElement | null
                            firstInput?.focus()
                          }, 100)
                        }
                      }, 50)
                    }
                  }}
                >
                  <span className='text-sm'>{result.label}</span>
                  <span className='ml-auto text-[10px] text-muted-foreground'>{result.categoryLabel}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )
        })}
      </CommandList>
    </CommandDialog>
  )
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey) && !isInputElement(e.target as HTMLElement)) {
        e.preventDefault()
        setOpen(prev => !prev)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  return { open, setOpen }
}

function isInputElement(el: HTMLElement | null): boolean {
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || el.isContentEditable
}
```

Note: Add `useState` import to the imports:

```typescript
import { useEffect, useMemo, useState } from 'react'
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/src/features/settings/storefront/components/command-palette.tsx
git commit -m "feat(storefront-settings): add CommandPalette component"
```

---

### Task 7: Create simple-field section components (part 1)

**Files:**
- Create: `apps/admin/src/features/settings/storefront/components/sections/identity-store-section.tsx`
- Create: `apps/admin/src/features/settings/storefront/components/sections/visuals-footer-section.tsx`
- Create: `apps/admin/src/features/settings/storefront/components/sections/discovery-seo-section.tsx`
- Create: `apps/admin/src/features/settings/storefront/components/sections/discovery-social-section.tsx`
- Create: `apps/admin/src/features/settings/storefront/components/sections/commerce-order-section.tsx`

These sections use only `Field` (text/email/tel/url/textarea/switch types), no complex arrays or images.

- [ ] **Step 1: Create section components**

**`identity-store-section.tsx`:**
```typescript
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props {
  hook: UseStorefrontSettingsReturn
}

export function IdentityStoreSection({ hook }: Props) {
  const sectionId = 'identity-store'
  return (
    <SectionShell
      id={sectionId}
      title='Store Identity'
      description='Basic information that appears across your storefront.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={hook.lastSavedMap.store_name ? hook.lastSavedMap.store_name : null}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <div className='grid gap-4 md:grid-cols-2'>
        {['store_name', 'store_tagline', 'store_email', 'store_phone'].map(key => (
          <Field
            key={key}
            fieldKey={key}
            schema={FIELD_SCHEMAS[key]}
            value={hook.values[key] ?? ''}
            onChange={v => hook.setValue(key, v)}
          />
        ))}
      </div>
      <Field
        fieldKey='store_address'
        schema={FIELD_SCHEMAS.store_address}
        value={hook.values.store_address ?? ''}
        onChange={v => hook.setValue('store_address', v)}
      />
      <div className='grid gap-4 md:grid-cols-2'>
        <Field
          fieldKey='currency'
          schema={FIELD_SCHEMAS.currency}
          value={hook.values.currency ?? ''}
          onChange={v => hook.setValue('currency', v)}
        />
        <Field
          fieldKey='currency_symbol'
          schema={FIELD_SCHEMAS.currency_symbol}
          value={hook.values.currency_symbol ?? ''}
          onChange={v => hook.setValue('currency_symbol', v)}
        />
      </div>
    </SectionShell>
  )
}
```

**`visuals-footer-section.tsx`:**
```typescript
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

export function VisualsFooterSection({ hook }: Props) {
  const sectionId = 'visuals-footer'
  return (
    <SectionShell
      id={sectionId}
      title='Footer Content'
      description='Text and copyright shown in the storefront footer.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={hook.lastSavedMap.footer_description ? hook.lastSavedMap.footer_description : null}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <Field
        fieldKey='footer_description'
        schema={FIELD_SCHEMAS.footer_description}
        value={hook.values.footer_description ?? ''}
        onChange={v => hook.setValue('footer_description', v)}
      />
      <Field
        fieldKey='footer_copyright'
        schema={FIELD_SCHEMAS.footer_copyright}
        value={hook.values.footer_copyright ?? ''}
        onChange={v => hook.setValue('footer_copyright', v)}
      />
    </SectionShell>
  )
}
```

**`discovery-seo-section.tsx`:**
```typescript
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

export function DiscoverySeoSection({ hook }: Props) {
  const sectionId = 'discovery-seo'
  return (
    <SectionShell
      id={sectionId}
      title='SEO Defaults'
      description='Default meta tags for search engine optimization.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={hook.lastSavedMap.seo_title ? hook.lastSavedMap.seo_title : null}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <Field
        fieldKey='seo_title'
        schema={FIELD_SCHEMAS.seo_title}
        value={hook.values.seo_title ?? ''}
        onChange={v => hook.setValue('seo_title', v)}
      />
      <Field
        fieldKey='seo_description'
        schema={FIELD_SCHEMAS.seo_description}
        value={hook.values.seo_description ?? ''}
        onChange={v => hook.setValue('seo_description', v)}
      />
      <Field
        fieldKey='seo_keywords'
        schema={FIELD_SCHEMAS.seo_keywords}
        value={hook.values.seo_keywords ?? ''}
        onChange={v => hook.setValue('seo_keywords', v)}
      />
    </SectionShell>
  )
}
```

**`discovery-social-section.tsx`:**
```typescript
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

export function DiscoverySocialSection({ hook }: Props) {
  const sectionId = 'discovery-social'
  return (
    <SectionShell
      id={sectionId}
      title='Social Links'
      description='Social media URLs and messaging usernames displayed in the footer.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={hook.lastSavedMap.social_facebook ? hook.lastSavedMap.social_facebook : null}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <div className='grid gap-4 md:grid-cols-2'>
        {['social_facebook', 'social_instagram', 'social_youtube', 'social_whatsapp', 'social_messenger_username'].map(key => (
          <Field
            key={key}
            fieldKey={key}
            schema={FIELD_SCHEMAS[key]}
            value={hook.values[key] ?? ''}
            onChange={v => hook.setValue(key, v)}
          />
        ))}
      </div>
    </SectionShell>
  )
}
```

**`commerce-order-section.tsx`:**
```typescript
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

export function CommerceOrderSection({ hook }: Props) {
  const sectionId = 'commerce-order'
  return (
    <SectionShell
      id={sectionId}
      title='Order Contact'
      description='Phone numbers and WhatsApp configuration for order-related customer contact.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={hook.lastSavedMap.order_whatsapp ? hook.lastSavedMap.order_whatsapp : null}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <div className='grid gap-4 md:grid-cols-2'>
        <Field
          fieldKey='order_whatsapp'
          schema={FIELD_SCHEMAS.order_whatsapp}
          value={hook.values.order_whatsapp ?? ''}
          onChange={v => hook.setValue('order_whatsapp', v)}
        />
        <Field
          fieldKey='order_call_number'
          schema={FIELD_SCHEMAS.order_call_number}
          value={hook.values.order_call_number ?? ''}
          onChange={v => hook.setValue('order_call_number', v)}
        />
      </div>
    </SectionShell>
  )
}
```

- [ ] **Step 2: Define `UseStorefrontSettingsReturn` type**

Add this export to `use-storefront-settings.ts`:

```typescript
export interface UseStorefrontSettingsReturn {
  values: Record<string, string>
  isLoading: boolean
  setValue: (key: string, value: string) => void
  setMany: (updates: Record<string, string>) => void
  isDirty: (key: string) => boolean
  dirtyKeys: Set<string>
  isSectionDirty: (sectionId: SectionId) => boolean
  dirtyKeysInSection: (sectionId: SectionId) => string[]
  saveSection: (sectionId: SectionId) => Promise<void>
  resetSection: (sectionId: SectionId) => void
  isSaving: boolean
  lastSavedMap: Record<string, Date | null>
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/features/settings/storefront/hooks/use-storefront-settings.ts \
  apps/admin/src/features/settings/storefront/components/sections/identity-store-section.tsx \
  apps/admin/src/features/settings/storefront/components/sections/visuals-footer-section.tsx \
  apps/admin/src/features/settings/storefront/components/sections/discovery-seo-section.tsx \
  apps/admin/src/features/settings/storefront/components/sections/discovery-social-section.tsx \
  apps/admin/src/features/settings/storefront/components/sections/commerce-order-section.tsx
git commit -m "feat(storefront-settings): add simple-field section components"
```

---

### Task 8: Create complex section components (images, arrays, switches)

**Files:**
- Create: `apps/admin/src/features/settings/storefront/components/sections/visuals-hero-section.tsx`
- Create: `apps/admin/src/features/settings/storefront/components/sections/identity-brands-section.tsx`
- Create: `apps/admin/src/features/settings/storefront/components/sections/commerce-checkout-section.tsx`
- Create: `apps/admin/src/features/settings/storefront/components/sections/content-hours-section.tsx`
- Create: `apps/admin/src/features/settings/storefront/components/sections/content-about-section.tsx`

These sections have complex fields: image pickers, dynamic arrays, switch groups, payment mode checkboxes.

- [ ] **Step 1: Create `visuals-hero-section.tsx`** — port from old component's hero tab

```typescript
import { useState } from 'react'
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MediaPicker } from '@/components/media-picker'
import { SafeImage } from '@/components/safe-image'
import { mediaUrl } from '@/lib/utils'
import { ImageIcon, Plus, X } from 'lucide-react'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

interface HeroSlide {
  image: string; link?: string; alt?: string
}

export function VisualsHeroSection({ hook }: Props) {
  const sectionId = 'visuals-hero'
  const [slidePickerOpen, setSlidePickerOpen] = useState(false)
  const [activeSlideIndex, setActiveSlideIndex] = useState<number | null>(null)
  const [secondaryPickerOpen, setSecondaryPickerOpen] = useState(false)

  const heroSlides: HeroSlide[] = (() => {
    try { return JSON.parse(hook.values.hero_slides || '[]') as HeroSlide[] } catch { return [] }
  })()

  const setHeroSlides = (slides: HeroSlide[]) => {
    hook.setValue('hero_slides', JSON.stringify(slides))
  }

  const secondaryBanner = hook.values.hero_secondary_banner ?? ''
  const secondaryBannerAlt = hook.values.hero_secondary_banner_alt ?? ''
  const setSecondaryBanner = (v: string) => hook.setValue('hero_secondary_banner', v)
  const setSecondaryBannerAlt = (v: string) => hook.setValue('hero_secondary_banner_alt', v)

  return (
    <SectionShell
      id={sectionId}
      title='Hero Banner'
      description='Slider images and secondary banner on the homepage.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={null}
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
                  ? <SafeImage src={mediaUrl(slide.image)} alt={slide.alt || ''} className='h-full w-full object-cover' />
                  : <ImageIcon className='h-6 w-6 text-muted-foreground' />}
              </div>
              <div className='flex-1 space-y-3'>
                <div className='space-y-2'>
                  <Label className='text-xs'>Image</Label>
                  <div className='flex gap-2'>
                    <Input value={slide.image || ''} onChange={e => {
                      const next = [...heroSlides]; next[i] = { ...next[i], image: e.target.value }; setHeroSlides(next)
                    }} placeholder='https://example.com/banner.jpg' />
                    <Button type='button' variant='outline' size='sm' onClick={() => { setActiveSlideIndex(i); setSlidePickerOpen(true) }}>Pick</Button>
                  </div>
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
          <Button variant='outline' size='sm' onClick={() => setHeroSlides([...heroSlides, { image: '', link: '', alt: '' }])}>
            <Plus className='h-4 w-4 mr-1' /> Add Slide
          </Button>
        </div>

        <div className='space-y-3'>
          <Label className='text-xs font-medium text-foreground/80'>Secondary Banner</Label>
          <div className='flex items-start gap-3'>
            <div className='h-32 w-full max-w-md rounded border overflow-hidden bg-muted shrink-0 flex items-center justify-center'>
              {secondaryBanner
                ? <SafeImage src={mediaUrl(secondaryBanner)} alt={secondaryBannerAlt || ''} className='h-full w-full object-cover' />
                : <ImageIcon className='h-8 w-8 text-muted-foreground' />}
            </div>
          </div>
          <div className='grid gap-3 md:grid-cols-2 max-w-2xl'>
            <div className='space-y-2'>
              <Label className='text-xs'>Image URL</Label>
              <div className='flex gap-2'>
                <Input value={secondaryBanner} onChange={e => setSecondaryBanner(e.target.value)} placeholder='https://example.com/banner.jpg' />
                <Button type='button' variant='outline' size='sm' onClick={() => setSecondaryPickerOpen(true)}>Pick</Button>
                {secondaryBanner && (
                  <Button type='button' variant='ghost' size='icon' onClick={() => setSecondaryBanner('')}>
                    <X className='h-4 w-4' />
                  </Button>
                )}
              </div>
            </div>
            <div className='space-y-2'>
              <Label className='text-xs'>Alt text</Label>
              <Input value={secondaryBannerAlt} onChange={e => setSecondaryBannerAlt(e.target.value)} placeholder='Banner description' />
            </div>
          </div>
        </div>
      </div>

      <MediaPicker
        open={slidePickerOpen && activeSlideIndex !== null}
        onOpenChange={(v) => { setSlidePickerOpen(v); if (!v) setActiveSlideIndex(null) }}
        selected={activeSlideIndex !== null && heroSlides[activeSlideIndex]?.image ? [heroSlides[activeSlideIndex].image] : []}
        multiple={false}
        onSelect={(urls) => {
          if (activeSlideIndex === null) return
          const url = urls[urls.length - 1] || ''
          const next = [...heroSlides]
          next[activeSlideIndex] = { ...next[activeSlideIndex], image: url }
          setHeroSlides(next)
          setSlidePickerOpen(false)
          setActiveSlideIndex(null)
        }}
      />
      <MediaPicker
        open={secondaryPickerOpen}
        onOpenChange={setSecondaryPickerOpen}
        selected={secondaryBanner ? [secondaryBanner] : []}
        multiple={false}
        onSelect={(urls) => {
          setSecondaryBanner(urls[urls.length - 1] || '')
          setSecondaryPickerOpen(false)
        }}
      />
    </SectionShell>
  )
}
```

- [ ] **Step 2: Create `identity-brands-section.tsx`** — port from old brands/system tab

```typescript
import { useState } from 'react'
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MediaPicker } from '@/components/media-picker'
import { SafeImage } from '@/components/safe-image'
import { Palette, Plus, X } from 'lucide-react'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

export function IdentityBrandsSection({ hook }: Props) {
  const sectionId = 'identity-brands'
  const [systemPickerOpen, setSystemPickerOpen] = useState(false)
  const [activeSystemIdx, setActiveSystemIdx] = useState<number | null>(null)

  const storeSystems: { id: string; name: string; logo: string; display: 'name' | 'logo' | 'name+logo' }[] = (() => {
    try { return JSON.parse(hook.values.store_systems || '[]') } catch { return [] }
  })()

  const setStoreSystems = (systems: typeof storeSystems) => {
    hook.setValue('store_systems', JSON.stringify(systems))
  }

  return (
    <SectionShell
      id={sectionId}
      title='Brands & Systems'
      description='Manage brand systems shown in the storefront header and footer.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={null}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <div className='space-y-4'>
        {storeSystems.map((sys, idx) => (
          <div key={sys.id} className='flex items-start gap-3 rounded-lg border p-4 bg-muted/10'>
            <div className='flex items-center gap-3 flex-1 flex-wrap'>
              <div className='w-10 h-10 rounded border bg-background flex items-center justify-center overflow-hidden shrink-0'>
                {sys.logo ? (
                  <SafeImage src={sys.logo} alt='' className='w-full h-full object-contain' />
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
                  <Button variant='outline' size='sm' className='h-8 text-xs' onClick={() => { setActiveSystemIdx(idx); setSystemPickerOpen(true) }}>
                    {sys.logo ? 'Change Logo' : 'Add Logo'}
                  </Button>
                  {sys.logo && (
                    <Button variant='ghost' size='sm' className='h-8 text-xs text-muted-foreground' onClick={() => {
                      const next = [...storeSystems]; next[idx] = { ...next[idx], logo: '' }; setStoreSystems(next)
                    }}>Remove</Button>
                  )}
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

      <MediaPicker
        open={systemPickerOpen && activeSystemIdx !== null}
        onOpenChange={(v) => { setSystemPickerOpen(v); if (!v) setActiveSystemIdx(null) }}
        selected={activeSystemIdx !== null && storeSystems[activeSystemIdx]?.logo ? [storeSystems[activeSystemIdx].logo] : []}
        multiple={false}
        onSelect={(urls) => {
          if (activeSystemIdx === null) return
          const url = urls[urls.length - 1] || ''
          const next = [...storeSystems]
          next[activeSystemIdx] = { ...next[activeSystemIdx], logo: url }
          setStoreSystems(next)
          setSystemPickerOpen(false)
          setActiveSystemIdx(null)
        }}
      />
    </SectionShell>
  )
}
```

- [ ] **Step 3: Create `commerce-checkout-section.tsx`** — port from checkout tab

```typescript
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

export function CommerceCheckoutSection({ hook }: Props) {
  const sectionId = 'commerce-checkout'

  const paymentModes: string[] = (() => {
    try { return JSON.parse(hook.values.checkout_payment_modes || '["cod","full","partial"]') as string[] } catch { return ['cod', 'full', 'partial'] }
  })()

  const togglePaymentMode = (mode: string, checked: boolean) => {
    const next = checked
      ? [...paymentModes, mode]
      : paymentModes.filter(m => m !== mode)
    hook.setValue('checkout_payment_modes', JSON.stringify(next))
  }

  return (
    <SectionShell
      id={sectionId}
      title='Checkout Configuration'
      description='Form fields and payment options available to customers during checkout.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={null}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <div className='space-y-4'>
        <div>
          <Label className='text-xs font-medium text-foreground/80 uppercase tracking-wider'>Delivery Location Fields</Label>
          <div className='grid gap-4 md:grid-cols-2 mt-2'>
            {(['checkout_district_enabled', 'checkout_thana_enabled', 'checkout_district_required', 'checkout_thana_required'] as const).map(key => (
              <div key={key} className='flex items-center justify-between p-4 border rounded-lg'>
                <div>
                  <Label className='text-sm font-medium'>{FIELD_SCHEMAS[key].label}</Label>
                  <p className='text-xs text-muted-foreground mt-1'>{FIELD_SCHEMAS[key].hint}</p>
                </div>
                <Field
                  fieldKey={key}
                  schema={FIELD_SCHEMAS[key]}
                  value={hook.values[key] ?? 'true'}
                  onChange={v => hook.setValue(key, v)}
                />
              </div>
            ))}
          </div>
        </div>
        <Separator />
        <div>
          <Label className='text-xs font-medium text-foreground/80 uppercase tracking-wider'>Payment Modes</Label>
          <div className='flex flex-wrap gap-4 mt-2'>
            {[
              { value: 'cod', label: 'Cash on Delivery', desc: 'Pay when delivered' },
              { value: 'full', label: 'Full Payment Online', desc: 'Pay full amount via online gateway' },
              { value: 'partial', label: 'Partial Payment', desc: 'Pay a partial amount now, rest on delivery' },
            ].map(mode => (
              <label key={mode.value} className='flex items-center gap-3 p-4 border rounded-lg cursor-pointer hover:bg-muted/30 transition-colors'>
                <input type='checkbox' className='h-4 w-4 accent-primary' checked={paymentModes.includes(mode.value)} onChange={e => togglePaymentMode(mode.value, e.target.checked)} />
                <div>
                  <span className='text-sm font-medium'>{mode.label}</span>
                  <p className='text-xs text-muted-foreground'>{mode.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>
    </SectionShell>
  )
}
```

- [ ] **Step 4: Create `content-hours-section.tsx`**

```typescript
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Plus, X } from 'lucide-react'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

export function ContentHoursSection({ hook }: Props) {
  const sectionId = 'content-hours'

  const hoursDetails: { day: string; time: string }[] = (() => {
    try { return JSON.parse(hook.values.hours_details || '[]') } catch { return [] }
  })()

  const setHoursDetails = (details: typeof hoursDetails) => {
    hook.setValue('hours_details', JSON.stringify(details))
  }

  return (
    <SectionShell
      id={sectionId}
      title='Operating Hours'
      description='Store hours displayed on support and stores pages.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={null}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <Field
        fieldKey='hours_label'
        schema={FIELD_SCHEMAS.hours_label}
        value={hook.values.hours_label ?? ''}
        onChange={v => hook.setValue('hours_label', v)}
      />
      <Separator />
      <div className='space-y-4'>
        <Label className='text-xs font-medium text-foreground/80'>Daily Schedule</Label>
        {hoursDetails.map((h, i) => (
          <div key={i} className='flex items-start gap-3 p-4 border rounded-lg bg-muted/30'>
            <div className='flex-1 grid grid-cols-1 md:grid-cols-2 gap-3'>
              <div className='space-y-2'>
                <Label className='text-xs'>Day(s)</Label>
                <Input value={h.day} onChange={e => {
                  const next = [...hoursDetails]; next[i] = { ...next[i], day: e.target.value }; setHoursDetails(next)
                }} placeholder='Saturday - Thursday' />
              </div>
              <div className='space-y-2'>
                <Label className='text-xs'>Time</Label>
                <Input value={h.time} onChange={e => {
                  const next = [...hoursDetails]; next[i] = { ...next[i], time: e.target.value }; setHoursDetails(next)
                }} placeholder='10:00 AM - 10:00 PM' />
              </div>
            </div>
            <Button variant='ghost' size='icon' className='mt-6 shrink-0 text-destructive' onClick={() => setHoursDetails(hoursDetails.filter((_, j) => j !== i))}>
              <X className='h-4 w-4' />
            </Button>
          </div>
        ))}
        <Button variant='outline' size='sm' onClick={() => setHoursDetails([...hoursDetails, { day: '', time: '' }])}>
          <Plus className='h-4 w-4 mr-1' /> Add Schedule
        </Button>
      </div>
    </SectionShell>
  )
}
```

- [ ] **Step 5: Create `content-about-section.tsx`** — merged about + company + shipping_info + payment_info

```typescript
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

export function ContentAboutSection({ hook }: Props) {
  const sectionId = 'content-about'
  const textFields = ['about_us_text', 'payment_info', 'shipping_info'] as const
  const companyFields = ['company_name', 'company_registration', 'company_certifications', 'company_team_size', 'company_ceo_name'] as const

  return (
    <SectionShell
      id={sectionId}
      title='About & Company'
      description='About-us text, payment & shipping policy, and company information.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={null}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <div className='space-y-4'>
        {textFields.map(key => (
          <Field
            key={key}
            fieldKey={key}
            schema={FIELD_SCHEMAS[key]}
            value={hook.values[key] ?? ''}
            onChange={v => hook.setValue(key, v)}
          />
        ))}
      </div>
      <Separator className='my-4' />
      <div>
        <Label className='text-xs font-medium text-foreground/80'>Company Information</Label>
        <div className='grid gap-4 md:grid-cols-2 mt-2'>
          {companyFields.map(key => (
            <Field
              key={key}
              fieldKey={key}
              schema={FIELD_SCHEMAS[key]}
              value={hook.values[key] ?? ''}
              onChange={v => hook.setValue(key, v)}
            />
          ))}
        </div>
      </div>
    </SectionShell>
  )
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/features/settings/storefront/components/sections/visuals-hero-section.tsx \
  apps/admin/src/features/settings/storefront/components/sections/identity-brands-section.tsx \
  apps/admin/src/features/settings/storefront/components/sections/commerce-checkout-section.tsx \
  apps/admin/src/features/settings/storefront/components/sections/content-hours-section.tsx \
  apps/admin/src/features/settings/storefront/components/sections/content-about-section.tsx
git commit -m "feat(storefront-settings): add complex section components (hero, brands, checkout, hours, about)"
```

---

### Task 9: Create array-section components (Nav, FAQ)

**Files:**
- Create: `apps/admin/src/features/settings/storefront/components/sections/content-navigation-section.tsx`
- Create: `apps/admin/src/features/settings/storefront/components/sections/content-faq-section.tsx`

- [ ] **Step 1: Create `content-navigation-section.tsx`**

```typescript
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { X } from 'lucide-react'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

interface NavItem { name: string; href: string }

export function ContentNavigationSection({ hook }: Props) {
  const sectionId = 'content-navigation'

  const navItems: NavItem[] = (() => {
    try { return JSON.parse(hook.values.navigation_items || '[]') as NavItem[] } catch { return [] }
  })()

  const setNavItems = (items: NavItem[]) => {
    hook.setValue('navigation_items', JSON.stringify(items))
  }

  return (
    <SectionShell
      id={sectionId}
      title='Navigation Menu'
      description='Header navigation items shown in the top bar.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={null}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <div className='space-y-4'>
        {navItems.map((item, i) => (
          <div key={i} className='flex items-start gap-3 p-4 border rounded-lg bg-muted/30'>
            <div className='flex-1 grid grid-cols-1 md:grid-cols-2 gap-3'>
              <div className='space-y-2'>
                <Label className='text-xs'>Label</Label>
                <Input value={item.name} onChange={e => {
                  const next = [...navItems]; next[i] = { ...next[i], name: e.target.value }; setNavItems(next)
                }} placeholder='New Arrivals' />
              </div>
              <div className='space-y-2'>
                <Label className='text-xs'>Link</Label>
                <Input value={item.href} onChange={e => {
                  const next = [...navItems]; next[i] = { ...next[i], href: e.target.value }; setNavItems(next)
                }} placeholder='/products?category=new' />
              </div>
            </div>
            <Button variant='ghost' size='icon' className='mt-6 shrink-0 text-destructive' onClick={() => setNavItems(navItems.filter((_, j) => j !== i))}>
              <X className='h-4 w-4' />
            </Button>
          </div>
        ))}
        <Button variant='outline' size='sm' onClick={() => setNavItems([...navItems, { name: '', href: '' }])}>
          + Add Item
        </Button>
      </div>
    </SectionShell>
  )
}
```

- [ ] **Step 2: Create `content-faq-section.tsx`**

```typescript
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { X } from 'lucide-react'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

interface FaqItem { question: string; answer: string }

export function ContentFaqSection({ hook }: Props) {
  const sectionId = 'content-faq'

  const faqItems: FaqItem[] = (() => {
    try { return JSON.parse(hook.values.faq_items || '[]') as FaqItem[] } catch { return [] }
  })()

  const setFaqItems = (items: FaqItem[]) => {
    hook.setValue('faq_items', JSON.stringify(items))
  }

  return (
    <SectionShell
      id={sectionId}
      title='FAQ Items'
      description='Frequently asked questions shown on the FAQ page.'
      isDirty={hook.isSectionDirty(sectionId)}
      isSaving={hook.isSaving}
      dirtyCount={hook.dirtyKeysInSection(sectionId).length}
      lastSavedAt={null}
      onSave={() => hook.saveSection(sectionId)}
      onReset={() => hook.resetSection(sectionId)}
    >
      <div className='space-y-4'>
        {faqItems.map((item, i) => (
          <div key={i} className='flex items-start gap-3 p-4 border rounded-lg bg-muted/30'>
            <div className='flex-1 space-y-3'>
              <div className='space-y-2'>
                <Label className='text-xs'>Question</Label>
                <Input value={item.question} onChange={e => {
                  const next = [...faqItems]; next[i] = { ...next[i], question: e.target.value }; setFaqItems(next)
                }} placeholder='How do I place an order?' />
              </div>
              <div className='space-y-2'>
                <Label className='text-xs'>Answer</Label>
                <Textarea value={item.answer} onChange={e => {
                  const next = [...faqItems]; next[i] = { ...next[i], answer: e.target.value }; setFaqItems(next)
                }} rows={3} placeholder='You can place an order through our website...' />
              </div>
            </div>
            <Button variant='ghost' size='icon' className='mt-6 shrink-0 text-destructive' onClick={() => setFaqItems(faqItems.filter((_, j) => j !== i))}>
              <X className='h-4 w-4' />
            </Button>
          </div>
        ))}
        <Button variant='outline' size='sm' onClick={() => setFaqItems([...faqItems, { question: '', answer: '' }])}>
          + Add FAQ
        </Button>
      </div>
    </SectionShell>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/features/settings/storefront/components/sections/content-navigation-section.tsx \
  apps/admin/src/features/settings/storefront/components/sections/content-faq-section.tsx
git commit -m "feat(storefront-settings): add array section components (nav, faq)"
```

---

### Task 10: Create the main two-pane container

**Files:**
- Create: `apps/admin/src/features/settings/storefront/storefront-settings.tsx`

- [ ] **Step 1: Write `storefront-settings.tsx`**

```typescript
import { useEffect, useMemo, useState } from 'react'
import { useBlocker } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { Separator } from '@/components/ui/separator'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useStorefrontSettings } from '@/features/settings/storefront/hooks/use-storefront-settings'
import { CategorySidebar } from '@/features/settings/storefront/components/category-sidebar'
import { CommandPalette, useCommandPalette } from '@/features/settings/storefront/components/command-palette'
import { IdentityStoreSection } from '@/features/settings/storefront/components/sections/identity-store-section'
import { IdentityBrandsSection } from '@/features/settings/storefront/components/sections/identity-brands-section'
import { VisualsHeroSection } from '@/features/settings/storefront/components/sections/visuals-hero-section'
import { VisualsFooterSection } from '@/features/settings/storefront/components/sections/visuals-footer-section'
import { ContentNavigationSection } from '@/features/settings/storefront/components/sections/content-navigation-section'
import { ContentFaqSection } from '@/features/settings/storefront/components/sections/content-faq-section'
import { ContentHoursSection } from '@/features/settings/storefront/components/sections/content-hours-section'
import { ContentAboutSection } from '@/features/settings/storefront/components/sections/content-about-section'
import { DiscoverySeoSection } from '@/features/settings/storefront/components/sections/discovery-seo-section'
import { DiscoverySocialSection } from '@/features/settings/storefront/components/sections/discovery-social-section'
import { CommerceCheckoutSection } from '@/features/settings/storefront/components/sections/commerce-checkout-section'
import { CommerceOrderSection } from '@/features/settings/storefront/components/sections/commerce-order-section'
import {
  CATEGORIES,
  SECTIONS,
  getAllSections,
  type SectionId,
} from '@/features/settings/storefront/lib/categories'

export function StorefrontSettings() {
  const hook = useStorefrontSettings()
  const palette = useCommandPalette()
  const [activeSectionId, setActiveSectionId] = useState<SectionId>('identity-store')
  const [blockerOpen, setBlockerOpen] = useState(false)

  const allSections = useMemo(() => getAllSections(), [])

  // IntersectionObserver for active section tracking
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
      { rootMargin: '-10% 0px -60% 0px', threshold: 0.1 }
    )

    sectionElements.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [allSections])

  // Dirty section IDs for sidebar
  const dirtySectionIds = useMemo(() => {
    return new Set(allSections.filter(s => hook.isSectionDirty(s.id)).map(s => s.id))
  }, [allSections, hook])

  // Navigation guard
  const blocker = useBlocker({
    shouldBlockFn: () => dirtySectionIds.size > 0,
  })

  useEffect(() => {
    if (blocker.state === 'blocked') {
      setBlockerOpen(true)
    }
  }, [blocker.state])

  const handleBlockerContinue = () => {
    setBlockerOpen(false)
    if (blocker.state === 'blocked') blocker.proceed?.()
  }

  const handleBlockerReset = () => {
    setBlockerOpen(false)
    if (blocker.state === 'blocked') blocker.reset?.()
  }

  // beforeunload warning
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtySectionIds.size > 0) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirtySectionIds.size])

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

      <div className='flex flex-col gap-6 lg:flex-row lg:gap-8'>
        {/* Sidebar — hidden on small screens, shown as horizontal chips on tablet via CSS */}
        <aside className='w-full shrink-0 lg:w-64 lg:sticky lg:top-0 lg:self-start'>
          <CategorySidebar
            categories={CATEGORIES}
            sections={SECTIONS}
            activeSectionId={activeSectionId}
            dirtySectionIds={dirtySectionIds}
            onSectionClick={handleSectionClick}
            onOpenPalette={() => palette.setOpen(true)}
          />
        </aside>

        {/* Content */}
        <div className='flex-1 min-w-0 space-y-8'>
          <IdentityStoreSection hook={hook} />
          <IdentityBrandsSection hook={hook} />
          <VisualsHeroSection hook={hook} />
          <VisualsFooterSection hook={hook} />
          <ContentNavigationSection hook={hook} />
          <ContentFaqSection hook={hook} />
          <ContentHoursSection hook={hook} />
          <ContentAboutSection hook={hook} />
          <DiscoverySeoSection hook={hook} />
          <DiscoverySocialSection hook={hook} />
          <CommerceCheckoutSection hook={hook} />
          <CommerceOrderSection hook={hook} />
        </div>
      </div>

      <CommandPalette
        open={palette.open}
        onOpenChange={palette.setOpen}
        onNavigateToSection={handleSectionClick}
      />

      {/* Unsaved changes dialog */}
      <ConfirmDialog
        open={blockerOpen}
        onOpenChange={(v) => { setBlockerOpen(v); if (!v) handleBlockerReset() }}
        title='Unsaved Changes'
        desc='You have unsaved changes in one or more sections. What would you like to do?'
        confirmText='Discard & Leave'
        destructive
        handleConfirm={handleBlockerContinue}
      >
        <div className='flex flex-wrap gap-2 py-2'>
          <span className='text-xs text-muted-foreground'>
            {dirtySectionIds.size} section{dirtySectionIds.size > 1 ? 's' : ''} with unsaved changes.
          </span>
        </div>
      </ConfirmDialog>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin/src/features/settings/storefront/storefront-settings.tsx
git commit -m "feat(storefront-settings): add main two-pane container with IntersectionObserver"
```

---

### Task 11: Wire route and remove old monolithic file

**Files:**
- Modify: `apps/admin/src/routes/_authenticated/mon/settings/storefront/index.tsx`
- Delete: `apps/admin/src/features/settings/storefront-settings.tsx`

- [ ] **Step 1: Update route to import from new location**

Rewrite `apps/admin/src/routes/_authenticated/mon/settings/storefront/index.tsx`:
```typescript
import { createFileRoute } from '@tanstack/react-router'
import { StorefrontSettings } from '@/features/settings/storefront'

export const Route = createFileRoute('/_authenticated/mon/settings/storefront/')({
  component: StorefrontSettings,
})
```

- [ ] **Step 2: Delete the old monolithic file**

```bash
rm apps/admin/src/features/settings/storefront-settings.tsx
```

- [ ] **Step 3: Run TypeScript check**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx tsc --noEmit 2>&1 | head -40`
Expected: No errors (or only pre-existing unrelated errors).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/routes/_authenticated/mon/settings/storefront/index.tsx
git rm apps/admin/src/features/settings/storefront-settings.tsx
git commit -m "feat(storefront-settings): wire new route, delete old monolithic file"
```

---

### Task 12: Mobile responsive + browser QA

**Files:**
- Modify: `apps/admin/src/features/settings/storefront/storefront-settings.tsx`
- Modify: `apps/admin/src/features/settings/storefront/components/category-sidebar.tsx`

- [ ] **Step 1: Add mobile chip row to the main container**

Modify `storefront-settings.tsx` — add a responsive category chip row that appears below lg breakpoint:

Add after the header, before the `flex flex-col gap-6...` section:

```typescript
{/* Mobile/tablet: horizontal category chip row (visible below lg) */}
<div className='flex lg:hidden overflow-x-auto gap-2 pb-2 -mx-1 px-1 scrollbar-none snap-x snap-mandatory'>
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
```

- [ ] **Step 2: Add `scrollbar-none` utility to globals.css if missing**

Check if `scrollbar-none` exists in `apps/admin/src/app/globals.css`. If not, add it.

- [ ] **Step 3: Quick browser test**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npm run dev`
Open in browser at 375px width — verify:
- Chip row appears
- Categories are tappable
- Content scrolls
- No horizontal overflow

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/features/settings/storefront/storefront-settings.tsx \
  apps/admin/src/features/settings/storefront/components/category-sidebar.tsx
git commit -m "feat(storefront-settings): add mobile responsive chip navigation"
```

---

### Task 13: Final QA — type check, backwards compat, dark mode

- [ ] **Step 1: Full TypeScript check**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx tsc --noEmit 2>&1`
Expected: No errors.

- [ ] **Step 2: Run existing tests to verify no regressions**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx vitest run --reporter verbose 2>&1 | tail -30`
Expected: All tests pass (pre-existing + new).

- [ ] **Step 3: Verify all 40 keys are settable**

Run a quick Node.js script or manually check that every key from `getAllFieldKeys()` maps to a field in at least one section. Best done by running:

```typescript
import { getAllFieldKeys } from '@/features/settings/storefront/lib/categories'
console.log('Total keys:', getAllFieldKeys().length) // Expected: 40
```

- [ ] **Step 4: Manual dark mode visual check**
- Open the page with dark mode.
- Verify all section cards appear with correct borders.
- Verify inputs have correct dark-mode styling (existing via CSS variable system).
- No hard-coded light colors visible.

- [ ] **Step 5: Verify Cmd+K opens palette**
- Press Cmd/Ctrl+K
- Type "social" — see results filtered
- Press Enter — navigates to Social Links section

- [ ] **Step 6: Commit the final touches**

```bash
git add -A
git commit -m "chore(storefront-settings): final QA fixes"
```

---

### Self-review checklist

1. **Spec coverage:**
   - [ ] Two-pane layout? → Task 10
   - [ ] 5 categories / 12 sections? → Task 1 (registry)
   - [ ] Per-section autosave with dirty indicator? → Task 2 (hook) + Task 3-4 (components)
   - [ ] Cmd/Ctrl+K command palette? → Task 6
   - [ ] Removed deprecated placeholder tabs? → Task 11 (delete old file)
   - [ ] shippping_info merged to content-about? → Task 8 (content-about-section)
   - [ ] No backend changes? → Verified — uses same `systemSettingsApi`
   - [ ] Unsaved-changes guard? → Task 10 (beforeunload + blocker)
   - [ ] Mobile responsive? → Task 12
   - [ ] Linear/Vervel ultra-minimal visual style? → Task 1-4 (design decisions built into each component)

2. **Placeholder scan:** No "TBD", "TODO", or incomplete sections.

3. **Type consistency:** `UseStorefrontSettingsReturn` defined in Task 7, referenced consistently in Tasks 7-10.

4. **Image type handling:** The `Field` component handles `image` type via... it actually doesn't — it falls through to the default `text` input. The image pickers are handled inline in `visuals-hero-section.tsx` and `identity-brands-section.tsx`. This is correct because they need the `MediaPicker` dialog. The `Field` component could be enhanced later, but for now the image URLs are raw text inputs in complex sections. **Note:** The `image` type in `field-schemas.ts` is unused by `Field` — it's just metadata for the command palette search. This is acceptable.
