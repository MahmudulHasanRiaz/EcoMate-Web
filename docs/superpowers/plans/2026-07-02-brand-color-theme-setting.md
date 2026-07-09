# Brand Color Theme Setting Implementation Plan
> **Superseded by:** `docs/3-DOMAINS/02-products.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add color picker in admin branding settings that dynamically changes all storefront brand colors via CSS variable injection.

**Architecture:** Brand colors stored as individual `SystemSetting` keys with hardcoded defaults. Backend returns them in storefront config. Storefront layout injects them as inline CSS variables on `<html>`, overriding Tailwind v4 `@theme` variables. All 350+ existing Tailwind brand class usages automatically pick up new values without changes.

**Tech Stack:** NestJS (backend), Next.js 16 App Router (storefront), Vite + React 19 (admin), Tailwind v4, Prisma

---

### Task 1: Backend — add brand colors to storefront config API

**Files:**
- Modify: `apps/backend/src/system-settings/system-settings.controller.ts:336-343`

- [ ] **Step 1: Add brand colors to storefront config response**

Edit the `branding` section in `getStorefrontConfig()` method. Replace existing branding object with one that includes a `colors` sub-object:

```
Old code (lines 336-343):
branding: {
    storefrontFavicon: map['storefront_favicon'] || '',
    storefrontOgImage: map['storefront_og_image'] || '',
    storeLogo: map['store_logo'] || '',
    adminTitle: map['admin_title'] || '',
    adminFavicon: map['admin_favicon'] || '',
    adminTagline: map['admin_tagline'] || '',
},

New code:
branding: {
    storefrontFavicon: map['storefront_favicon'] || '',
    storefrontOgImage: map['storefront_og_image'] || '',
    storeLogo: map['store_logo'] || '',
    adminTitle: map['admin_title'] || '',
    adminFavicon: map['admin_favicon'] || '',
    adminTagline: map['admin_tagline'] || '',
    colors: {
        primary: map['brand_primary'] || '#0089CD',
        primaryDark: map['brand_primary_dark'] || '#006da3',
        accent: map['brand_accent'] || '#E77250',
        text: map['brand_text'] || '#0a0a0a',
        background: map['brand_bg'] || '#FFFFFF',
        success: map['brand_success'] || '#22C55E',
        danger: map['brand_danger'] || '#EF4444',
        border: map['brand_border'] || '#E5E7EB',
        shadowSoft: map['brand_shadow_soft'] || '0 8px 25px rgba(0,137,205,0.15)',
        shadowStrong: map['brand_shadow_strong'] || '0 15px 45px -5px rgba(0,137,205,0.6)',
    },
},
```

- [ ] **Step 2: Verify backend compiles**

Run: `cd apps/backend && npx tsc --noEmit 2>&1 | head -20`
Expected: No TypeScript errors

---

### Task 2: Storefront — update type definitions

**Files:**
- Modify: `apps/storefront/lib/api/storefront-config.ts:44-51`
- Modify: `apps/storefront/lib/api/storefront-config-server.ts:14`

- [ ] **Step 1: Add BrandColors interface and update StorefrontConfig**

In `apps/storefront/lib/api/storefront-config.ts`, add before `StorefrontConfig` interface:

```typescript
export interface BrandColors {
  primary: string;
  primaryDark: string;
  accent: string;
  text: string;
  background: string;
  success: string;
  danger: string;
  border: string;
  shadowSoft: string;
  shadowStrong: string;
}
```

Then update `branding` in `StorefrontConfig`:

```typescript
branding: {
  storefrontFavicon: string;
  storefrontOgImage: string;
  storeLogo: string;
  adminTitle: string;
  adminFavicon: string;
  adminTagline: string;
  colors: BrandColors;
};
```

- [ ] **Step 2: Update DEFAULT_CONFIG in server file**

In `apps/storefront/lib/api/storefront-config-server.ts`, update the `branding` default:

```typescript
branding: {
  storefrontFavicon: "", storefrontOgImage: "", storeLogo: "",
  adminTitle: "", adminFavicon: "", adminTagline: "",
  colors: {
    primary: '#0089CD',
    primaryDark: '#006da3',
    accent: '#E77250',
    text: '#0a0a0a',
    background: '#FFFFFF',
    success: '#22C55E',
    danger: '#EF4444',
    border: '#E5E7EB',
    shadowSoft: '0 8px 25px rgba(0,137,205,0.15)',
    shadowStrong: '0 15px 45px -5px rgba(0,137,205,0.6)',
  },
},
```

- [ ] **Step 3: Verify types compile**

Run: `cd apps/storefront && npx tsc --noEmit 2>&1 | head -20`
Expected: No TypeScript errors

---

### Task 3: Storefront — add new CSS variables to globals.css

**Files:**
- Modify: `apps/storefront/app/globals.css:3-13`

- [ ] **Step 1: Add 4 new color tokens and 2 shadow tokens to @theme inline**

```css
@theme inline {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --color-brand-blue: #0089CD;
  --color-brand-blue-dark: #006da3;
  --color-brand-coral: #E77250;
  --color-brand-dark: #0a0a0a;
  --color-brand-bg: #FFFFFF;
  --color-brand-success: #22C55E;
  --color-brand-danger: #EF4444;
  --color-brand-border: #E5E7EB;
  --radius-xl: 1rem;
  --radius-2xl: 1.5rem;
  --radius-3xl: 2rem;
}

@utility shadow-brand-soft {
  box-shadow: var(--brand-shadow-soft, 0 8px 25px rgba(0, 137, 205, 0.15));
}

@utility shadow-brand-strong {
  box-shadow: var(--brand-shadow-strong, 0 15px 45px -5px rgba(0, 137, 205, 0.6));
}
```

---

### Task 4: Storefront — inject color vars in layout + fix hardcoded refs

**Files:**
- Modify: `apps/storefront/app/layout.tsx`

- [ ] **Step 1: Import CSSProperties, build color vars object, apply to `<html>`**

Replace the `<html>` tag in layout.tsx. The current code renders:
```tsx
<html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
```

Change to:
```tsx
<html
  lang="en"
  className={`${geistSans.variable} ${geistMono.variable}`}
  style={initialConfig?.branding?.colors ? {
    '--color-brand-blue': initialConfig.branding.colors.primary,
    '--color-brand-blue-dark': initialConfig.branding.colors.primaryDark,
    '--color-brand-coral': initialConfig.branding.colors.accent,
    '--color-brand-dark': initialConfig.branding.colors.text,
    '--color-brand-bg': initialConfig.branding.colors.background,
    '--color-brand-success': initialConfig.branding.colors.success,
    '--color-brand-danger': initialConfig.branding.colors.danger,
    '--color-brand-border': initialConfig.branding.colors.border,
    '--brand-shadow-soft': initialConfig.branding.colors.shadowSoft,
    '--brand-shadow-strong': initialConfig.branding.colors.shadowStrong,
  } as React.CSSProperties : undefined}
>
```

- [ ] **Step 2: Fix meta theme-color**

Change line 121:
```tsx
<meta name="theme-color" content="#0089CD" />
```
to:
```tsx
<meta name="theme-color" content={initialConfig?.branding?.colors?.primary || '#0089CD'} />
```

- [ ] **Step 3: Fix maintenance mode hardcoded colors**

Change line 157 (the maintenance mode icon container):
```tsx
<div className="w-16 h-16 bg-[#0089CD]/10 text-[#0089CD] rounded-2xl flex items-center justify-center mx-auto mb-6 animate-pulse">
```
to:
```tsx
<div className="w-16 h-16 bg-brand-blue/10 text-brand-blue rounded-2xl flex items-center justify-center mx-auto mb-6 animate-pulse">
```

- [ ] **Step 4: Verify layout compiles**

Run: `cd apps/storefront && npx tsc --noEmit 2>&1 | head -20`
Expected: No TypeScript errors

---

### Task 5: Storefront — fix shadow and color references in component files

**Files:**
- Modify: `apps/storefront/components/CategoryList.tsx:98`
- Modify: `apps/storefront/components/FlyCartLayer.tsx:94`
- Modify: `apps/storefront/app/(main)/privacy-policy/page.tsx:11`

- [ ] **Step 1: Fix CategoryList shadow**

Change line 98 in `CategoryList.tsx`:
```tsx
className="relative w-[85px] h-[85px] md:w-[120px] md:h-[120px] bg-white rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-gray-100 flex items-center justify-center overflow-hidden group-hover:shadow-[0_8px_25px_rgba(0,137,205,0.15)] group-hover:border-brand-blue/30 transition-all duration-300 transform group-hover:-translate-y-1"
```
to:
```tsx
className="relative w-[85px] h-[85px] md:w-[120px] md:h-[120px] bg-white rounded-full shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-gray-100 flex items-center justify-center overflow-hidden group-hover:shadow-brand-soft group-hover:border-brand-blue/30 transition-all duration-300 transform group-hover:-translate-y-1"
```

- [ ] **Step 2: Fix FlyCartLayer shadow**

Change line 94 in `FlyCartLayer.tsx`:
```tsx
className="w-24 h-24 md:w-32 md:h-32 bg-white rounded-full p-2 border-[4px] border-brand-blue flex items-center justify-center shadow-[0_15px_45px_-5px_rgba(0,137,205,0.6)] overflow-hidden"
```
to:
```tsx
className="w-24 h-24 md:w-32 md:h-32 bg-white rounded-full p-2 border-[4px] border-brand-blue flex items-center justify-center shadow-brand-strong overflow-hidden"
```

- [ ] **Step 3: Fix privacy policy hardcoded text color**

Change line 11 in `privacy-policy/page.tsx`:
```tsx
<div className="bg-[#0a0a0a] min-h-screen text-white pt-24 pb-32">
```
to:
```tsx
<div className="bg-brand-dark min-h-screen text-white pt-24 pb-32">
```

---

### Task 6: Admin — add color picker UI to branding page

**Files:**
- Modify: `apps/admin/src/features/settings/branding/branding-settings.tsx`

- [ ] **Step 1: Add color state variables and color picker card**

Add 10 new state variables alongside existing states:
```typescript
const [brandColors, setBrandColors] = useState<Record<string, string>>({
  brand_primary: settings?.brand_primary || '#0089CD',
  brand_primary_dark: settings?.brand_primary_dark || '#006da3',
  brand_accent: settings?.brand_accent || '#E77250',
  brand_text: settings?.brand_text || '#0a0a0a',
  brand_bg: settings?.brand_bg || '#FFFFFF',
  brand_success: settings?.brand_success || '#22C55E',
  brand_danger: settings?.brand_danger || '#EF4444',
  brand_border: settings?.brand_border || '#E5E7EB',
})
```

Update the `useEffect` to initialize colors from settings.

- [ ] **Step 2: Add color picker card JSX before the save bar**

Add a new `<Card>` for "Brand Colors" between the Storefront Identity card and the save bar:

```tsx
<Card>
  <CardHeader>
    <div className='flex items-center gap-2'>
      <Palette className='h-5 w-5 text-primary' />
      <div>
        <CardTitle>Brand Colors</CardTitle>
        <CardDescription>Customize the storefront color scheme. Changes apply after refreshing the storefront pages.</CardDescription>
      </div>
    </div>
  </CardHeader>
  <CardContent>
    <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'>
      {[
        { key: 'brand_primary', label: 'Primary', default: '#0089CD' },
        { key: 'brand_primary_dark', label: 'Primary Dark', default: '#006da3' },
        { key: 'brand_accent', label: 'Accent', default: '#E77250' },
        { key: 'brand_text', label: 'Text', default: '#0a0a0a' },
        { key: 'brand_bg', label: 'Background', default: '#FFFFFF' },
        { key: 'brand_success', label: 'Success', default: '#22C55E' },
        { key: 'brand_danger', label: 'Danger', default: '#EF4444' },
        { key: 'brand_border', label: 'Border', default: '#E5E7EB' },
      ].map(c => (
        <div key={c.key} className='space-y-2'>
          <Label>{c.label}</Label>
          <div className='flex items-center gap-3'>
            <div className='relative'>
              <input
                type='color'
                value={brandColors[c.key]}
                onChange={e => setBrandColors(prev => ({ ...prev, [c.key]: e.target.value }))}
                className='h-10 w-14 rounded-md border border-input bg-transparent cursor-pointer p-0.5'
              />
            </div>
            <Input
              value={brandColors[c.key]}
              onChange={e => setBrandColors(prev => ({ ...prev, [c.key]: e.target.value }))}
              className='font-mono text-xs flex-1'
              placeholder={c.default}
            />
          </div>
        </div>
      ))}
    </div>
  </CardContent>
</Card>
```

- [ ] **Step 3: Update handleSave to include brand colors**

In `handleSave`, add the color keys to the updates array:
```typescript
Object.entries(brandColors).map(([key, value]) => ({ key, value })),
```

- [ ] **Step 4: Add Palette import**

```typescript
import { ..., Palette } from 'lucide-react'
```

---

## Self-Review

**Spec coverage:**
- Color settings defined → Task 1 (backend keys), Task 6 (admin UI)
- Storefront dynamic injection → Task 4 (layout inline style)
- Storefront CSS variables → Task 3 (globals.css new vars), Task 5 (shadow utilities)
- Admin panel unaffected → Not modifying admin theme at all ✓
- Defaults seeded as fallbacks → Backend falls back to hardcoded defaults ✓
- 5 hardcoded refs → Task 4 (3 refs in layout) + Task 5 (3 refs in components)

**Placeholder scan:** All code is complete. No TBD/TODO.

**Type consistency:** BrandColors interface in Task 2 matches backend response in Task 1 and is used in Task 4.

**All spec requirements covered:** ✓
