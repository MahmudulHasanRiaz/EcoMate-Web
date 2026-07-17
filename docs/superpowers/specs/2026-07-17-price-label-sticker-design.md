# Price Label Sticker — Design Spec

## Overview
Bulk-print thermal price label stickers with SKU barcodes for selected products from the admin product list. Supports parent/variant/all scope, configurable price display, and optional variant attribute labels. Sticker dimensions configurable via admin settings.

## Use Flow
1. Admin opens Products list
2. Selects products via checkboxes
3. Clicks "Price Label" in bulk action bar
4. Print Options modal appears:
   - **Scope**: Parent only | Variants only | All
   - **Price**: Base Price | Sale Price | Smart (sale if exists, else base) | Both
   - **Show Variant Attributes**: Toggle (default on)
5. Clicks "Print"
6. New tab opens → renders stickers → triggers browser print dialog (for thermal printer)

## Sticker Content (per sticker)
- SKU → rendered as barcode via `react-barcode` (CODE128, machine-readable)
- Price line (based on user selection)
- Variant attributes (optional, e.g., "Size: M, Color: Red")

### Price Logic
| Mode | Display |
|---|---|
| `base` | `৳{basePrice}` |
| `sale` | `৳{salePrice}` |
| `smart` | `৳{salePrice ?? basePrice}` |
| `both` | `৳{basePrice}` (crossed/strikethrough) + `৳{salePrice}` |

## Sticker Dimensions
- **Default**: 50mm × 30mm
- **Configurable**: via admin Settings > Price Label (width × height in mm)
- Stored in `SystemSetting` with key `price_label` as JSON `{ "width": 50, "height": 30 }`
- CSS `@page { size: {width}mm {height}mm; margin: 0; }`
- Content scales fluidly via relative units + viewport

## Barcode Rendering
- Library: `react-barcode` (already installed)
- Value: SKU string
- Font size, width, height auto-calculated based on sticker width to ensure fit
- SVG constrained via `max-width: 100%` + `height: auto`
- SKU length variation handled by adjusting barcode module width (`width` prop) dynamically

## Scope Handling
| Selection | Renders |
|---|---|
| `parent` | One sticker per product (uses product-level SKU + basePrice/salePrice) |
| `variants` | One sticker per variant of each selected product |
| `all` | Parent sticker + all variant stickers per product |

- Variable products with no variants → fallback to parent sticker
- Products without SKU → skip (show warning badge)

## New Files

### Backend
- `apps/backend/src/products/dto/price-label.dto.ts` — DTO for price-label print data endpoint

### Admin (Frontend)
- `apps/admin/src/features/print/price-label-template.tsx` — Price label sticker component
- `apps/admin/src/features/print/components/price-label-modal.tsx` — Print options modal
- `apps/admin/src/features/print/hooks.ts` — Data fetching hook for price-label print
- `apps/admin/src/routes/_authenticated/op/print/price-labels/index.tsx` — Print route
- `apps/admin/src/features/settings/price-label/` — Price label settings page
- `apps/admin/src/routes/_authenticated/mon/settings/price-label/index.tsx` — Settings route

### Modified Files
- `apps/admin/src/features/products/index.tsx` — Add "Price Label" bulk action button
- `apps/admin/src/features/settings/index.tsx` — Add "Price Label" to System sidebar nav
- `apps/backend/src/system-settings/system-settings.controller.ts` — No changes needed (KV store already supports any key)

## Data Flow
1. Bulk action "Price Label" → modal collects options
2. On confirm → `router.navigate({ to: '/op/print/price-labels', search: { ids, scope, price, showAttrs } })`
3. Print route reads search params → fetches product data via `GET /products?ids=...` (with `includeVariants=true`)
4. Reads `price_label` system setting for dimensions
5. Renders `PriceLabelTemplate` per product/variant
6. `window.print()` triggers browser/thermal printer

## Backend API
- `GET /products?ids=id1,id2&includeVariants=true` — Already exists, variants are included by default. Need to ensure variants with SKU + prices are returned in response.

## Settings UI
- Location: Settings > System > Price Label
- Two number inputs: Width (mm), Height (mm)
- Range: min 20×15, max 100×75
- Default: 50×30
- Saved as `POST /system-settings/price_label` with body `{ "value": JSON.stringify({ width: 50, height: 30 }) }`

## Edge Cases
- **No SKU**: Skip sticker, show count in header ("Skipped 3 products without SKU")
- **Variable product, no variants**: Treat as simple, show parent sticker
- **Variant without SKU**: Skip that variant
- **Variant without price**: Use product basePrice as fallback
- **Price both mode, no salePrice**: Show only basePrice
- **Smart mode, no salePrice**: Show basePrice only
- **Very long SKU**: Auto-reduce barcode module width (`width` prop) based on SKU length vs sticker width
