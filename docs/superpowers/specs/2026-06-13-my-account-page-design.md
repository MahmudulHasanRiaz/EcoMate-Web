# My Account Page — Design Spec
> **Superseded by:** `docs/2-ARCHITECTURE/ARCHITECTURE.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

## Overview
Build a complete customer "My Account" area with Profile, Orders, Addresses, Wishlist, and Settings sections. Add `autoVariantSelect` setting to control product detail page variant pre-selection. Ensure zero SQL injection risk.

## Architecture

### Backend — New Endpoints

All endpoints are JWT-protected (`@UseGuards(JwtAuthGuard)` or rely on global guard), scoped to the authenticated user.

#### Profile
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/auth/me` | Already exists. Returns current user. |
| `PUT` | `/auth/me` | Update own profile (firstName, lastName, email, phoneNumber). Add to existing `AuthController`. |

#### Orders
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/orders/my` | Paginated list of authenticated user's orders. Query params: `page`, `limit`, `status` (optional filter: `active`, `completed`, `cancelled`). Frontend shows tab bar: **All** (no filter) | **Active** (`status=active`) | **Completed** (`status=delivered`) | **Cancelled** (`status=cancelled`). This replaces both "My Orders" and "Order History". |
| `GET` | `/orders/my/:id` | Single order detail for authenticated user. Validate ownership. |

#### Addresses — New Resource
New Prisma model `Address`:
```prisma
model Address {
  id         String   @id @default(uuid())
  userId     String
  label      String   // e.g. "Home", "Office"
  fullName   String
  phoneNumber String
  street     String
  city       String
  state      String?
  zipCode    String?
  country    String   @default("Bangladesh")
  isDefault  Boolean  @default(false)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

CRUD:
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/addresses` | List user's addresses |
| `POST` | `/addresses` | Create new address |
| `PUT` | `/addresses/:id` | Update address |
| `DELETE` | `/addresses/:id` | Delete address |
| `PATCH` | `/addresses/:id/default` | Set as default (unset others) |

#### Settings — New Resource
Reuse existing `UserSettings` Prisma model (already in schema but may need field addition):
```prisma
model UserSettings {
  id                 String @id @default(uuid())
  userId             String @unique
  autoVariantSelect  Boolean @default(true)
  // ... existing fields

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/users/settings` | Get current user's settings |
| `PUT` | `/users/settings` | Update settings (upsert) |

### Frontend — `/account` Page

Structure (all in one page with sidebar navigation, same as current pattern):

```
/account
  ├── Profile (default)     — Edit name, email, phone
  ├── My Orders             — Paginated order list + detail view inline
  ├── Saved Addresses       — Address CRUD with modal
  ├── Wishlist              — Link to /wishlist (or embed)
  └── Settings              — autoVariantSelect toggle
```

#### Component Tree
- `app/account/page.tsx` — Main layout, sidebar + content area
- `app/account/ProfileSection.tsx` — Profile edit form
- `app/account/OrdersSection.tsx` — Order list + detail
- `app/account/AddressesSection.tsx` — Address CRUD
- `app/account/SettingsSection.tsx` — Auto-variant toggle
- `app/account/Sidebar.tsx` — Navigation sidebar

No new API modules needed — use existing pattern (`lib/api/*.ts`).

### Auto-Variant Select Feature

**Setting:** `autoVariantSelect: boolean` in `UserSettings` (default `true`).

**Frontend behavior in ProductDetailClient:**
- On product page load, fetch `GET /users/settings` (only if logged in)
- If `autoVariantSelect === false` → do NOT pre-select any variant
- If `autoVariantSelect === true` OR not logged in → existing behavior (pre-select first variant)
- Store setting in context or local state

**Backend:**
- `GET /users/settings` returns current settings (or default if none)
- `PUT /users/settings` upserts settings

### SQL Injection Audit
Already completed — zero vulnerabilities found. The only raw SQL is `$queryRawUnsafe('SELECT 1')` in health controller (static literal). All data access uses Prisma ORM methods with parameterized queries.

## Data Flow
1. User logs in → `AuthContext` hydrates user
2. User navigates to `/account` → sidebar shows sections
3. Each section fetches its own data via API
4. Profile/Addresses/Settings mutations → optimistic UI update or refetch
5. Logout clears token → redirect to login view

## Error Handling
- 401 → auto-refresh token via interceptor; if expired → show login
- Network error → toast notification (sonner)
- Validation error → inline field errors
- Not found → empty state with message

## Security
- All endpoints validate ownership (user can only access own data)
- Prisma parameterized queries prevent SQL injection
- Input validation via class-validator DTOs
- Rate limiting applies to sensitive endpoints

## Files to Modify/Create

### Backend
- `prisma/schema.prisma` — Add `Address` model, verify `UserSettings.autoVariantSelect`
- `src/auth/auth.controller.ts` — Add `PUT /auth/me`
- `src/auth/auth.service.ts` — Add `updateProfile(userId, dto)`
- `src/orders/orders.controller.ts` — Add `GET /orders/my`, `GET /orders/my/:id`
- `src/orders/orders.service.ts` — Add `findMyOrders(userId, query)`, `findMyOrderById(userId, id)`
- `src/addresses/addresses.controller.ts` — New controller
- `src/addresses/addresses.service.ts` — New service
- `src/addresses/dto/*.ts` — DTOs
- `src/addresses/addresses.module.ts` — New module
- `src/users/users.controller.ts` — Add `GET/PUT /users/settings`
- `src/users/users.service.ts` — Add settings methods
- Register `AddressesModule` in `AppModule`

### Frontend
- `app/account/page.tsx` — Rewrite with proper sections
- `app/account/sections/ProfileSection.tsx` — New
- `app/account/sections/OrdersSection.tsx` — New
- `app/account/sections/AddressesSection.tsx` — New
- `app/account/sections/SettingsSection.tsx` — New
- `app/account/Sidebar.tsx` — Extract from current page
- `lib/api/addresses.ts` — New API module
- `lib/api/settings.ts` — New API module
- `lib/api/auth.ts` — Add `updateProfile`
- `lib/api/orders.ts` — Add `getMyOrders`, `getMyOrderById`
- `components/ProductDetailClient.tsx` — Integrate autoVariantSelect setting
