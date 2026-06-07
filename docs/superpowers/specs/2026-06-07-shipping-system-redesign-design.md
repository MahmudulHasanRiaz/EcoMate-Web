# Shipping System Redesign — Dual-Mode (Options + Auto District) — Design Spec

**Date:** 2026-06-07
**Status:** Approved
**Scope:** Replace flat per-district charge config with two exclusive shipping modes: Shipping Options (WooCommerce-like) and Auto District (default + exception zones).

## Motivation

The current `district_charges` JSON requires all 64 BD districts to be configured individually. Admin needs:
1. A WooCommerce-like **Shipping Options** mode — create N named options with amounts, customer picks one.
2. An **Auto District** mode — set a default Bangladesh charge, then define exception zone groups (different amount, free, or no-delivery) for specific districts.

Both modes cannot run simultaneously. A toggle in settings picks which is active.

## Data model

### New Prisma models

```prisma
model ShippingOption {
  id        String   @id @default(uuid())
  name      String
  amount    Decimal  @db.Decimal(10, 2)
  isActive  Boolean  @default(true)
  sortOrder Int      @default(0)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model ShippingZoneGroup {
  id        String   @id @default(uuid())
  label     String?
  type      String                    // "custom_amount" | "no_delivery"
  amount    Decimal? @db.Decimal(10, 2)
  districts Json                      // ["dhaka", "narayanganj", "gazipur", ...]
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Order model — new fields

```prisma
model Order {
  // ... existing fields ...
  selectedShippingOptionId  String?  // null if auto district or manual override
  shippingChargeOverridden  Boolean  @default(false)
}
```

### SystemSetting — new key

| Key | Value | Purpose |
|-----|-------|---------|
| `shipping_mode` | `"options"` \| `"auto_district"` | Active shipping mode |

Existing `delivery_charge` becomes the default Bangladesh charge in auto district mode.

## New tables summary

| Table | Mode | Purpose |
|-------|------|---------|
| `ShippingOption` | Options | Admin-defined named options (name + amount) |
| `ShippingZoneGroup` | Auto District | Exception groups: custom amount or no-delivery for selected districts |

## Backend API

### New resources under `/api/shipping/`

| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/shipping/options` | Admin | List all shipping options |
| POST | `/shipping/options` | Admin | Create option |
| PUT | `/shipping/options/:id` | Admin | Update option |
| DELETE | `/shipping/options/:id` | Admin | Delete option |
| GET | `/shipping/zones` | Admin | List all zone groups |
| POST | `/shipping/zones` | Admin | Create zone group |
| PUT | `/shipping/zones/:id` | Admin | Update zone group |
| DELETE | `/shipping/zones/:id` | Admin | Delete zone group |

### Updated existing endpoints

**`GET /system-settings/storefront`** — now also returns:
```typescript
{
  shippingMode: "options" | "auto_district",
  shippingOptions: [{ id, name, amount, sortOrder }],  // only if mode=options
  shippingZones: [{ id, type, amount, districts }],     // only if mode=auto_district
  districtCharges: Record<string, number>,               // generated from zones for backward compat
  delivery: { charge, freeDeliveryMin },
  checkout: { districtEnabled, thanaEnabled, ... }
}
```

**`POST /orders`** — unchanged, still accepts `shippingCharge` from client. But storefront now calculates using the new rules before sending.

**`PUT /orders/:id`** — unchanged. Admin can override `shippingCharge`. If they change amount independently of the option, `shippingChargeOverridden` flag flips.

## Admin UI (`/mon/settings/shipping/`)

Single page with three tabs:

### Tab 1 — General
- Radio toggle: Shipping Options / Auto District
- Default delivery charge (Decimal) — used in auto district mode as Bangladesh-wide default
- Free delivery min amount
- Checkout config (district/thana enabled/required)

### Tab 2 — Shipping Options (visible when mode = Options)
- "Add Option" button → modal with name + amount fields
- Table list of all options: name (editable), amount (editable), active toggle, sort order (drag), delete
- Sort by `sortOrder`

### Tab 3 — Zone Groups (visible when mode = Auto District)
- Info text: "সকল জেলার জন্য ডিফল্ট চার্জ: X৳। নিচের গ্রুপগুলোর জন্য ভিন্ন নিয়ম প্রযোজ্য।"
- "Add Group" button → modal/panel with:
  - Label (e.g. "No Delivery Areas")
  - Type: Custom Amount / No Delivery
  - Amount (if custom amount) — 0 allowed for free delivery
  - District multi-select (checkbox list of 64 districts with Bengali names, searchable)
  - Active toggle
- Table list of existing groups: label, type badge, amount or "No Delivery", districts count, active toggle, edit/delete

### Order Edit Page (`/op/orders/$id`)

**Shipping section** (existing, enhanced):
- **Shipping Options mode:** Dropdown of active options. Selecting one fills the amount. Admin can still type a different amount (triggers `shippingChargeOverridden = true`). Shows pill: "Override: Admin changed amount"
- **Auto District mode:** Shows district and auto-calculated charge. Amount field editable. Same override flag.
- Timeline entries for shipping changes enhanced with: `"Shipping: ৫০৳ → ১০০৳ (Option: ঢাকা সিটি)"` or `"Shipping: ৫০৳ → ৭০৳ (Override)"`

## Storefront checkout changes

### Mode 1 — Shipping Options

- Fetch active options from `/system-settings/storefront` → `shippingOptions[]`
- Render radio group below address section:
  ```
  ○ ঢাকা সিটি — ৫০৳
  ○ ঢাকার বাহিরে — ১৫০৳
  ```
- On selection → set `shippingCharge` to option amount
- Free delivery threshold still checked (if cart >= freeDeliveryMin, charge = 0 regardless)
- No district charge calculation needed; district dropdown still exists for address but doesn't affect charge

### Mode 2 — Auto District

- Fetch `shippingZones` and `delivery.charge` from config
- District dropdown select triggers calculation:
  1. Find if district belongs to any active zone group
     - `no_delivery` → show error: "এই এলাকায় ডেলিভারি সম্ভব না", disable place order button
     - `custom_amount` → charge = that group's amount
  2. If no zone group matches → charge = `delivery.charge` (default)
  3. If cart >= `freeDeliveryMin` → charge = 0 (overrides zone amount too)
- No shipping option radio group shown

### Common

- `shippingCharge` sent in `POST /orders` as before
- Checkout lead capture updated to include selected option ID if applicable

## Implementation order

1. Prisma migration — new models + Order fields
2. Backend — ShippingModule (controller, service, DTOs for ShippingOption + ShippingZoneGroup)
3. Backend — Update StorefrontConfig service to return shipping mode + options/zones
4. Admin — Shipping settings page (3 tabs)
5. Admin — Enhanced order edit shipping section
6. Storefront — Checkout page: Mode 1 (Options) implementation
7. Storefront — Checkout page: Mode 2 (Auto District) implementation with zone logic + no-delivery blocking
8. Verify both modes work end-to-end

## Out of scope

- Courier integration changes (shipping charge is independent of courier dispatch)
- Customer account page (no order-placing from account yet)
- Bulk shipping charge editing
- Shipping charge reports/analytics
