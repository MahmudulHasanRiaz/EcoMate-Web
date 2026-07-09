# Catalog Image Ratio Control — Design Spec
> **Superseded by:** `docs/3-DOMAINS/02-products.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

**Date:** 2026-06-04
**Status:** Approved
**Scope:** Admin-controlled image aspect ratio for storefront catalog grids

## Goal

Allow admin to control the image aspect ratio used in product/combo/wishlist catalog grids
from the Mon admin panel. Support common presets (1:1, 4:3, 3:4, 16:9) and arbitrary custom
ratios (e.g. 21:9). The setting must apply globally to all catalog grids without code changes.

## Out of scope

- Product detail page main image (already full-bleed)
- Stores page cards
- About page images
- Hero/secondary banners
- Per-category overrides (YAGNI; revisit later if requested)

## Data model

Add a single system setting under key `catalogImageRatio`:

```ts
type CatalogImageRatio = {
  mode: 'preset' | 'custom';
  preset?: 'square' | '4-3' | '3-4' | '16-9';
  custom?: { width: number; height: number };
  scope: 'all' | 'product' | 'combo';
};
```

**Default:** `{ mode: 'preset', preset: 'square', scope: 'all' }` — preserves current
behavior, no migration needed.

Stored as JSON in the existing `system_settings` table (key-value).

## Mapping (helper)

```ts
// apps/storefront/lib/utils/image-ratio.ts
export type ImageRatioConfig = CatalogImageRatio;

export function getAspectStyle(cfg: ImageRatioConfig | undefined):
  | { className: string }
  | { className: string; style: { aspectRatio: string } } {
  if (!cfg || cfg.mode === 'preset' && (!cfg.preset || cfg.preset === 'square')) {
    return { className: 'aspect-square' };
  }
  if (cfg.mode === 'preset') {
    return { className: {
      '4-3': 'aspect-[4/3]',
      '3-4': 'aspect-[3/4]',
      '16-9': 'aspect-video',
    }[cfg.preset!] };
  }
  // custom
  if (cfg.custom && cfg.custom.width > 0 && cfg.custom.height > 0) {
    return { className: 'w-full', style: { aspectRatio: `${cfg.custom.width}/${cfg.custom.height}` } };
  }
  return { className: 'aspect-square' };
}
```

## Files

### Backend
- `apps/backend/src/system-settings/system-settings.controller.ts`
  - Add `CatalogImageRatio` to the storefront DTO
  - Default it to `{ mode: 'preset', preset: 'square', scope: 'all' }` if unset
  - Include in `GET /system-settings/storefront` (public) and admin `GET /system-settings`

### Admin
- `apps/admin/src/features/settings/display-settings.tsx` (NEW)
  - Card with preset radios (Square / 4:3 / 3:4 / 16:9 / Custom)
  - Custom mode: 2 number inputs (width, height), 1-999, integer
  - Live preview: 4 small tiles with placeholder, in a row
  - Scope radio: All / Products only / Combos only
  - Save button calls `systemSettingsApi.set('catalogImageRatio', value)`

- `apps/admin/src/routes/_authenticated/mon/settings/display/index.tsx` (NEW)
  - TanStack Router route registered under Mon settings

- `apps/admin/src/features/settings/system-settings.tsx`
  - Add "Display" link to the settings card grid

- `apps/admin/src/features/settings/storage-api.ts`
  - No change (existing `set` works)

### Storefront
- `apps/storefront/lib/api/storefront-config.ts`
  - Add `catalogImageRatio?: CatalogImageRatio` to `StorefrontConfig`

- `apps/storefront/lib/utils/image-ratio.ts` (NEW)
  - `getAspectStyle()` helper as defined above
  - `useCatalogImageStyle()` hook reading from `StorefrontConfigContext`

- `apps/storefront/components/ProductCard.tsx`
  - Line 79: replace `aspect-square` with `getAspectStyle(config.catalogImageRatio)`

- `apps/storefront/components/ComboDeals.tsx`
  - Line 56: same replacement

- `apps/storefront/app/wishlist/page.tsx`
  - Line 66: same replacement

- `apps/storefront/app/products/page.tsx` and `app/combos/page.tsx`
  - Pass config to grid components (via context; no prop drilling)

## Admin UI mockup (text)

```
┌─ Display Settings ──────────────────────────────────────┐
│ Catalog Image Ratio                                      │
│                                                          │
│ ○ Square (1:1)        [preview] [preview] [preview]     │
│ ○ 4:3                 [preview] [preview] [preview]     │
│ ● 3:4 Portrait        [▓▓▓]    [▓▓▓]    [▓▓▓]            │
│ ○ 16:9 Widescreen                                       │
│ ○ Custom: width [3] / height [4]                        │
│                                                          │
│ Apply to: ● All  ○ Products  ○ Combos                   │
│                                                          │
│ [Save Changes]                                           │
└──────────────────────────────────────────────────────────┘
```

## Acceptance criteria

- Admin can change the ratio and the storefront updates within 5 minutes (config revalidate) or on hard reload.
- Custom ratio 21:9 renders correctly (no broken layout).
- Old localStorage cart and existing images are unaffected.
- No CLS regression: container reserves aspect ratio space even before image loads.
- Works in dark mode (uses Tailwind aspect utilities which are color-agnostic).

## Risk / rollback

- If aspect helper miscalculates, fallback is `aspect-square` (preserves current).
- Setting is read-only on storefront side; admin can reset to default.
- No DB migration, no breaking change to API consumers.
