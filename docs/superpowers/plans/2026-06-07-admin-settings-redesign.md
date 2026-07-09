# Admin Settings Redesign — Implementation Plan
> **Superseded by:** `docs/2-ARCHITECTURE/ARCHITECTURE.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize admin settings into a consistent two-tier navigation with grouped sub-nav, fix misplaced sidebar items, move flat files to sub-folders, and replace the System card-grid landing page with a real General settings page.

**Architecture:** Two-tier navigation (main sidebar → Settings footer → settings sub-nav). Monitoring settings grouped into 5 categories (General, Storefront, Integrations, Content, System). Operational settings grouped into 2 categories (Profile, Preferences). Flat monolithic files moved to sub-folder structure with barrel exports. The `SidebarNav` component updated to support grouped items.

**Tech Stack:** TanStack Router v1, shadcn/ui, Lucide icons. Same stack as the rest of the admin.

---

### Task 1: Update main sidebar data

**Files:**
- Modify: `apps/admin/src/components/layout/data/sidebar-data.ts`

**Changes:**
1. Remove `Tracking` from the Administration group (no longer a top-level nav item)
2. Update the Secondary group's monitoring Settings URL from `/mon/settings/system` to `/mon/settings/general`

- [ ] **Step 1: Read the file**

Read `apps/admin/src/components/layout/data/sidebar-data.ts` to confirm current content matches what we expect.

- [ ] **Step 2: Remove Tracking from Administration group**

Find the Administration items array and remove the Tracking entry:

```typescript
{ title: 'Administration', panel: 'monitoring', items: [
  { title: 'User Management', url: '/mon/users', icon: Users },
  { title: 'Activity Logs', url: '/mon/activity-logs', icon: ListTodo },
  // { title: 'Tracking', url: '/mon/settings/tracking', icon: Radio },  ← DELETE THIS LINE
]},
```

- [ ] **Step 3: Update Settings footer URL**

Find the Secondary group's monitoring Settings entry and change its URL:

```typescript
// Before:
{ title: 'Settings', url: '/mon/settings/system', icon: Settings, panel: 'monitoring' },
// After:
{ title: 'Settings', url: '/mon/settings/general', icon: Settings, panel: 'monitoring' },
```

If the `Radio` icon import is no longer used after removing Tracking, remove it from the import line.

- [ ] **Step 4: Verify TypeScript**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors (the Radio icon may still be used elsewhere — if not, remove from import).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/components/layout/data/sidebar-data.ts
git commit -m "fix(sidebar): move Tracking from Administration to Settings, update Settings URL"
```

---

### Task 2: Update SidebarNav to support grouped items

**Files:**
- Modify: `apps/admin/src/features/settings/components/sidebar-nav.tsx`

**Changes:**
The current `SidebarNav` accepts a flat `items` array. We need it to also accept grouped items with category headings. The component should:
- Accept EITHER flat items (backwards compatible) OR grouped items
- Desktop: render group labels as small headings followed by items
- Mobile: render grouped options in the select dropdown

- [ ] **Step 1: Write the updated component**

Replace `apps/admin/src/features/settings/components/sidebar-nav.tsx` with:

```typescript
import { useState, type JSX } from 'react'
import { useLocation, useNavigate, Link } from '@tanstack/react-router'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type SidebarNavItem = {
  href: string
  title: string
  icon: JSX.Element
}

type SidebarNavGroup = {
  groupLabel: string
  items: SidebarNavItem[]
}

type SidebarNavProps = React.HTMLAttributes<HTMLElement> & {
  items?: SidebarNavItem[]
  groups?: SidebarNavGroup[]
}

export function SidebarNav({ className, items, groups, ...props }: SidebarNavProps) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [val, setVal] = useState(pathname ?? '')

  // Flatten groups into a single items list for the mobile select
  const allItems: SidebarNavItem[] = groups
    ? groups.flatMap(g => g.items)
    : items ?? []

  const handleSelect = (e: string) => {
    setVal(e)
    navigate({ to: e })
  }

  return (
    <>
      <div className='p-1 md:hidden'>
        <Select value={val} onValueChange={handleSelect}>
          <SelectTrigger className='h-12 sm:w-48'>
            <SelectValue placeholder='Select setting' />
          </SelectTrigger>
          <SelectContent>
            {groups
              ? groups.flatMap(group =>
                  group.items.map(item => (
                    <SelectItem key={item.href} value={item.href}>
                      <div className='flex gap-x-4 px-2 py-1'>
                        <span className='scale-125'>{item.icon}</span>
                        <span className='text-md'>{item.title}</span>
                      </div>
                    </SelectItem>
                  ))
                )
              : allItems.map(item => (
                  <SelectItem key={item.href} value={item.href}>
                    <div className='flex gap-x-4 px-2 py-1'>
                      <span className='scale-125'>{item.icon}</span>
                      <span className='text-md'>{item.title}</span>
                    </div>
                  </SelectItem>
                ))}
          </SelectContent>
        </Select>
      </div>

      <ScrollArea
        orientation='horizontal'
        type='always'
        className='hidden w-full min-w-40 bg-background px-1 py-2 md:block'
      >
        <nav
          className={cn(
            'flex space-x-2 py-1 lg:flex-col lg:space-y-1 lg:space-x-0',
            className
          )}
          {...props}
        >
          {groups
            ? groups.map(group => (
                <div key={group.groupLabel} className='lg:space-y-0.5'>
                  <h4 className='hidden px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 lg:block'>
                    {group.groupLabel}
                  </h4>
                  {group.items.map(item => (
                    <Link
                      key={item.href}
                      to={item.href}
                      className={cn(
                        buttonVariants({ variant: 'ghost' }),
                        pathname === item.href
                          ? 'bg-muted hover:bg-accent'
                          : 'hover:bg-accent hover:underline',
                        'justify-start w-full'
                      )}
                    >
                      <span className='me-2'>{item.icon}</span>
                      {item.title}
                    </Link>
                  ))}
                </div>
              ))
            : allItems.map(item => (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    buttonVariants({ variant: 'ghost' }),
                    pathname === item.href
                      ? 'bg-muted hover:bg-accent'
                      : 'hover:bg-accent hover:underline',
                    'justify-start'
                  )}
                >
                  <span className='me-2'>{item.icon}</span>
                  {item.title}
                </Link>
              ))}
        </nav>
      </ScrollArea>
    </>
  )
}
```

Note: The `useState` initial value uses `pathname ?? ''` instead of a hardcoded fallback to avoid stale route references.

- [ ] **Step 2: Verify TypeScript**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/features/settings/components/sidebar-nav.tsx
git commit -m "feat(settings): update SidebarNav to support grouped navigation items"
```

---

### Task 3: Update Settings layout with grouped navigation

**Files:**
- Modify: `apps/admin/src/features/settings/index.tsx`

**Changes:**
- Replace flat `monNavItems` and `opNavItems` arrays with grouped arrays
- Add missing pages: Tracking, Branding, Display, Pages
- Add new icons imports
- Update the `<SidebarNav>` usage to pass `groups` instead of `items`

- [ ] **Step 1: Read the current file**

Read `apps/admin/src/features/settings/index.tsx` to confirm current structure.

- [ ] **Step 2: Update imports**

Add missing icon imports:
```typescript
import { FileText, Radio } from 'lucide-react'
```

- [ ] **Step 3: Replace flat nav arrays with grouped nav**

Replace:
```typescript
const monNavItems = [
  { title: 'System', href: '/mon/settings/system', icon: <SettingsIcon size={18} /> },
  { title: 'Storefront', href: '/mon/settings/storefront', icon: <Store size={18} /> },
  { title: 'Gateways', href: '/mon/settings/gateways', icon: <CreditCard size={18} /> },
  { title: 'Storage', href: '/mon/settings/storage', icon: <HardDrive size={18} /> },
  { title: 'Courier', href: '/mon/settings/courier', icon: <Truck size={18} /> },
  { title: 'Shipping', href: '/mon/settings/shipping', icon: <Package size={18} /> },
  { title: 'Order Statuses', href: '/mon/settings/order-statuses', icon: <RefreshCw size={18} /> },
]
```

With:
```typescript
const monNavGroups = [
  {
    groupLabel: 'General',
    items: [
      { title: 'System Settings', href: '/mon/settings/general', icon: <SettingsIcon size={18} /> },
    ],
  },
  {
    groupLabel: 'Storefront',
    items: [
      { title: 'Storefront', href: '/mon/settings/storefront', icon: <Store size={18} /> },
      { title: 'Branding & Identity', href: '/mon/settings/branding', icon: <Palette size={18} /> },
      { title: 'Catalog Display', href: '/mon/settings/display', icon: <Monitor size={18} /> },
    ],
  },
  {
    groupLabel: 'Integrations',
    items: [
      { title: 'Payment Gateways', href: '/mon/settings/gateways', icon: <CreditCard size={18} /> },
      { title: 'Courier', href: '/mon/settings/courier', icon: <Truck size={18} /> },
      { title: 'Shipping', href: '/mon/settings/shipping', icon: <Package size={18} /> },
      { title: 'Tracking & Analytics', href: '/mon/settings/tracking', icon: <Radio size={18} /> },
    ],
  },
  {
    groupLabel: 'Content',
    items: [
      { title: 'CMS Pages', href: '/mon/settings/pages', icon: <FileText size={18} /> },
      { title: 'Storage', href: '/mon/settings/storage', icon: <HardDrive size={18} /> },
    ],
  },
  {
    groupLabel: 'System',
    items: [
      { title: 'Order Statuses', href: '/mon/settings/order-statuses', icon: <RefreshCw size={18} /> },
    ],
  },
]
```

Replace:
```typescript
const opNavItems = [
  { title: 'Profile', href: '/op/settings/personal', icon: <UserCog size={18} /> },
  { title: 'Account', href: '/op/settings/account', icon: <Wrench size={18} /> },
  { title: 'Appearance', href: '/op/settings/appearance', icon: <Palette size={18} /> },
  { title: 'Notifications', href: '/op/settings/notifications', icon: <Bell size={18} /> },
  { title: 'Display', href: '/op/settings/display', icon: <Monitor size={18} /> },
]
```

With:
```typescript
const opNavGroups = [
  {
    groupLabel: 'Profile',
    items: [
      { title: 'Profile', href: '/op/settings/personal', icon: <UserCog size={18} /> },
      { title: 'Account', href: '/op/settings/account', icon: <Wrench size={18} /> },
    ],
  },
  {
    groupLabel: 'Preferences',
    items: [
      { title: 'Appearance', href: '/op/settings/appearance', icon: <Palette size={18} /> },
      { title: 'Notifications', href: '/op/settings/notifications', icon: <Bell size={18} /> },
      { title: 'Display', href: '/op/settings/display', icon: <Monitor size={18} /> },
    ],
  },
]
```

- [ ] **Step 4: Update the conditional logic**

Replace:
```typescript
const items = isMon ? monNavItems : opNavItems
```

With:
```typescript
const navGroups = isMon ? monNavGroups : opNavGroups
```

Replace:
```typescript
<SidebarNav items={items} />
```

With:
```typescript
<SidebarNav groups={navGroups} />
```

- [ ] **Step 5: Update the title and description**

Change the monitoring panel heading from "System Configuration" to "Settings" for consistency:
```typescript
<h1 className='text-2xl font-bold tracking-tight md:text-3xl'>
  {isMon ? 'Settings' : 'Settings'}
</h1>
```

Since both panels use "Settings" now, simplify to:
```typescript
<h1 className='text-2xl font-bold tracking-tight md:text-3xl'>Settings</h1>
<p className='text-muted-foreground'>
  {isMon
    ? 'Configure system-level settings, storefront appearance, and third-party integrations.'
    : 'Manage your account settings and preferences.'}
</p>
```

- [ ] **Step 6: Verify TypeScript**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/features/settings/index.tsx
git commit -m "feat(settings): add grouped navigation with all missing pages"
```

---

### Task 4: Create General settings page

**Files:**
- Create: `apps/admin/src/features/settings/general/index.ts`
- Create: `apps/admin/src/features/settings/general/general-settings.tsx`

**Changes:**
Create a new General settings page replacing the old System card-grid landing page. This page contains real system-level configuration fields.

- [ ] **Step 1: Create `general/index.ts` barrel export**

```typescript
export { GeneralSettings } from './general-settings'
```

- [ ] **Step 2: Create `general/general-settings.tsx`**

```typescript
import { useState, useEffect } from 'react'
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Field } from '@/features/settings/storefront/components/field'
import { FIELD_SCHEMAS } from '@/features/settings/storefront/lib/field-schemas'
import { systemSettingsApi } from '@/features/settings/storage-api'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

interface GeneralValues {
  app_name: string
  app_url: string
  default_timezone: string
  default_locale: string
  maintenance_mode: string
  admin_email: string
  pagination_default: string
}

const DEFAULT_VALUES: GeneralValues = {
  app_name: '',
  app_url: '',
  default_timezone: 'Asia/Dhaka',
  default_locale: 'en',
  maintenance_mode: 'false',
  admin_email: '',
  pagination_default: '20',
}

export function GeneralSettings() {
  const [values, setValues] = useState<GeneralValues>(DEFAULT_VALUES)
  const [originalValues, setOriginalValues] = useState<GeneralValues>(DEFAULT_VALUES)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    systemSettingsApi.getAll().then(r => {
      const data = r.data as Partial<GeneralValues>
      const extracted: GeneralValues = {
        app_name: data.app_name ?? '',
        app_url: data.app_url ?? '',
        default_timezone: data.default_timezone ?? 'Asia/Dhaka',
        default_locale: data.default_locale ?? 'en',
        maintenance_mode: data.maintenance_mode ?? 'false',
        admin_email: data.admin_email ?? '',
        pagination_default: data.pagination_default ?? '20',
      }
      setValues(extracted)
      setOriginalValues(extracted)
      setIsLoading(false)
    }).catch(() => {
      setIsLoading(false)
    })
  }, [])

  const setValue = (key: string, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }))
  }

  const isDirty = Object.keys(values).some(k => values[k as keyof GeneralValues] !== originalValues[k as keyof GeneralValues])
  const dirtyKeys = Object.keys(values).filter(k => values[k as keyof GeneralValues] !== originalValues[k as keyof GeneralValues])
  const lastSavedAt = null

  const handleSave = async () => {
    setIsSaving(true)
    try {
      await Promise.all(
        dirtyKeys.map(key => systemSettingsApi.set(key, values[key as keyof GeneralValues]))
      )
      setOriginalValues({ ...values })
      toast.success('Settings saved')
    } catch {
      toast.error('Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const handleReset = () => {
    setValues({ ...originalValues })
  }

  if (isLoading) {
    return (
      <div className='flex items-center justify-center min-h-[200px]'>
        <Loader2 className='animate-spin h-6 w-6 text-primary' />
      </div>
    )
  }

  const GENERAL_FIELDS: Record<string, { label: string; type: 'text' | 'email' | 'textarea' | 'switch'; hint?: string; placeholder?: string }> = {
    app_name: { label: 'App Name', type: 'text', placeholder: 'EcoMate' },
    app_url: { label: 'App URL', type: 'text', placeholder: 'https://example.com' },
    default_timezone: { label: 'Default Timezone', type: 'text', placeholder: 'Asia/Dhaka' },
    default_locale: { label: 'Default Locale', type: 'text', placeholder: 'en' },
    maintenance_mode: { label: 'Maintenance Mode', type: 'switch', hint: 'Enable maintenance mode for the storefront' },
    admin_email: { label: 'Admin Email', type: 'email', placeholder: 'admin@example.com' },
    pagination_default: { label: 'Default Pagination', type: 'text', placeholder: '20' },
  }

  return (
    <div className='space-y-6'>
      <SectionShell
        id='general'
        title='System Settings'
        description='General system-level configuration for your application.'
        isDirty={isDirty}
        isSaving={isSaving}
        dirtyCount={dirtyKeys.length}
        lastSavedAt={lastSavedAt}
        onSave={handleSave}
        onReset={handleReset}
      >
        <div className='grid gap-4 md:grid-cols-2'>
          {Object.entries(GENERAL_FIELDS).map(([key, schema]) => (
            <Field
              key={key}
              fieldKey={key}
              schema={schema}
              value={values[key as keyof GeneralValues]}
              onChange={(v) => setValue(key, v)}
            />
          ))}
        </div>
      </SectionShell>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/features/settings/general/
git commit -m "feat(settings): create General settings page to replace card-grid landing page"
```

---

### Task 5: Create General route and update System route

**Files:**
- Create: `apps/admin/src/routes/_authenticated/mon/settings/general/index.tsx`
- Modify: `apps/admin/src/routes/_authenticated/mon/settings/system/index.tsx` → redirect to general

- [ ] **Step 1: Create the General route**

Create `apps/admin/src/routes/_authenticated/mon/settings/general/index.tsx`:

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { GeneralSettings } from '@/features/settings/general'

export const Route = createFileRoute('/_authenticated/mon/settings/general/')({
  component: GeneralSettings,
})
```

- [ ] **Step 2: Update the System route to redirect**

Modify `apps/admin/src/routes/_authenticated/mon/settings/system/index.tsx` to redirect to `/mon/settings/general`:

```typescript
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/mon/settings/system/')({
  loader: () => {
    throw redirect({ to: '/mon/settings/general' })
  },
})
```

This ensures any bookmarks or links to the old System URL still work.

- [ ] **Step 3: Verify TypeScript**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/routes/_authenticated/mon/settings/general/ \
  apps/admin/src/routes/_authenticated/mon/settings/system/
git commit -m "feat(settings): add General route, redirect old System route"
```

---

### Task 6: Migrate Tracking page to sub-folder

**Files:**
- Create: `apps/admin/src/features/settings/tracking/index.ts`
- Create: `apps/admin/src/features/settings/tracking/tracking-settings.tsx`
- Modify: `apps/admin/src/routes/_authenticated/mon/settings/tracking/index.tsx`
- Delete: `apps/admin/src/features/settings/tracking-settings.tsx`

- [ ] **Step 1: Read the current tracking file**

Read `apps/admin/src/features/settings/tracking-settings.tsx` to get its content.

- [ ] **Step 2: Create `tracking/index.ts` barrel**

```typescript
export { TrackingSettings } from './tracking-settings'
```

- [ ] **Step 3: Create `tracking/tracking-settings.tsx`**

Copy the exact content from `tracking-settings.tsx` (203 lines). No changes to the component — only the file location changes.

- [ ] **Step 4: Update the route import**

Modify `apps/admin/src/routes/_authenticated/mon/settings/tracking/index.tsx`:

```typescript
// Before:
import { TrackingSettings } from '@/features/settings/tracking-settings'

// After:
import { TrackingSettings } from '@/features/settings/tracking'
```

- [ ] **Step 5: Delete the old flat file**

```bash
git rm apps/admin/src/features/settings/tracking-settings.tsx
```

- [ ] **Step 6: Verify TypeScript**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/features/settings/tracking/ \
  apps/admin/src/routes/_authenticated/mon/settings/tracking/index.tsx
git rm apps/admin/src/features/settings/tracking-settings.tsx
git commit -m "refactor(settings): move Tracking to sub-folder structure"
```

---

### Task 7: Migrate Branding, Display, Storage pages to sub-folders

**Files per page (repeat pattern for each):**

**Branding:**
- Create: `apps/admin/src/features/settings/branding/index.ts`
- Create: `apps/admin/src/features/settings/branding/branding-settings.tsx`
- Modify: route import
- Delete: flat file

**Display (catalog):**
- Create: `apps/admin/src/features/settings/display-catalog/index.ts`
- Create: `apps/admin/src/features/settings/display-catalog/display-settings.tsx`
- Modify: route import
- Delete: flat file

**Storage:**
- Create: `apps/admin/src/features/settings/storage/index.ts`
- Create: `apps/admin/src/features/settings/storage/storage-settings.tsx`
- Modify: route import
- Delete: flat file

- [ ] **Step 1: Migrate Branding**

Create `apps/admin/src/features/settings/branding/index.ts`:
```typescript
export { BrandingSettings } from './branding-settings'
```

Read `apps/admin/src/features/settings/branding-settings.tsx` and create `branding/branding-settings.tsx` with the exact same content.

Update route `apps/admin/src/routes/_authenticated/mon/settings/branding/index.tsx`:
```typescript
// Before:
import { BrandingSettings } from '@/features/settings/branding-settings'
// After:
import { BrandingSettings } from '@/features/settings/branding'
```

- [ ] **Step 2: Migrate Display (catalog)**

Create `apps/admin/src/features/settings/display-catalog/index.ts`:
```typescript
export { DisplaySettings } from './display-settings'
```

Read `apps/admin/src/features/settings/display-settings.tsx` and create `display-catalog/display-settings.tsx` with the exact same content.

Update route `apps/admin/src/routes/_authenticated/mon/settings/display/index.tsx`:
```typescript
// Before:
import { DisplaySettings } from '@/features/settings/display-settings'
// After:
import { DisplaySettings } from '@/features/settings/display-catalog'
```

- [ ] **Step 3: Migrate Storage**

Create `apps/admin/src/features/settings/storage/index.ts`:
```typescript
export { StorageSettings } from './storage-settings'
```

Read `apps/admin/src/features/settings/storage-settings.tsx` and create `storage/storage-settings.tsx` with the exact same content.

Update route `apps/admin/src/routes/_authenticated/mon/settings/storage/index.tsx`:
```typescript
// Before:
import { StorageSettings } from '@/features/settings/storage-settings'
// After:
import { StorageSettings } from '@/features/settings/storage'
```

- [ ] **Step 4: Verify TypeScript**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/settings/branding/ \
  apps/admin/src/features/settings/display-catalog/ \
  apps/admin/src/features/settings/storage/ \
  apps/admin/src/routes/_authenticated/mon/settings/branding/index.tsx \
  apps/admin/src/routes/_authenticated/mon/settings/display/index.tsx \
  apps/admin/src/routes/_authenticated/mon/settings/storage/index.tsx
git rm apps/admin/src/features/settings/branding-settings.tsx \
  apps/admin/src/features/settings/display-settings.tsx \
  apps/admin/src/features/settings/storage-settings.tsx
git commit -m "refactor(settings): move Branding, Display, Storage to sub-folders"
```

---

### Task 8: Migrate CMS Pages, Courier, Shipping to sub-folders

**Files per page (repeat pattern):**

**CMS Pages:**
- Create: `apps/admin/src/features/settings/cms-pages/index.ts`
- Create: `apps/admin/src/features/settings/cms-pages/cms-pages-settings.tsx`
- Create: `apps/admin/src/features/settings/cms-pages/cms-pages-api.ts`
- Modify: route import
- Delete: flat files

**Courier:**
- Create: `apps/admin/src/features/settings/courier/index.ts`
- Create: `apps/admin/src/features/settings/courier/courier-settings.tsx`
- Modify: route import
- Delete: flat file

**Shipping:**
- Create: `apps/admin/src/features/settings/shipping/index.ts`
- Create: `apps/admin/src/features/settings/shipping/shipping-settings.tsx`
- Modify: route import
- Delete: flat file

- [ ] **Step 1: Migrate CMS Pages**

Create `apps/admin/src/features/settings/cms-pages/index.ts`:
```typescript
export { CmsPagesSettings } from './cms-pages-settings'
```

Read `apps/admin/src/features/settings/cms-pages-settings.tsx` (332 lines) and `apps/admin/src/features/settings/cms-pages-api.ts`, create copies in `cms-pages/` sub-folder with the exact same content.

Update route `apps/admin/src/routes/_authenticated/mon/settings/pages/index.tsx`:
```typescript
// Before:
import { CmsPagesSettings } from '@/features/settings/cms-pages-settings'
// After:
import { CmsPagesSettings } from '@/features/settings/cms-pages'
```

- [ ] **Step 2: Migrate Courier**

Create `apps/admin/src/features/settings/courier/index.ts`:
```typescript
export { CourierSettings } from './courier-settings'
```

Read `apps/admin/src/features/settings/courier-settings.tsx` (281 lines), create copy in `courier/` sub-folder.

Update route `apps/admin/src/routes/_authenticated/mon/settings/courier/index.tsx`:
```typescript
// Before:
import { CourierSettings } from '@/features/settings/courier-settings'
// After:
import { CourierSettings } from '@/features/settings/courier'
```

- [ ] **Step 3: Migrate Shipping**

Create `apps/admin/src/features/settings/shipping/index.ts`:
```typescript
export { ShippingSettings } from './shipping-settings'
```

Read `apps/admin/src/features/settings/shipping-settings.tsx` (342 lines), create copy in `shipping/` sub-folder.

Update route `apps/admin/src/routes/_authenticated/mon/settings/shipping/index.tsx`:
```typescript
// Before:
import { ShippingSettings } from '@/features/settings/shipping-settings'
// After:
import { ShippingSettings } from '@/features/settings/shipping'
```

- [ ] **Step 4: Verify TypeScript**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/features/settings/cms-pages/ \
  apps/admin/src/features/settings/courier/ \
  apps/admin/src/features/settings/shipping/ \
  apps/admin/src/routes/_authenticated/mon/settings/pages/index.tsx \
  apps/admin/src/routes/_authenticated/mon/settings/courier/index.tsx \
  apps/admin/src/routes/_authenticated/mon/settings/shipping/index.tsx
git rm apps/admin/src/features/settings/cms-pages-settings.tsx \
  apps/admin/src/features/settings/cms-pages-api.ts \
  apps/admin/src/features/settings/courier-settings.tsx \
  apps/admin/src/features/settings/shipping-settings.tsx
git commit -m "refactor(settings): move CMS Pages, Courier, Shipping to sub-folders"
```

---

### Task 9: Delete old System landing page and remaining flat files

**Files:**
- Delete: `apps/admin/src/features/settings/system-settings.tsx`

- [ ] **Step 1: Delete old System file**

```bash
git rm apps/admin/src/features/settings/system-settings.tsx
```

- [ ] **Step 2: Verify TypeScript**

Run: `cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx tsc --noEmit 2>&1 | head -20`

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git commit -m "refactor(settings): delete old System card-grid landing page"
```

---

### Task 10: Final QA

**Files:**
- Check: All old flat files deleted
- Verify: All route imports updated
- Run: TypeScript check, full test suite

- [ ] **Step 1: Verify no stale imports**

Check that no remaining files import from deleted flat files:
```bash
cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin
grep -r "settings/tracking-settings\|settings/branding-settings\|settings/display-settings\|settings/storage-settings\|settings/cms-pages-settings\|settings/courier-settings\|settings/shipping-settings\|settings/system-settings" src/ --include="*.ts" --include="*.tsx" 2>/dev/null || echo "No stale imports found"
```

Expected: "No stale imports found" (any remaining imports would be pre-existing issues).

- [ ] **Step 2: Full TypeScript check**

```bash
cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx tsc --noEmit 2>&1 | head -20
```

Expected: No errors.

- [ ] **Step 3: Run storefront tests**

```bash
cd /Users/riaz/Custom Development Projects/EcoMate Web/apps/admin && npx vitest run src/features/settings/storefront/ --reporter verbose 2>&1 | tail -20
```

Expected: All 10 tests pass (no regressions from file moves).

- [ ] **Step 4: Verify sidebar navigation**

Manually verify (in browser or code trace):
1. Main sidebar no longer shows Tracking under Administration
2. Main sidebar Settings footer link points to `/mon/settings/general`
3. Settings sub-nav shows grouped items with all 10 pages
4. Operational settings sub-nav shows 2 groups with 5 pages

- [ ] **Step 5: Verify routes resolve**

Check that all route files exist:
- `/mon/settings/general/` ✅
- `/mon/settings/storefront/` ✅
- `/mon/settings/branding/` ✅
- `/mon/settings/display/` ✅
- `/mon/settings/tracking/` ✅
- `/mon/settings/gateways/` ✅
- `/mon/settings/courier/` ✅
- `/mon/settings/shipping/` ✅
- `/mon/settings/pages/` ✅
- `/mon/settings/storage/` ✅
- `/mon/settings/order-statuses/` ✅

All 11 route files must exist.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(settings): final QA — verify stale imports, routes, and tests"
```
