# Brand Color Theme Setting
> **Superseded by:** `docs/3-DOMAINS/02-products.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

## প্রয়োজন

Admin panel-এ color picker দিয়ে storefront-এর branding colors change করলে পুরো storefront জুড়ে সব brand color instantly reflect হবে। Admin panel নিজে unaffected থাকবে।

## Keys & Defaults

Stored as individual `SystemSetting` key-value pairs:

| SystemSetting Key | Default Hex | Tailwind CSS Variable |
|---|---|---|
| `brand_primary` | `#0089CD` | `--color-brand-blue` |
| `brand_primary_dark` | `#006da3` | `--color-brand-blue-dark` |
| `brand_accent` | `#E77250` | `--color-brand-coral` |
| `brand_text` | `#0a0a0a` | `--color-brand-dark` |
| `brand_bg` | `#FFFFFF` | `--color-brand-bg` |
| `brand_success` | `#22C55E` | `--color-brand-success` |
| `brand_danger` | `#EF4444` | `--color-brand-danger` |
| `brand_border` | `#E5E7EB` | `--color-brand-border` |

## Mechanism

Tailwind v4's `@theme inline` generates utilities using `var(--color-*)`. By overriding these variables on `<html>`, all Tailwind brand classes automatically consume the new value without touching 55+ component files.

## Scope

- **Only storefront** — admin panel styling untouched
- **Storefront**: `apps/storefront/`
- **Admin**: `apps/admin/` (only the color picker UI)
- **Backend**: `apps/backend/` (SystemSetting + storefront config response)

## Files to Change

### Backend (1 file)
- `apps/backend/src/system-settings/system-settings.controller.ts`
  - Add brand color keys to `GET /system-settings/storefront` response under `branding.colors`

### Storefront (4 files)
- `apps/storefront/lib/api/storefront-config.ts` — add `colors` type to `branding` interface
- `apps/storefront/lib/api/storefront-config-server.ts` — add default colors to `DEFAULT_CONFIG.branding`
- `apps/storefront/app/globals.css` — add 4 new CSS variables for new color tokens
- `apps/storefront/app/layout.tsx` — inject color vars as inline style on `<html>`, fix 5 hardcoded color references

### Admin (1 file)
- `apps/admin/src/features/settings/branding/branding-settings.tsx` — add "Brand Colors" card with color pickers

## Implementation Order

1. Backend: controller changes
2. Storefront: type, CSS, layout changes
3. Admin: color picker UI

## Verification

- Change a color in admin → save → refresh storefront → color updated everywhere
- Reset to default → storefront shows original colors
- Admin panel appearance unchanged
