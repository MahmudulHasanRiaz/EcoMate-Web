# POS Plugin Module Design

## Overview
Dedicated Point of Sale (POS) application for showroom/branch operations. Supports multiple showrooms, cashier sessions, barcode scanning, category-driven product grid, hold cart, quick customer creation, split payments, discounts, and receipt printing.

## Tech Stack
- **App**: Standalone React SPA (in monorepo `apps/pos/`)
- **Backend**: Existing NestJS API + new POS module
- **Database**: PostgreSQL via Prisma (existing)
- **Auth**: JWT (same as admin/storefront), cashier + admin roles allowed

---

## 1. Backend — New & Changed Models

### 1.1 Showroom = Warehouse with `type`
Existing `Warehouse` model gets `type` enum: `main | showroom | storage`. Showroom uses `type: showroom`.

### 1.2 PosSession
```prisma
enum PosSessionStatus { open closed cancelled }

model PosSession {
  id              String           @id @default(uuid())
  showroomId      String
  showroom        Warehouse        @relation(fields: [showroomId], references: [id])
  cashierId       String
  cashier         User             @relation(fields: [cashierId], references: [id])
  openingBalance  Decimal          @db.Decimal(10, 2)
  closingBalance  Decimal?         @db.Decimal(10, 2)
  expectedBalance Decimal?         @db.Decimal(10, 2)
  status          PosSessionStatus @default(open)
  openedAt        DateTime         @default(now())
  closedAt        DateTime?
  notes           String?
  orders          Order[]
  createdAt       DateTime         @default(now())
  updatedAt       DateTime         @updatedAt
}
```

### 1.3 Order Changes
```prisma
enum OrderSource { POS ECOMMERCE MANUAL }
enum SalesChannel { CALL FACEBOOK INSTAGRAM TIKTOK MESSENGER WHATSAPP THREADS WALK_IN WEBSITE OTHER }

model Order {
  // existing fields...
  source        OrderSource?   @default(ECOMMERCE)
  salesChannel  SalesChannel?
  posSessionId  String?
  posSession    PosSession?    @relation(fields: [posSessionId], references: [id])
}
```

### 1.4 Delivery Method
Add `CounterSale` / `Takeaway` type in delivery method. If selected → order status = `delivered` immediately. Else → `confirmed` (standard ecommerce flow).

---

## 2. POS App Structure

```
apps/pos/
├── src/
│   ├── components/          # Shared POS components
│   ├── features/
│   │   ├── auth/            # Login (cashier/admin only)
│   │   ├── session/         # Open/close session, float entry
│   │   ├── pos/             # Main POS terminal
│   │   └── orders/          # Session orders list
│   ├── hooks/
│   ├── stores/              # Zustand (cart, session)
│   ├── api/                 # Backend API client
│   └── App.tsx
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## 3. Routes

| Route | Page |
|-------|------|
| `/login` | Cashier login |
| `/session/select` | Choose showroom (if multiple) |
| `/session/open` | Enter opening balance |
| `/pos` | Main POS terminal |
| `/pos/hold` | Held carts list |
| `/pos/orders` | Today's session orders |
| `/pos/orders/:id` | Order detail / receipt reprint |
| `/session/close` | Closing balance and settlement |

**Session guard**: All `/pos/*` redirect to `/session/*` if no active session.

---

## 4. POS Terminal Layout

```
┌──────────────────────────────────────────────────────┐
│  [Search...]  [Barcode Scan Input]   Cart: 3 items   │
│  ┌──────────────┐  ┌───────────────────────────────┐ │
│  │ Categories   │  │   Product Grid (cards)        │ │
│  │ All Products │  │                               │ │
│  │ Electronics  │  │  [Product] [Product] [Product] │ │
│  │   └ Mobile   │  │  [Product] [Product] [Product] │ │
│  │   └ Laptop   │  │                               │ │
│  │ Clothing     │  └───────────────────────────────┘ │
│  │   └ Men      │                                    │
│  │   └ Women    │                                    │
│  └──────────────┘                                    │
├──────────────────────────────────────────────────────┤
│ Cart Panel:                                          │
│  Item         Qty   Price   Total   Remove           │
│  Product A    1     500     500     [×]              │
│  Product B    2     300     600     [×]              │
│  ─────────────────────────────────────               │
│  Subtotal   1,100                                    │
│  Discount   100 [Edit] (flat/%)                      │
│  Total      1,000                                    │
│                                                      │
│  Customer: [Walk-in] [Quick Add]                    │
│  Payment: [Cash] [Card] [Mobile] [Split]            │
│                                                      │
│     [Hold Cart]         [Pay]                       │
└──────────────────────────────────────────────────────┘
```

### Category Navigation Rules
- Category tree (left panel): nested expandable
- Click parent category → grid shows parent + all child categories' products
- Click child → grid shows child + deeper descendants' products
- Click deeper → same pattern recursively

### Cart Operations
- Quantity +/- inline
- Remove item
- Discount per item or per order (flat amount or percentage)
- Hold cart (saves to backend, resume later)
- Quick customer: phone required, name optional. If phone matches existing → load customer.

### Payment
- Single or split payment (Cash + Card + Mobile Banking mix)
- On Pay:
  - If delivery is `Counter Sale` / `Takeaway` → order status = `delivered`
  - Else → order status = `confirmed` (normal ecommerce flow)
- Success → receipt print prompt (optional) → cart clears

---

## 5. Sales Channel
`Order.salesChannel` tracks order origin. Available on POS and manual order creation in admin.

Selections: `CALL`, `FACEBOOK`, `INSTAGRAM`, `TIKTOK`, `MESSENGER`, `WHATSAPP`, `THREADS`, `WALK_IN`, `WEBSITE`, `OTHER`.

---

## 6. Backend API Endpoints
All under `/api/pos/`:

### Sessions
- `POST /api/pos/sessions` — Open session (showroomId, openingBalance)
- `GET /api/pos/sessions/active` — Get current active session (by cashier + showroom)
- `PATCH /api/pos/sessions/:id/close` — Close session (closingBalance, notes)

### Orders (POS-specific)
- `POST /api/pos/orders` — Create POS order (items, customer, payments, deliveryMethod, salesChannel)
- `GET /api/pos/orders` — List orders for current session
- `GET /api/pos/orders/:id` — Order detail
- `POST /api/pos/orders/hold` — Save held cart
- `GET /api/pos/orders/hold` — List held carts
- `DELETE /api/pos/orders/hold/:id` — Delete held cart

### Shared (existing, reused)
- `GET /api/products?search=&categoryId=&barcode=` — Product lookup
- `GET /api/categories/tree` — Category tree
- `POST /api/customers/quick` — Quick customer create
- `GET /api/customers?phone=` — Lookup customer by phone

---

## 7. Roles & Permissions
| Action | Roles |
|--------|-------|
| Open/close session | cashier, admin |
| Create POS order | cashier, admin |
| Void/refund order | admin, manager |
| View reports | cashier (own), admin (all) |

---

## 8. Build & Deploy
- Vite build, output to `dist/`
- Served by backend via `@fastify/static` or separate subdomain
- Docker Compose update optional (separate service)
