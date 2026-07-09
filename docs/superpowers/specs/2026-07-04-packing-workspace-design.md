# Packing Workspace Design
> **Superseded by:** `docs/3-DOMAINS/10-dispatch-packing.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

## Overview
Dedicated packing workspace for warehouse packing staff (`packing_assistant` role)। Optimized for speed: large product images, minimal clicks, keyboard-friendly, card-based layout।

## Architecture
- Fits inside admin SPA (`apps/admin/`) at route `/op/packing/`
- Full-screen layout (hides sidebar + top nav)
- New NestJS `packing` backend module
- New `PackingLock` model, `packing_assistant` role

---

## 1. Backend — Prisma Changes

### 1.1 New Model: PackingLock
```prisma
model PackingLock {
  id        String   @id @default(uuid())
  orderId   String   @unique
  order     Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  packerId  String
  packer    User     @relation(fields: [packerId], references: [id])
  startedAt DateTime @default(now())
  expiresAt DateTime?

  @@index([packerId])
}
```

### 1.2 Role: `packing_assistant` (already added to UserRole enum)

### 1.3 Order Status
No new statuses। `Confirmed` = Ready for Packing। `Done` → status changes to `Packed`। `Hold` → status changes to `Packing Hold`।

---

## 2. Backend — Packing Module

### Endpoints

| Method | Route | Action |
|--------|-------|--------|
| GET | `/api/packing/queue` | List Confirmed orders, exclude locked-by-others |
| GET | `/api/packing/queue/:id` | Open an order (auto-create PackingLock) |
| POST | `/api/packing/queue/:id/done` | Mark Packed, release lock |
| POST | `/api/packing/queue/:id/hold` | Mark Packing Hold with reason + notes |
| GET | `/api/packing/locks` | Active locks (supervisor view) |
| GET | `/api/packing/stats` | Today's stats per packer |
| GET | `/api/packing/history` | Packing history (supervisor) |

### PackingLock Logic
- When packer opens order → `PackingLock` created (or upserted)
- Other packers see "Being packed by X, started Y mins ago" — Done/Hold buttons disabled
- Lock auto-released after 30 mins (configurable)
- If same packer re-opens → lock refreshes

### Order Status Transitions
- `Confirmed` → `Packed` (via Done)
- `Confirmed` → `Packing Hold` (via Hold)
- `Packing Hold` → `Confirmed` (via manual admin action)
- PackingLock does NOT change order status (order stays Confirmed until Done/Hold)

### Roles
- `@Roles('packing_assistant', 'admin', 'superadmin')` on packing endpoints
- Only `admin`/`superadmin` can access history/stats for all users

---

## 3. Frontend — Packing Workspace Route

Route: `/op/packing/`

### Auto-redirect
- User with role `packing_assistant` → login পর auto-redirect `/op/packing/`
- Dual role (admin + packing_assistant) → workspace switcher in header (ERP ↔ Packing)

### Layout
- Full-screen, no sidebar, no admin top nav
- Simple header bar: search input + queue count + personal stats

### Main Queue
- Cards for each `Confirmed` order
- Card shows: large product images, product name, variant, qty, total items
- Locked cards show: "Being packed by [name] (started Xm ago)" with disabled buttons
- Keyboard navigation: ↑↓ to move, Enter to open

### Actions per card
- **Done** → status `Packed`, lock released, card removed from queue
- **Hold** → modal with reason (Product Missing / Stock Issue / Damaged Product / Waiting for Approval / Customer Request / Other) + optional notes → status `Packing Hold`
- **Print** → opens sticker print page in new tab for that order

### More Details
- Expandable section: customer name, phone, address, payment info, internal notes, order date

### Stats bar
- Today: Pending | Packed | Held (current user only)

### Supervisor View
- Extra tabs: active locks, all packers' stats today, held orders list, packing history

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| Enter | Open selected order |
| Space | Done |
| H | Hold |
| Esc | Close / back to queue |
| ↑ ↓ | Navigate cards |
| P | Print sticker |

---

## 4. Sticker Printing
Uses existing sticker template (`apps/admin/src/features/print/sticker-template.tsx`)। Opens `/op/print/sticker/:id` in new tab। Already supports 75mm×100mm format with barcode।

---

## 5. Permissions
| Action | packing_assistant | admin/superadmin |
|--------|:-:|:-:|
| View queue | ✅ | ✅ |
| Open/pack order | ✅ | ✅ |
| Hold order | ✅ | ✅ |
| Print sticker | ✅ | ✅ |
| View own stats | ✅ | ✅ |
| View all stats | ❌ | ✅ |
| View active locks | ❌ | ✅ |
| View packing history | ❌ | ✅ |
| Access ERP modules | ❌ (redirect to packing) | ✅ |
