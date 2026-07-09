# Storefront Settings Redesign — Design Spec
> **Superseded by:** `docs/2-ARCHITECTURE/ARCHITECTURE.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

**Date:** 2026-06-07
**Status:** Approved
**Scope:** Redesign `/mon/settings/storefront` admin page from a 14-tab monolithic form into a structured two-pane layout with 5 categories, per-section autosave, and Cmd/Ctrl+K command palette. 2026-grade minimal aesthetic.

## Motivation

The current `storefront-settings.tsx` is an 841-line monolithic React component that packs 50+ settings fields behind 14 tabs in a cramped `grid-cols-2 md:grid-cols-5 lg:grid-cols-10` layout. Concrete problems:

1. **Overcrowded tab bar** — 14 tabs in a 10-column grid make individual tabs unreadable on medium screens. Some tabs are placeholders ("Moved to /shipping").
2. **All-or-nothing save** — a single "Save Changes" button at the bottom forces admins to either commit every change or none. High risk of accidental overwrites.
3. **No structural organization** — 14 unrelated sections (Store, Hero, Social, SEO, Footer, Shipping, Checkout, Districts, Nav, FAQ, Hours, Brands, Order, Misc) live in one flat list. No grouping by intent.
4. **No discoverability** — adding new settings in the future means cramming another tab, making the problem worse.
5. **No search/jump** — finding a specific field among 50+ requires manual scanning.
6. **Two placeholder tabs** — Shipping and Districts tabs are deprecated, displaying only "Moved to /shipping" banners — poor UX.
7. **Single 841-line file** — hard to maintain, hard to test, hard to extend.

This redesign addresses all of the above while remaining fully backwards-compatible with the existing backend API and 36 system-setting keys.

## Goals

1. Group the 14 sections into 5 logical categories, reducing cognitive load.
2. Adopt a two-pane layout (persistent sidebar + scrollable content) — a 2026-standard pattern for dense admin UIs (VS Code, Linear, Stripe Dashboard).
3. Enable per-section autosave with explicit "Save Section" + dirty indicator so admins save smaller, intentional changes.
4. Provide a Cmd/Ctrl+K command palette for fast navigation across all fields.
5. Remove deprecated placeholder tabs; migrate their content to semantically correct sections.
6. Achieve a Linear / Vercel ultra-minimal visual style: thin borders, no shadows, typography-driven hierarchy, generous whitespace.
7. Keep all 40 system-setting keys and the `systemSettingsApi` interface unchanged — no backend changes.
8. Make the architecture extensible: adding new settings means adding a section component and a registry entry, not editing a 1000-line file.

## Non-goals

- No real backend changes. All keys/values are preserved.
- No new pages/routes. `/mon/settings/storefront` URL stays the same.
- No live preview pane in this iteration (could be added later as a sub-feature).
- No multi-user concurrency conflict resolution beyond the current last-write-wins.
- No settings import/export, no bulk edit, no undo history.
- No changes to the storefront (customer-facing) app.

## Architecture

### File structure

```
apps/admin/src/features/settings/storefront/
├── storefront-settings.tsx          # Main two-pane container (route entry)
├── index.ts                         # Re-export for route imports
├── lib/
│   ├── categories.ts                # Category + section registry (single source of truth)
│   ├── field-schemas.ts             # Per-field metadata: label, type, hint, group
│   └── unsaved-guard.tsx            # beforeunload + TanStack Router blocker
├── hooks/
│   └── use-storefront-settings.ts   # Centralized state, dirty tracking, save
├── components/
│   ├── category-sidebar.tsx         # Sticky left rail
│   ├── command-palette.tsx          # Cmd/Ctrl+K
│   ├── section-shell.tsx            # Reusable section card
│   ├── dirty-dot.tsx                # Animated dirty indicator
│   ├── save-bar.tsx                 # Per-section save footer
│   └── sections/
│       ├── identity-store-section.tsx
│       ├── identity-brands-section.tsx
│       ├── visuals-hero-section.tsx
│       ├── visuals-footer-section.tsx
│       ├── content-navigation-section.tsx
│       ├── content-faq-section.tsx
│       ├── content-hours-section.tsx
│       ├── content-about-section.tsx
│       ├── discovery-seo-section.tsx
│       ├── discovery-social-section.tsx
│       ├── commerce-checkout-section.tsx
│       └── commerce-order-section.tsx
```

The old `apps/admin/src/features/settings/storefront-settings.tsx` is removed; the route `apps/admin/src/routes/_authenticated/mon/settings/storefront/index.tsx` is updated to import from the new path.

### Data flow

```
[User types in Input]
        ↓
useStorefrontSettings().setValue(key, value)  → updates local values map (no API call)
        ↓
[isDirty(key) returns true]  [isSectionDirty(sectionId) returns true]
[DirtyDot renders]           [SectionShell Save bar activates]
        ↓ (user clicks "Save Section")
useStorefrontSettings().saveSection(sectionId)
        ↓
Diff: changedKeys = keys in section where values[k] !== originalValues[k]
        ↓
Promise.all(changedKeys.map(k => setMutation.mutate({ key: k, value: values[k] })))
        ↓
On success: originalValues = { ...values } snapshot
            queryClient.invalidateQueries(['system-settings'])
            toast.success(`Section saved`)
            DirtyDot: pulse → fade
            Save bar: show "Saved 2s ago"
On error:  toast.error(...)
           Save bar: dirty stays, retry button visible
        ↓
Storefront re-fetches /system-settings on next page load (existing behavior)
```

### State management — `useStorefrontSettings` hook

```ts
interface UseStorefrontSettingsReturn {
  // Data
  values: Record<string, string>                 // current (editable) values
  originalValues: Record<string, string>         // last-saved snapshot
  isLoading: boolean

  // Dirty state
  isDirty: (key: string) => boolean
  isSectionDirty: (sectionId: SectionId) => boolean
  dirtyKeysInSection: (sectionId: SectionId) => string[]

  // Mutations (local only)
  setValue: (key: string, value: string) => void
  setMany: (updates: Record<string, string>) => void

  // Save / reset
  saveSection: (sectionId: SectionId) => Promise<void>
  resetSection: (sectionId: SectionId) => void
  isSavingSection: (sectionId: SectionId) => boolean
  lastSavedAt: (sectionId: SectionId) => Date | null

  // Section registry
  sections: SectionMeta[]
  categories: CategoryMeta[]
}
```

Implementation details:
- Wraps existing `useQuery({ queryKey: ['system-settings'], queryFn: () => systemSettingsApi.getAll().then(r => r.data) })`.
- On `data` arrival, populates both `values` and `originalValues` from the same map (use `useRef` to compare in effects to avoid feedback loops).
- `setValue` mutates only `values` — never triggers API calls.
- `saveSection` computes diff vs `originalValues`, fires `Promise.all` of `systemSettingsApi.set` calls, on success replaces `originalValues` with a fresh copy of the relevant subset.
- Loading state shows a single `<Loader2 />` until first fetch resolves.
- Hook is a singleton per page-mount (lives in the main `StorefrontSettings` component, passed via context or props to children).

### Unsaved-changes guard

- Browser: `beforeunload` listener installed in `useEffect`, returns `event.preventDefault()` when any section is dirty.
- Router: TanStack Router's `useBlocker` hook used in `StorefrontSettings` to intercept in-app navigation while dirty sections exist. Displays a `<ConfirmDialog>` with options: "Save all dirty sections", "Discard changes", "Cancel".
- Guard is removed on full save (no dirty sections remain) or on `resetSection` for all dirty sections.

## Categories and sections

### Category registry — `lib/categories.ts`

```ts
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
```

### Section registry — `lib/categories.ts` (continued)

```ts
export const SECTIONS: Record<SectionId, SectionMeta> = {
  'identity-store': {
    id: 'identity-store',
    categoryId: 'identity',
    title: 'Store Identity',
    description: 'Basic information that appears across your storefront.',
    icon: 'Store',
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
    icon: 'Palette',
    fields: ['store_systems'],
  },
  'visuals-hero': {
    id: 'visuals-hero',
    categoryId: 'visuals',
    title: 'Hero Banner',
    description: 'Slider images and secondary banner on the homepage.',
    icon: 'ImageIcon',
    fields: ['hero_slides', 'hero_secondary_banner', 'hero_secondary_banner_alt'],
  },
  'visuals-footer': {
    id: 'visuals-footer',
    categoryId: 'visuals',
    title: 'Footer Content',
    description: 'Text and copyright shown in the storefront footer.',
    icon: 'Layout',
    fields: ['footer_description', 'footer_copyright'],
  },
  'content-navigation': {
    id: 'content-navigation',
    categoryId: 'content',
    title: 'Navigation Menu',
    description: 'Header navigation items shown in the top bar.',
    icon: 'List',
    fields: ['navigation_items'],
  },
  'content-faq': {
    id: 'content-faq',
    categoryId: 'content',
    title: 'FAQ Items',
    description: 'Frequently asked questions on the FAQ page.',
    icon: 'HelpCircle',
    fields: ['faq_items'],
  },
  'content-hours': {
    id: 'content-hours',
    categoryId: 'content',
    title: 'Operating Hours',
    description: 'Store hours displayed on support and stores pages.',
    icon: 'Clock',
    fields: ['hours_label', 'hours_details'],
  },
  'content-about': {
    id: 'content-about',
    categoryId: 'content',
    title: 'About & Company',
    description: 'About-us text, payment and shipping policy text, company info.',
    icon: 'Info',
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
    description: 'Default meta tags for search engines.',
    icon: 'Search',
    fields: ['seo_title', 'seo_description', 'seo_keywords'],
  },
  'discovery-social': {
    id: 'discovery-social',
    categoryId: 'discovery',
    title: 'Social Links',
    description: 'Social media URLs and messaging usernames.',
    icon: 'Share2',
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
    icon: 'ShoppingCart',
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
    description: 'WhatsApp and phone used for order-related customer contact.',
    icon: 'Phone',
    fields: ['order_whatsapp', 'order_call_number'],
  },
}
```

Total: 12 sections across 5 categories. All 40 system-setting keys are assigned to exactly one section. The previously orphaned `shipping_info` key is moved to `content-about` (it is a text field for the shipping policy, not delivery configuration — the latter lives at `/mon/settings/shipping`).

### Removed items

- **Tab "Shipping"** (placeholder linking to `/mon/settings/shipping`) — removed.
- **Tab "Districts"** (placeholder linking to `/mon/settings/shipping`) — removed.
- The `shipping_info` text field migrates into `content-about` and is labeled "Shipping Policy Text" with a help line: "This text appears on the shipping policy page. Per-district delivery charges are configured in Shipping Settings."

## UI layout

### Desktop (≥ 1024px)

```
┌────────────────────────────────────────────────────────────────────────┐
│ Header (search, theme, config-drawer, profile)                          │
├────────────────────────────────────────────────────────────────────────┤
│ H1: "Storefront Settings"                                               │
│ Subtitle: "Configure how your storefront looks and behaves."            │
│ Meta line: "12 sections · 5 categories · last saved {relative-time}"    │
├──────────────────────────────────┬─────────────────────────────────────┤
│ STICKY SIDEBAR  (w-64, 1/5)      │ SCROLLABLE CONTENT  (flex-1)        │
│                                  │                                     │
│ ┌─ ⌘K  Search settings ─────┐   │  ┌───────────────────────────────┐  │
│ └────────────────────────────┘   │  │ Store Identity           •    │  │
│                                  │  │ Basic information that...     │  │
│ IDENTITY                         │  │                                │  │
│   • Store Identity          •    │  │ [Fields...]                    │  │
│   • Brands & Systems             │  │                                │  │
│                                  │  │ ── 2 unsaved · 2m ago ────────│  │
│ VISUALS                          │  │ [Discard]   [Save Section]    │  │
│   • Hero Banner                  │  └───────────────────────────────┘  │
│   • Footer                       │                                     │
│                                  │  ┌───────────────────────────────┐  │
│ CONTENT                          │  │ Brands & Systems               │  │
│   • Navigation                   │  │ ...                            │  │
│   • FAQ                          │  └───────────────────────────────┘  │
│   • Hours                        │                                     │
│   • About & Company              │  ┌───────────────────────────────┐  │
│                                  │  │ Hero Banner              •    │  │
│ DISCOVERY                        │  │ ...                            │  │
│   • SEO Defaults                 │  └───────────────────────────────┘  │
│   • Social Links                 │                                     │
│                                  │  ...                                 │
│ COMMERCE                         │                                     │
│   • Checkout Configuration       │                                     │
│   • Order Contact                │                                     │
│                                  │                                     │
│ ─────────                        │                                     │
│ ← Back to Settings               │                                     │
└──────────────────────────────────┴─────────────────────────────────────┘
```

- Sidebar is `position: sticky; top: 0` within the content column of the parent settings layout (`flex lg:flex-row lg:space-x-12`).
- Active sidebar item: `bg-accent/50 text-foreground font-medium` with a 2px left-border accent.
- Sidebar items show: `Icon + Title` plus a small `DirtyDot` when that section is dirty.
- Content column scrolls independently; each section uses `scroll-mt-4` (1rem scroll-margin-top) so Cmd+K jump lands the title just below the top with breathing room.
- Section spacing: `space-y-8` between cards; cards are `p-6` with `border border-border/60 rounded-xl bg-card`.

### Tablet (≥ 768px, < 1024px)

- Sidebar becomes a horizontal scrollable chip row pinned at the top of the content area.
- Chip: `border border-border/60 rounded-full px-3 py-1.5 text-sm`, active state `bg-foreground text-background`.
- Content stacks below the chip row; section cards full-width.

### Mobile (< 768px)

- Same horizontal chip row as tablet.
- Section cards full-width, single column field layout.
- Save bar inside each section moves to a sticky bottom action bar: `[Discard] [Save Section]` full-width buttons, `h-12`.
- Cmd/K available via dedicated floating button (bottom-right) for devices without keyboard.

## Visual style (Linear / Vercel ultra-minimal)

| Element | Style |
|---------|-------|
| Page background | `bg-background` |
| Card | `border border-border/60 rounded-xl bg-card` (1px border, no shadow) |
| Section title | `text-base font-medium text-foreground` |
| Section description | `text-sm text-muted-foreground` |
| Field label | `text-xs font-medium text-foreground/80` |
| Field hint | `text-xs text-muted-foreground` |
| Input | `h-9 rounded-md border-input text-sm` |
| Textarea | `min-h-20 rounded-md border-input text-sm` |
| Sidebar item | `text-sm text-foreground/80 hover:text-foreground` |
| Active sidebar item | `bg-accent/50 text-foreground font-medium border-l-2 border-primary` |
| Save button | `bg-primary text-primary-foreground h-9 px-4 text-sm font-medium` |
| Discard button | `text-sm text-muted-foreground hover:text-foreground` |
| Save bar | `border-t border-border/40 pt-4 mt-6` |
| Hover state | `hover:bg-muted/50` (no shadow transitions) |
| Focus ring | `focus-visible:ring-1 focus-visible:ring-ring/40` (subtle) |
| Transition | `transition-colors duration-150` (no scale, no slide) |
| Modal/dialog | `shadow-2xl` (only exception to "no shadow" rule) |
| Accent color | Single: `primary` — used for active state, save button, dirty dot |
| Font | Existing system stack (no new webfonts) |

Dark mode follows automatically via the existing theme system; no special-case colors.

## Components

### `SectionShell`

Reusable wrapper that all 12 section components use.

Props:
```ts
interface SectionShellProps {
  id: SectionId                  // for scroll-target and Cmd+K
  title: string
  description: string
  isDirty: boolean
  isSaving: boolean
  lastSavedAt: Date | null
  onSave: () => void
  onReset: () => void
  children: React.ReactNode
}
```

Layout:
```
┌─ border border-border/60 rounded-xl bg-card p-6 ──────────────────┐
│ <div data-section-id={id}>                                        │
│  Header: title + (DirtyDot if isDirty) + lastSavedAt tooltip     │
│  <p class="text-sm text-muted-foreground">{description}</p>       │
│  ── border-t mt-4 mb-6 ──                                         │
│  {children}                                                       │
│  {isDirty && <SaveBar                                            │
│     isSaving={isSaving}                                          │
│     onSave={onSave} onReset={onReset}                            │
│     lastSavedAt={lastSavedAt} />                                 │
│  }                                                                │
│ </div>                                                            │
└───────────────────────────────────────────────────────────────────┘
```

### `DirtyDot`

- 6px circle, `bg-primary`.
- `animate-pulse` while save is in flight.
- `transition-opacity duration-300` to fade out after save.

### `SaveBar`

- Thin top border, small meta line ("2 unsaved changes · last saved 2 min ago").
- Right-aligned `[Discard]` (ghost button) and `[Save Section]` (primary button).
- When `isSaving`: button shows `<Loader2 className="animate-spin h-3.5 w-3.5 mr-1.5" />` and is `disabled`.
- On success: bar collapses with smooth opacity transition over 600ms.
- Persists if user keeps editing after a save (re-appears on next dirty state).

### `CategorySidebar`

Props: `categories: CategoryMeta[]`, `sections: Record<SectionId, SectionMeta>`, `activeSectionId: SectionId`, `dirtySectionIds: Set<SectionId>`, `onSectionClick: (id) => void`.

Behavior:
- Renders the search input (Cmd+K trigger) at top.
- Renders category groups, each with label + sub-items.
- Sub-item click → `scrollIntoView({ behavior: 'smooth', block: 'start' })` on `data-section-id={id}` element.
- Active section is determined by `IntersectionObserver` watching the section elements (thresholds at 0.1 and 0.6).
- Keyboard: ↑↓ navigates, Enter scrolls to active.

### `CommandPalette`

- Triggered globally by `Cmd+K` (macOS) or `Ctrl+K` (others) — registered once at `StorefrontSettings` level.
- Uses the existing `cmdk`-based `command` UI primitive already in `apps/admin/src/components/ui/command.tsx`.
- Search index built from `SECTIONS` registry: section title, section description, every field label, every field key.
- Results grouped by category, max 8 visible per group.
- Selecting a result:
  - If section: scrolls to `data-section-id={sectionId}` and closes palette.
  - If field: scrolls to section and focuses input via `document.querySelector(\`[data-field-key="\${key}"]\`)?.focus()`.
- Palette state: closed by default; opened via keyboard shortcut or by clicking the search input in the sidebar.

## Field-level metadata (`lib/field-schemas.ts`)

Each field has metadata to enable:
- Search index
- Focus targeting (`data-field-key`)
- Inline hints
- Validation rules (lightweight)

```ts
export const FIELD_SCHEMAS: Record<string, FieldSchema> = {
  store_name:       { label: 'Store Name',       type: 'text',     hint: '...' },
  store_tagline:    { label: 'Tagline',          type: 'text' },
  store_email:      { label: 'Email',            type: 'email' },
  store_phone:      { label: 'Phone',            type: 'tel' },
  store_address:    { label: 'Address',          type: 'textarea', rows: 2 },
  currency:         { label: 'Currency Code',    type: 'text',     placeholder: 'BDT' },
  currency_symbol:  { label: 'Currency Symbol',  type: 'text',     placeholder: '৳' },
  store_systems:    { label: 'Brands',           type: 'array-store-systems' },
  hero_slides:      { label: 'Hero Slides',      type: 'array-hero-slides' },
  hero_secondary_banner:        { label: 'Secondary Banner',   type: 'image' },
  hero_secondary_banner_alt:    { label: 'Alt Text',           type: 'text' },
  footer_description:           { label: 'Footer Description', type: 'textarea', rows: 4 },
  footer_copyright:             { label: 'Copyright',          type: 'text' },
  navigation_items:             { label: 'Nav Items',          type: 'array-nav' },
  faq_items:                    { label: 'FAQ Items',          type: 'array-faq' },
  hours_label:                  { label: 'Hours Summary',      type: 'text' },
  hours_details:                { label: 'Daily Schedule',     type: 'array-hours' },
  about_us_text:                { label: 'About Us',           type: 'textarea', rows: 4 },
  payment_info:                 { label: 'Payment Info',       type: 'textarea', rows: 3 },
  shipping_info:                { label: 'Shipping Policy Text', type: 'textarea', rows: 3,
                                  hint: 'This text appears on the shipping policy page. ' +
                                        'Per-district delivery charges are configured in Shipping Settings.' },
  company_name:                 { label: 'Company Name',       type: 'text' },
  company_registration:         { label: 'Registration No.',   type: 'text' },
  company_certifications:       { label: 'Certifications',     type: 'text' },
  company_team_size:            { label: 'Team Size',          type: 'text' },
  company_ceo_name:             { label: 'CEO / Founder',      type: 'text' },
  seo_title:                    { label: 'Default Title',      type: 'text' },
  seo_description:              { label: 'Meta Description',   type: 'textarea', rows: 3 },
  seo_keywords:                 { label: 'Keywords',           type: 'text',
                                  hint: 'Comma-separated' },
  social_facebook:              { label: 'Facebook URL',       type: 'url' },
  social_instagram:             { label: 'Instagram URL',      type: 'url' },
  social_youtube:               { label: 'YouTube URL',        type: 'url' },
  social_whatsapp:              { label: 'WhatsApp Number',    type: 'tel' },
  social_messenger_username:    { label: 'Messenger Username', type: 'text' },
  checkout_district_enabled:    { label: 'District Field',     type: 'switch',
                                  hint: 'Show district dropdown in checkout' },
  checkout_thana_enabled:       { label: 'Thana Field',        type: 'switch' },
  checkout_district_required:   { label: 'District Required',  type: 'switch' },
  checkout_thana_required:      { label: 'Thana Required',     type: 'switch' },
  checkout_payment_modes:       { label: 'Payment Modes',      type: 'payment-modes' },
  order_whatsapp:               { label: 'Order WhatsApp',     type: 'tel' },
  order_call_number:            { label: 'Order Call Number',  type: 'tel' },
}
```

Custom types (`array-store-systems`, `array-hero-slides`, `array-nav`, `array-faq`, `array-hours`, `payment-modes`) are rendered by specialized sub-components inside their owning section. Plain types (`text`, `email`, `tel`, `url`, `textarea`, `image`, `switch`) render with the shared `<Field>` component.

### `Field` (shared renderer)

```ts
interface FieldProps {
  fieldKey: string            // for data-field-key
  label: string
  hint?: string
  type: 'text' | 'email' | 'tel' | 'url' | 'textarea' | 'image' | 'switch'
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  disabled?: boolean
}
```

Renders the appropriate shadcn primitive bound to `useStorefrontSettings().setValue(fieldKey, value)`. Each input renders `data-field-key={fieldKey}` so the command palette can focus it.

## Backend compatibility

- **No backend changes.** All 40 system-setting keys remain identical.
- API: `systemSettingsApi.set(key, value)` (in `apps/admin/src/features/settings/storage-api.ts`) — used as-is.
- `saveSection` issues a `Promise.all` of `set` calls — one HTTP request per changed key, matching the current behavior of the single "Save Changes" button.
- `react-query` invalidation of `['system-settings']` is preserved.
- Storefront reads from the same backend endpoint; no consumer changes.

## Testing strategy

### Component tests (Vitest + React Testing Library)

- `useStorefrontSettings`
  - Initializes `values` and `originalValues` from query data.
  - `setValue` updates only `values`, leaves `originalValues` untouched.
  - `isDirty` returns `true` for keys where `values[k] !== originalValues[k]`.
  - `isSectionDirty` returns `true` when any field in the section is dirty.
  - `saveSection` calls `set` for each changed key; on success, updates `originalValues` and clears dirty.
  - `saveSection` on error keeps dirty state and surfaces the error.
  - `resetSection` reverts `values` to `originalValues` for the section's keys.

- `SectionShell`
  - Renders title and description.
  - Hides save bar when not dirty.
  - Shows save bar with correct counts when dirty.
  - Calls `onSave` and `onReset` when buttons clicked.
  - Disables save button when `isSaving` is true.

- `CategorySidebar`
  - Highlights active section.
  - Renders dirty dot for dirty sections.
  - Calls `onSectionClick` with correct id on click.

- `CommandPalette`
  - Opens on Cmd/Ctrl+K.
  - Searches across section titles, descriptions, and field labels.
  - Groups results by category.
  - Keyboard navigation works (↑↓, Enter, Esc).
  - Selecting a field focuses the corresponding input.

- `unsaved-guard`
  - Calls `event.preventDefault()` on `beforeunload` when dirty.
  - Removes listener on unmount.
  - Renders `ConfirmDialog` when `useBlocker` is active and user navigates.

### E2E tests (Playwright)

- Open `/mon/settings/storefront` → all 5 categories render in sidebar.
- Click each section in sidebar → page scrolls to that section.
- Type into a field → dirty dot appears next to section title in sidebar.
- Click "Save Section" → toast "Section saved" → dirty dot fades.
- Type in multiple sections, navigate to a different route → "Unsaved changes" dialog appears.
- Press Cmd+K → palette opens, type "social" → results filter, press Enter → scrolls to Social Links section.
- Mobile viewport (375×667) → sidebar is replaced by chip row, section cards stack, save bar is sticky at bottom.
- Dark mode toggle → all components re-skin correctly (no hard-coded colors).

### Backwards-compatibility regression

- Open every existing system-setting in DB, change it via the new UI, refresh, verify it persisted.
- Verify all 36 keys still appear and are editable.
- Verify the deprecated "Shipping" and "Districts" placeholder tabs are gone (404 or no link).

## Out of scope

- Live preview pane for hero, footer, SEO, FAQ.
- Settings import/export (JSON download/upload).
- Bulk operations (apply to multiple fields at once).
- Undo/redo history beyond the local `resetSection` action.
- Multi-user concurrent edit conflict resolution.
- Changes to the customer-facing storefront.
- Changes to the `system-settings` backend schema.
- Mobile app (the admin is web-only).

## Implementation order

1. `lib/categories.ts` and `lib/field-schemas.ts` — registry files (no UI yet, but they drive everything).
2. `hooks/use-storefront-settings.ts` — state hook with mocked API for unit tests.
3. `components/dirty-dot.tsx` and `components/save-bar.tsx` — primitives.
4. `components/section-shell.tsx` — wrapper.
5. `components/category-sidebar.tsx` — sidebar with mock data.
6. `components/command-palette.tsx` — palette wired to registry.
7. `components/sections/*.tsx` — 12 section components, one at a time, ported from old `storefront-settings.tsx`.
8. `lib/unsaved-guard.tsx` — beforeunload + router blocker.
9. `storefront-settings.tsx` (new) — main two-pane container composing everything.
10. Update route import in `apps/admin/src/routes/_authenticated/mon/settings/storefront/index.tsx`.
11. Delete the old `apps/admin/src/features/settings/storefront-settings.tsx` file.
12. Mobile responsive pass (chip row, sticky save bar).
13. Dark mode visual QA.
14. Component + E2E tests.
15. Backwards-compatibility sweep — verify all 40 keys still work.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Unsaved-changes guard blocks legitimate navigation (e.g., accidental click on a nav link) | `ConfirmDialog` offers 3 options: Save all / Discard / Cancel. Save-all is a one-click action. |
| Per-section save UX surprises users who expect "one big save" | Visible meta line ("2 unsaved changes") and the new save bar are prominent; documented in the help text on the page subtitle ("Changes are saved per section"). |
| `IntersectionObserver` flicker on rapid scroll in long content area | Threshold: 0.4 (single threshold), with `rootMargin: '-10% 0px -60% 0px'` to bias toward upper portion of viewport. |
| Cmd+K conflict with browser shortcuts | Tested in Chrome, Firefox, Safari; macOS Safari uses Cmd+K for "Insert Link" in some inputs, but only when an input is focused. We listen on `keydown` capture phase and `e.preventDefault()` only when no input is focused. |
| Mobile chip row gets crowded with 12 sections | Horizontal scroll with snap-x; chips shrink to icon-only below 480px (icons pulled from registry `icon` field). |
| Field focus after Cmd+K jump fails if element not yet rendered | Each section mounts eagerly (no lazy loading), so all inputs are in the DOM at all times. Focus uses `setTimeout(..., 50)` to allow scroll. |
| `Promise.all` save partially fails (some keys saved, others not) | On error, the success callback is not invoked; `originalValues` is not updated. Dirty state remains. Toast: "Some settings failed to save. Please retry." UI shows retry button. |
| Test flakiness from `IntersectionObserver` mocks | Tests for sidebar use a fake observer that returns a deterministic active section per test scenario. |

## Acceptance criteria

1. The page renders 5 category groups in the sidebar with 12 total sections.
2. No "Moved" placeholder tabs exist. All deprecated links to `/mon/settings/shipping` are removed from this page.
3. Editing a field shows a dirty dot in the sidebar next to that section within 200ms.
4. Clicking "Save Section" issues HTTP `POST /system-settings/{key}` for each changed key in that section, shows a success toast, and clears the dirty dot.
5. Pressing Cmd/Ctrl+K opens the command palette; typing a section or field name filters results; Enter scrolls to and optionally focuses the target.
6. The page is fully usable at 375px width with no horizontal scroll on the layout.
7. Dark mode renders correctly without any hard-coded light-mode colors.
8. Navigating away with unsaved changes shows a confirmation dialog.
9. All 40 system-setting keys remain settable; no data loss or key rename occurs.
10. Component test coverage for new components and the state hook is ≥ 80% line coverage.
11. E2E test suite passes for: navigation, save flow, dirty guard, command palette, mobile layout.
