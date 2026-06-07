# Admin Settings Redesign — Design Spec

**Date:** 2026-06-07
**Status:** Approved Design
**Related:** Follows the Storefront Settings Redesign pattern (spec `2026-06-07-storefront-settings-redesign-design.md`)

## Goal

Reorganize all admin settings pages (`/mon/settings/*` and `/op/settings/*`) into a consistent, scalable, minimal two-tier navigation structure. Fix misplaced sidebar items (Tracking), complete the missing settings sub-navigation, and apply the storefront-style `SectionShell` wrapper pattern to eligible pages. No backend changes.

## Key Principles

1. **Minimal rewrite** — preserve existing page functionality; focus on navigation, wrapping, and structure
2. **Consistent two-tier** — main sidebar has a single "Settings" link; settings sub-nav has grouped items
3. **Hybrid patterns** — simple pages get a single `SectionShell` wrapper; complex multi-section pages use storefront's per-section autosave
4. **No backend changes** — all existing API endpoints and storage keys preserved

## Current State & Issues

### Main Sidebar (`sidebar-data.ts`)

**Monitoring Panel — Administration group:**
```
Administration
├── User Management    → /mon/users
├── Activity Logs      → /mon/activity-logs
└── Tracking           → /mon/settings/tracking   ← MISPLACED: should be in Settings
```

**Settings footer link** → `/mon/settings/system` (42-line card-grid landing page)

### Settings Sub-Nav (`features/settings/index.tsx:monNavItems`)

Currently shows only 7 of 11 monitoring settings pages:

| Present in Sub-Nav | Missing from Sub-Nav |
|--------------------|---------------------|
| System, Storefront | **Tracking** |
| Gateways, Storage  | **Branding** |
| Courier, Shipping  | **Display** |
| Order Statuses     | **Pages** |

### Settings Page Structures

| Page | Lines | Complexity | API | Current Structure |
|------|-------|-----------|-----|-------------------|
| Storefront ✅ | redesigned | Complex | `systemSettingsApi` | Modular (sub-folder + hooks + lib) |
| Tracking | 203 | Medium | `systemSettingsApi` | Flat file |
| Branding | 248 | Medium | `systemSettingsApi` | Flat file |
| Display (catalog) | 332 | Medium | `systemSettingsApi` | Flat file |
| Storage | 180 | Medium | `systemSettingsApi` | Flat file |
| Gateways | 263 | Complex | Custom `gatewayApi` | `features/gateways/` (folder) |
| Courier | 281 | Complex | Custom `courierApi` | Flat file |
| Shipping | 342 | Complex | Custom (3 resources) | Flat file |
| CMS Pages | 332 | Complex | Custom `cmsPagesApi` | Flat file |
| Order Statuses | 63 | Medium | Custom `orderStatusApi` | `features/order-statuses/` (folder) |
| System (landing) | 42 | Simple | None | Flat file → **remove** |

## Architecture

### Two-Tier Navigation (unchanged)

```
Main Sidebar
  └─ Settings (footer link) → General page
       └─ Settings Sub-Nav (2nd tier: grouped links)
            └─ Individual settings page
```

The main sidebar shows a single "Settings" link (footer position). Clicking it opens the settings layout showing the settings sub-nav sidebar + the selected page content. This is the existing two-tier pattern — we keep it but fix the groupings and completeness.

### Main Sidebar Changes

**Remove from `sidebar-data.ts`:**

```typescript
// Administration group — remove Tracking
{ title: 'Administration', panel: 'monitoring', items: [
  { title: 'User Management', url: '/mon/users', icon: Users },
  { title: 'Activity Logs', url: '/mon/activity-logs', icon: ListTodo },
  // { title: 'Tracking', url: '/mon/settings/tracking', icon: Radio },  ← REMOVE
]},
```

**Update Secondary group:**

```typescript
{ title: 'Secondary', items: [
  { title: 'Settings', url: '/mon/settings/general', icon: Settings, panel: 'monitoring' },
  // ... op settings, help center unchanged
]},
```

The operational panel's Settings footer stays at `/op/settings/personal` — no change needed.

### Monitoring Settings — 5 Groups, 10 Pages

```
📋 General
    └─ System Settings         (new — replaces 42-line card-grid, real config)

🏪 Storefront
    ├─ Storefront Settings     (existing — already redesigned)
    ├─ Branding & Identity     (move to sub-folder)
    └─ Catalog Display         (move to sub-folder)

🔗 Integrations
    ├─ Payment Gateways        (keep in features/gateways/)
    ├─ Courier Configuration   (move to sub-folder)
    ├─ Shipping Settings       (move to sub-folder)
    └─ Tracking & Analytics    (move to sub-folder)

📄 Content
    ├─ CMS Pages               (move to sub-folder)
    └─ Storage & Media         (move to sub-folder)

🔧 System
    └─ Order Statuses          (keep in features/order-statuses/)
```

Page count: 1 + 3 + 4 + 2 + 1 = 11 physical route pages. The old `system-settings.tsx` card grid is deleted (42 lines).

### Operational Settings — 2 Groups, 5 Pages

```
👤 Profile
    ├─ Profile                 (keep in sub-folder)
    └─ Account                 (keep in sub-folder)

🎨 Preferences
    ├─ Appearance              (keep in sub-folder)
    ├─ Notifications           (keep in sub-folder)
    └─ Display                 (keep in sub-folder)
```

No structural changes needed — these already use sub-folders.

## Component Patterns

### Pattern A: Single SectionShell (most pages)

Used by: System, Branding, Display (catalog), Storage, Tracking, Profile, Account, Notifications, Appearance, Display (sidebar)

Structure:
```typescript
import { SectionShell } from '@/features/settings/storefront/components/section-shell'

export function BrandingSettings() {
  // API calls using systemSettingsApi or dedicated hook
  return (
    <div className='space-y-6'>
      <SectionShell
        id='branding'
        title='Branding & Identity'
        description='...'
        isDirty={...}
        isSaving={...}
        dirtyCount={...}
        lastSavedAt={...}
        onSave={...}
        onReset={...}
      >
        {/* form fields */}
      </SectionShell>
    </div>
  )
}
```

For simple forms without dirty tracking needs, use `ContentSection` (existing) or `PageShell` (thin wrapper with title + description + save button).

### Pattern B: Multi-Section (per-section autosave)

Used by: Storefront ✅ (done)

No other pages need multi-section autosave. Shipping's 3 tabs stay as a tab-based UI — no rewrite.

### Pattern C: CRUD + Table

Used by: Gateways, Courier, Shipping, CMS Pages, Order Statuses

Existing CRUD patterns preserved. No structural changes. Only:
- Move flat files to sub-folders
- Add to settings sub-nav

### Shared Components

| Component | Source | Notes |
|-----------|--------|-------|
| `SectionShell` | Reuse from storefront | `import from '@/features/settings/storefront/components/section-shell'` |
| `SaveBar` | Reuse from storefront | |
| `DirtyDot` | Reuse from storefront | |
| `SidebarNav` | Existing (`features/settings/components/sidebar-nav.tsx`) | Update to support group headings + icons |
| `ContentSection` | Existing | Keep for simple pages |
| `PageShell` | **New** | Thin wrapper: title + description + content area (for pages that don't need save-bar) |
| `useSettingsForm` | **New** (optional) | Generic hook for `systemSettingsApi` pages: get settings, local state, save |

### Settings Sub-Nav Redesign

The existing `SidebarNav` component renders a flat list. We need grouped navigation with category headings.

New component or prop enhancement:
```typescript
interface SidebarNavGroup {
  groupLabel: string
  items: { title: string; href: string; icon: JSX.Element }[]
}
```

Desktop: group headings + items (vertical)
Mobile: grouped select/accordion or scrollable chips

### New Page: General / System Settings

Replaces the old 42-line card grid landing page. Real system-level configuration:

**Fields (proposed):**
- Store Name (read-only — managed in Storefront Settings)
- App URL
- Default Timezone (select)
- Default Locale (select)
- Maintenance Mode (switch)
- Admin Email
- Pagination Default (number)

These use `systemSettingsApi.set()` just like storefront fields.

### Page Move Pattern: Flat File → Sub-folder

Each flat file (`tracking-settings.tsx`, `branding-settings.tsx`, etc.) moves to:

```
features/settings/{slug}/
├── index.ts          → barrel export
├── components/       → (optional) sub-components
└── ...               → test files, hooks if needed
```

The barrel exports the component with the same name (e.g., `BrandingSettings`) so route imports don't need to change file paths — only module paths update.

Example route file after move:
```typescript
// Before:
import { BrandingSettings } from '@/features/settings/branding-settings'

// After (route file unchanged — barrel matches):
import { BrandingSettings } from '@/features/settings/branding-settings'
// Actually the import stays the same if we use the same filename in sub-folder's index.ts
```

Wait — if we move `branding-settings.tsx` to `branding/index.tsx`, the route import path `@/features/settings/branding-settings` would break. Two options:

**Option A:** Keep flat file, only update sub-nav. Lowest effort, least risk.
**Option B:** Create `branding/index.ts` barrel and update route imports. Cleaner structure.

**Decision: Option B.** Routes are updated once; structure stays clean forever.

### Route Import Updates

Routes under `apps/admin/src/routes/_authenticated/mon/settings/`:

| Route File | Current Import | New Import |
|-----------|---------------|------------|
| `tracking/index.tsx` | `@/features/settings/tracking-settings` | `@/features/settings/tracking` |
| `branding/index.tsx` | `@/features/settings/branding-settings` | `@/features/settings/branding` |
| `display/index.tsx` | `@/features/settings/display-settings` | `@/features/settings/display-catalog` |
| `pages/index.tsx` | `@/features/settings/cms-pages-settings` | `@/features/settings/cms-pages` |
| `storage/index.tsx` | `@/features/settings/storage-settings` | `@/features/settings/storage` |
| `courier/index.tsx` | `@/features/settings/courier-settings` | `@/features/settings/courier` |
| `shipping/index.tsx` | `@/features/settings/shipping-settings` | `@/features/settings/shipping` |
| `storefront/index.tsx` | `@/features/settings/storefront` | (no change) |
| `order-statuses/index.tsx` | `@/features/order-statuses` | (no change) |
| `gateways/index.tsx` | `@/features/gateways` | (no change) |
| `system/index.tsx` | `@/features/settings/system-settings` | Change to `general` |
| `general/index.tsx` | New route | `@/features/settings/general` |

### Settings Layout Updates (`features/settings/index.tsx`)

Update `monNavItems` to include grouped navigation:

```typescript
const monNavGroups = [
  {
    label: 'General',
    items: [
      { title: 'System Settings', href: '/mon/settings/general', icon: <Settings size={18} /> },
    ],
  },
  {
    label: 'Storefront',
    items: [
      { title: 'Storefront', href: '/mon/settings/storefront', icon: <Store size={18} /> },
      { title: 'Branding & Identity', href: '/mon/settings/branding', icon: <Palette size={18} /> },
      { title: 'Catalog Display', href: '/mon/settings/display', icon: <Monitor size={18} /> },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { title: 'Payment Gateways', href: '/mon/settings/gateways', icon: <CreditCard size={18} /> },
      { title: 'Courier', href: '/mon/settings/courier', icon: <Truck size={18} /> },
      { title: 'Shipping', href: '/mon/settings/shipping', icon: <Package size={18} /> },
      { title: 'Tracking & Analytics', href: '/mon/settings/tracking', icon: <Radio size={18} /> },
    ],
  },
  {
    label: 'Content',
    items: [
      { title: 'CMS Pages', href: '/mon/settings/pages', icon: <FileText size={18} /> },
      { title: 'Storage', href: '/mon/settings/storage', icon: <HardDrive size={18} /> },
    ],
  },
  {
    label: 'System',
    items: [
      { title: 'Order Statuses', href: '/mon/settings/order-statuses', icon: <RefreshCw size={18} /> },
    ],
  },
]
```

Similarly for `opNavGroups`:

```typescript
const opNavGroups = [
  {
    label: 'Profile',
    items: [
      { title: 'Profile', href: '/op/settings/personal', icon: <UserCog size={18} /> },
      { title: 'Account', href: '/op/settings/account', icon: <Wrench size={18} /> },
    ],
  },
  {
    label: 'Preferences',
    items: [
      { title: 'Appearance', href: '/op/settings/appearance', icon: <Palette size={18} /> },
      { title: 'Notifications', href: '/op/settings/notifications', icon: <Bell size={18} /> },
      { title: 'Display', href: '/op/settings/display', icon: <Monitor size={18} /> },
    ],
  },
]
```

The `SidebarNav` component needs an update to accept grouped items (groups with labels + items) instead of flat item arrays.

### File Structure After Redesign

```
features/settings/
├── index.tsx                              (updated: grouped nav)
├── components/
│   ├── sidebar-nav.tsx                    (updated: grouped navigation)
│   └── content-section.tsx                (unchanged)
│
├── storefront/                            ✅ done
├── general/                               NEW
│   ├── index.ts
│   └── general-settings.tsx
├── tracking/
│   ├── index.ts
│   └── tracking-settings.tsx
├── branding/
│   ├── index.ts
│   └── branding-settings.tsx
├── display-catalog/
│   ├── index.ts
│   └── display-settings.tsx
├── storage/
│   ├── index.ts
│   └── storage-settings.tsx
├── cms-pages/
│   ├── index.ts
│   └── cms-pages-settings.tsx
├── courier/
│   ├── index.ts
│   └── courier-settings.tsx
├── shipping/
│   ├── index.ts
│   └── shipping-settings.tsx
│
├── profile/                               (already sub-folder)
├── account/                               (already sub-folder)
├── appearance/                            (already sub-folder)
├── notifications/                         (already sub-folder)
├── display/                               (already sub-folder)
│
├── tracking-settings.tsx                  DELETE — moved to tracking/
├── branding-settings.tsx                  DELETE — moved to branding/
├── display-settings.tsx                   DELETE — moved to display-catalog/
├── storage-settings.tsx                   DELETE — moved to storage/
├── cms-pages-settings.tsx                 DELETE — moved to cms-pages/
├── cms-pages-api.ts                       DELETE — moved to cms-pages/
├── courier-settings.tsx                   DELETE — moved to courier/
├── shipping-settings.tsx                  DELETE — moved to shipping/
├── system-settings.tsx                    DELETE — replaced by general/
│
├── personal-settings.tsx                  (op panel — keep flat?)
│
├── api.ts                                 (keep)
├── hooks.ts                               (keep)
├── storage-api.ts                         (keep — used by many)
└── system-settings.tsx                    DELETED (was card grid)
```

### Route File Updates

```
routes/_authenticated/mon/settings/
├── route.tsx                              (unchanged — renders Settings layout)
├── system/index.tsx                       → DELETE, replaced by general/
├── general/index.tsx                      NEW (or rename system → general)
├── storefront/index.tsx                   (unchanged)
├── tracking/index.tsx                     (update import path)
├── branding/index.tsx                     (update import path)
├── display/index.tsx                      (update import path)
├── storage/index.tsx                      (update import path)
├── pages/index.tsx                        (update import path)
├── courier/index.tsx                      (update import path)
├── shipping/index.tsx                     (update import path)
├── order-statuses/index.tsx               (unchanged)
├── gateways/index.tsx                     (unchanged)
```

### Sidebar Data Updates

File: `apps/admin/src/components/layout/data/sidebar-data.ts`

```typescript
// Remove Tracking from Administration
{ title: 'Administration', panel: 'monitoring', items: [
  { title: 'User Management', url: '/mon/users', icon: Users },
  { title: 'Activity Logs', url: '/mon/activity-logs', icon: ListTodo },
  // Tracking removed
]},

// Update Secondary footer link
{ title: 'Secondary', items: [
  { title: 'Settings', url: '/mon/settings/general', icon: Settings, panel: 'monitoring' },
  // ...rest unchanged
]},
```

### Mobile Responsive

The settings sub-nav (`SidebarNav`) already has mobile support (dropdown select). The grouped nav needs:
- Mobile: grouped select with option group labels
- Desktop: vertical nav with group headings (small, muted)

### Test Strategy

- Update `sidebar-nav.test.tsx` if it exists (create if not)
- Test new General settings page
- Verify all routes still resolve after file moves
- TypeScript check after all changes

## What NOT To Do

- Do NOT rewrite existing page UIs (Shipping 3-tab, Gateways accordion, Display ratio UI)
- Do NOT add multi-section autosave to pages that don't need it
- Do NOT change API backends
- Do NOT touch Storefront (already done)
- Do NOT touch op/settings pages structurally (they're already in sub-folders)

## Implementation Order

1. **Navigation first:** Update `sidebar-data.ts` (move Tracking), update `settings/index.tsx` (grouped nav), update `sidebar-nav.tsx` (group support)
2. **General page:** Create `general/` sub-folder with system-level config fields
3. **Page migrations:** Move flat files to sub-folders one at a time, update route imports
4. **Cleanup:** Delete old flat files, verify all routes work
5. **QA:** TypeScript check, full test run, manual route check

## Out of Scope

- `/op/settings/personal` redesign (keep flat)
- `/op/help-center` or `/mon/help-center`
- Any non-settings functionality
- Backend API changes
