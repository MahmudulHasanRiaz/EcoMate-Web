# EcoMate — Final Feature Architecture & License Integration Plan

> **Status:** Final Draft
> **Based on:** `features_plan.md` (72 features, restructured) + Architecture Doc (Stock/Inventory decoupling) + existing codebase analysis
> **Design Principle:** KeyMate defines plan→feature mapping. EcoMate defines what each feature DOES when active.

---

## 1. Restructured Feature List (72 Items)

### Group A: Core Storefront — `storefront` (1 feature)

| # | Feature Key | Name | Scope / Capabilities |
|---|---|---|---|
| 1 | `storefront` | **Storefront** | Full public e-commerce site: homepage, product listing & detail, search, cart, checkout, user account/order history. Cart = standard behavior (no animation). CMS pages visible. All standard e-commerce flows. |

**UI hiding:** Without this feature, the entire public storefront 404s or shows "Store is offline."
**Error message:** *"এই স্টোরটি বর্তমানে সক্রিয় নেই।"*

---

### Group B: Public Add-on Features (5 features)

| # | Feature Key | Name | Scope |
|---|---|---|---|
| 2 | `storefront_order_tracking` | **Order Tracking (Public)** | Public tracking box on footer/homepage. Customer enters order ID/phone → sees live parcel status. |
| 3 | `storefront_flying_cart` | **Flying Cart Animation** | Add-to-cart triggers animated fly-to-cart effect. Without it: standard silent add. |
| 4 | `storefront_reviews` | **Product Reviews** | Rating + review form on product detail page. Customers read and submit reviews. |
| 5 | `storefront_wishlist` | **Wishlist** | Heart icon on product cards + header wishlist counter + `/wishlist` page. |
| 6 | `storefront_referral` | **Referral Program (Public)** | Referral signup, invite link sharing, commission earning for customers. |

---

### Group C: Storefront Enhancements (3 features)

| # | Feature Key | Name | Scope |
|---|---|---|---|
| 7 | `pwa_setup` | **PWA Setup** | "Install App" banner, service worker, manifest. Offline partial support. |
| 8 | `seo_suite` | **SEO Suite** | Dynamic sitemap.xml, robots.txt, JSON-LD structured data. Advanced meta config. |
| 9 | `offline_conversion` | **Offline Conversion** | Upload CSV of physical-store sales to Meta/Google Ads for offline conversion tracking. |

---

### Group D: Tracking & Analytics Integrations (4 features)

| # | Feature Key | Name | Scope |
|---|---|---|---|
| 10 | `integration_ga4` | **GA4 Integration** | Google Analytics 4 tracking script + e-commerce events. Configuration panel in Settings. |
| 11 | `integration_tiktok` | **TikTok Pixel + CAPI** | TikTok Pixel (browser) + Conversions API (server). Config panel in Settings. |
| 12 | `integration_meta` | **Meta Pixel + CAPI** | Facebook Pixel + Conversions API with deduplication. Config panel in Settings. |
| 13 | `integration_google_ads` | **Google Ads** | Google Ads conversion tracking tag. Config panel in Settings. |

---

### Group E: Core Admin — Operation (9 features)

| # | Feature Key | Name | Scope |
|---|---|---|---|
| 14 | `admin_products` | **Product Management** | Core product CRUD + variants + attributes + tags + categories. **All 4 availability modes** (Always In, Always Out, Managed Stock, Inventory Controlled). **ManagedStockLedger** for stock movements. `managedStockQuantity` field. `standardCost` (Estimated Cost) field per product/variant for Estimated COGS when Inventory is not licensed. Low-stock alerts. SEO fields per product. |
| 15 | `admin_orders` | **Order Management** | Full order lifecycle: list, filter, view detail, status transitions. Includes custom order statuses. |
| 16 | `admin_customers` | **Customer Management** | Customer list, order history, block/unblock, customer details. |
| 17 | `admin_brands` | **Brand Management** | Brand CRUD, logo upload, brand-based product filtering. |
| 18 | `admin_settings` | **Settings** | Store name, logo, branding, system configuration. All sub-pages. |
| 19 | `admin_media` | **Media Library** | Image/video upload, folder management, unused media cleanup. |
| 20 | `admin_users` | **User Management** | Sub-admin/staff user CRUD, block/unblock, role assignment. |
| 21 | `admin_print` | **Print Invoices/Stickers** | One-click invoice print + delivery sticker print from order list/detail. |
| 22 | `admin_coupons` | **Coupons & Discounts** | Promo coupon code CRUD, usage tracking, expiry management. |

---

### Group F: Product Enhancement Features (5 features)

| # | Feature Key | Name | Scope |
|---|---|---|---|
| 23 | `admin_size_charts` | **Size Charts** | Size chart CRUD with table data + image. Assign to categories/products. |
| 24 | `admin_combos` | **Combo Management** | Multi-product combo offers with discounted price, stock tracking. |
| 25 | `admin_reviews` | **Review Moderation** | Approve/reject/delete customer reviews before publishing. |
| 26 | `admin_import_products` | **Import Products** | Bulk product import via CSV/Excel upload. |
| 27 | `admin_price_tags` | **Price Tag Printing** | Barcode + price label printing for physical product tagging. |

---

### Group G: Supply Chain (3 features)

| # | Feature Key | Name | Scope |
|---|---|---|---|
| 28 | `admin_suppliers` | **Supplier Management** | Supplier database, contact info, payment terms, **balance tracking, outstanding payable management, payment history**. |
| 29 | `admin_purchases` | **Purchase Orders** | PO creation, receiving, GRN (Goods Receipt Note), **inventory receiving**. **Depends on:** Supplier Management + Inventory Management (for GRN→stock). Supplier payment history and balance management belong to Supplier Management / Accounting, NOT Purchase Orders. |
| 30 | `admin_order_import` | **Order Import** | Import orders from external sources (WooCommerce, etc.) via CSV. |

---

### Group H: Financial Management (5 features)

| # | Feature Key | Name | Scope |
|---|---|---|---|
| 31 | `admin_expenses` | **Expense Management** | Expense logging, categories, expense reports. |
| 32 | `admin_payments` | **Payment Management** | Manual payment verification (bKash Personal, Nagad, Bank Transfer). Confirm/reject payments. |
| 33 | `admin_refunds` | **Refund Processing** | Accept/reject/process refund payment against an order. **Completely independent module.** Issuing a refund does NOT change Order Status, Payment Status, or Dispatch Status. Stock restoration is a separate workflow (handled by Return process or manual inventory adjustment). |
| 34 | `admin_accounting` | **Double-Entry Accounting** | Chart of Accounts, journal entries, trial balance, P&L, balance sheet. |
| 35 | `admin_financial_periods` | **Financial Periods** | Fiscal period open/close/lock. Prevents back-dated edits. Depends on Accounting. |

---

### Group I: HR & Operations (3 features)

| # | Feature Key | Name | Scope |
|---|---|---|---|
| 36 | `admin_payroll` | **Payroll Management** | Staff salary sheets, monthly pay-slip generation, payment approval. |
| 37 | `admin_employees` | **Employee Management** | Employee directory, departments, designations. |
| 38 | `admin_tasks` | **Task Management** | Kanban-style task board, task assignment, status tracking. |

---

### Group J: Marketing & Content (5 features)

| # | Feature Key | Name | Scope |
|---|---|---|---|
| 39 | `admin_email_campaigns` | **Email Campaigns** | Newsletter composer, customer list targeting, campaign send. |
| 40 | `admin_landing_pages` | **Landing Page Builder** | Custom HTML/template-based unlimited landing pages. |
| 41 | `admin_cms_pages` | **CMS Page Builder** | Dynamic info pages (FAQ, Shipping, T&C). Footer visibility control. |
| 42 | `admin_product_feeds` | **Product Feed Generator** | Meta Catalog / Google Merchant XML/GZIP feed generation. |
| 43 | `admin_referrals` | **Referral Management (Admin)** | Approve referral rewards, cash-out requests, referral lead management. |

---

### Group K: Inventory & Fulfillment (8 features)

| # | Feature Key | Name | Scope |
|---|---|---|---|
| 44 | `admin_inventory` | **Inventory Management** | Inventory Controlled product mode. Full inventory ledger. Physical stock tracking. FIFO/Average costing via CostingLot. **Depends on:** Product Management. |
| 45 | `admin_warehouses` | **Warehouses** | Multi-warehouse CRUD, bin locations. **Depends on:** Inventory Management. |
| 46 | `admin_inventory_valuation` | **Inventory Valuation** | Total stock value report based on purchase cost. **Depends on:** Inventory Management. |
| 47 | `admin_dispatch` | **Dispatch System** | Packed parcel dispatch list, courier tracking code generation. **Depends on:** Order Management. |
| 48 | `admin_packing` | **Packing Workspace** | Barcode-scanning packing operator dashboard. Lock-order-for-packing flow. |
| 49 | `admin_barcode_search` | **Barcode Search** | USB barcode scanner support in POS + admin. Auto-detect mode. |
| 50 | `admin_incomplete_orders` | **Incomplete Orders (Leads)** | Abandoned cart tracker with customer phone. Follow-up calling. |
| 51 | `admin_global_search` | **Global Search (Admin)** | Instant cross-entity search (products, orders, customers) in admin header. |

---

### Group L: Courier Services (4 features)

| # | Feature Key | Name | Scope |
|---|---|---|---|
| 52 | `courier_steadfast` | **Steadfast Courier** | Direct API booking. Shows in courier dropdown only if licensed. Settings page visible if any courier licensed. |
| 53 | `courier_pathao` | **Pathao Courier** | Direct API booking + webhook sync. |
| 54 | `courier_redx` | **RedX Courier** | Direct API booking. |
| 55 | `courier_carrybee` | **Carrybee Courier** | API booking + live tracking status sync. |

**Pattern:** Courier settings page + dispatch courier dropdown only shows couriers whose feature is active. If zero courier features active, the entire Courier settings tab hides.

---

### Group M: Payment Gateways (6 features)

| # | Feature Key | Name | Scope |
|---|---|---|---|
| 56 | `gateway_bkash` | **bKash Payment Gateway** | bKash Merchant API (PGW) for online checkout. Config panel in Settings. |
| 57 | `gateway_nagad` | **Nagad Payment Gateway** | Nagad Merchant API for online checkout. Config panel in Settings. |
| 58 | `gateway_rocket` | **Rocket Payment Gateway** | Rocket (DBBL) Merchant API for online checkout. Config panel in Settings. |
| 59 | `gateway_sslcommerz` | **SSLCommerz Payment Gateway** | SSLCommerz for online checkout. Config panel in Settings. |
| 60 | `gateway_surjopay` | **SurjoPay Payment Gateway** | SurjoPay for online checkout. Config panel in Settings. |
| 61 | `gateway_aamarpay` | **Aamarpay Payment Gateway** | Aamarpay for online checkout. Config panel in Settings. |

---

### Group N: Admin Tools (5 features)

| # | Feature Key | Name | Scope |
|---|---|---|---|
| 62 | `admin_notifications` | **Notifications** | Email/SMS notification template editor, channel config. |
| 63 | `admin_blocking` | **IP/Phone Blocking** | Spam blocking rules, IP/phone blacklist, whitelist management. |
| 64 | `admin_analytics` | **Advanced Analytics** | Sales funnel charts, marketing trend graphs, revenue analytics. |
| 65 | `admin_activity_logs` | **Activity Logs** | Full audit trail: logins, product edits, order changes. |
| 66 | `admin_help_center` | **Help Center Management** | FAQ & tutorial page editor, publish/unpublish. |

---

### Group O: Infrastructure (6 features)

| # | Feature Key | Name | Scope |
|---|---|---|---|
| 67 | `image_resize_proxy` | **Image Resize Proxy** | On-the-fly Sharp-based image resizing for storefront speed. No UI — backend service. |
| 68 | `pos_system` | **POS System** | Cashier session management, split payment, barcode billing, thermal print. **Dependency note:** POS creates Orders internally. It depends on Product Management (#14) but is NOT dependent on the standalone Order Management feature (#15) for order creation. |
| 69 | `smtp_server` | **SMTP/Email Server** | Custom SMTP config (Gmail, Mailgun, etc.). Without: default mail service. |
| 70 | `s3_storage` | **S3 Storage (R2)** | Cloudflare R2 / AWS S3 for media storage. Without: local disk storage. |
| 71 | `db_backup` | **DB Backup** | Schedule database backups, download zip files. |
| 72 | `custom_domain` | **Custom Domain & SSL** | Custom domain mapping + auto SSL generation. Without: default subdomain. |

---

## 2. Product Availability Modes — Architecture

### 2.1 The Four Modes

```
                    ┌─────────────────────────────────────────────┐
                    │           PRODUCT MANAGEMENT (#14)          │
                    │  (license: admin_products)                   │
                    │                                             │
                    │  ┌──────────┐  ┌──────────────┐            │
                    │  │ Always   │  │ Always Out   │            │
                    │  │ In Stock │  │ Of Stock     │            │
                    │  └──────────┘  └──────────────┘            │
                    │                                             │
                    │  ┌──────────────────────────┐               │
                    │  │ Managed Product Stock    │               │
                    │  │ → ManagedStockLedger     │               │
                    │  │ → Product.managedStockQuantity │               │
                    │  └──────────────────────────┘               │
                    └─────────────────────────────────────────────┘
                                      │
                                      │ (Inventory Controlled delegates
                                      │  execution to Inventory Module)
                                      ▼
                    ┌─────────────────────────────────────────────┐
                    │          INVENTORY MANAGEMENT (#44)          │
                    │  (license: admin_inventory)                   │
                    │                                             │
                    │  ┌──────────────────────────┐               │
                    │  │ Inventory Controlled     │               │
                    │  │ → InventoryLog            │               │
                    │  │ → Warehouse-level stock  │               │
                    │  │ → CostingLot (FIFO)      │               │
                    │  └──────────────────────────┘               │
                    └─────────────────────────────────────────────┘
```

### 2.2 Feature-to-Mode Mapping

| Mode | Defined In | Execution Owned By | Data Source |
|---|---|---|---|
| Always In Stock | Product Mgmt | Product Mgmt | None (unlimited) |
| Always Out Of Stock | Product Mgmt | Product Mgmt | None (blocked) |
| Managed Product Stock | Product Mgmt | Product Mgmt | `Product.managedStockQuantity` + `ManagedStockLedger` |
| Inventory Controlled | Product Mgmt | Inventory Mgmt | `InventoryLog` + Warehouse Stock |

### 2.3 Product Table Changes

Add to `Product` model:
```prisma
enum AvailabilityMode {
  ALWAYS_IN_STOCK
  ALWAYS_OUT_OF_STOCK
  MANAGED_STOCK
  INVENTORY_CONTROLLED
}

model Product {
  // ... existing fields ...
  availabilityMode      AvailabilityMode @default(ALWAYS_IN_STOCK)
  managedStockQuantity  Int              @default(0)  // replaces old `stock` field
  // manageStock remains for backward compatibility during migration
}
```

When `availabilityMode` = `INVENTORY_CONTROLLED`:
- `Product.managedStockQuantity` is READ-ONLY in the UI. It is not automatically synced with inventory. Managed Product Stock and Physical Inventory remain independent domains.
- Stock mutations happen via Inventory module only
- Storefront determines availability from the Inventory module (available quantity), NOT from `Product.managedStockQuantity`

---

## 3. ManagedStockLedger Design

### 3.1 Table Schema

```prisma
enum ManagedStockMovementType {
  INITIAL
  ORDER_DEDUCTION
  MANUAL_ADD
  MANUAL_REMOVE
  ADJUSTMENT
  RETURN
  CANCEL_RELEASE
}

enum MovementDirection {
  IN
  OUT
}

enum ReferenceEntity {
  ORDER
  ORDER_ITEM
  RETURN
  MANUAL
  ADJUSTMENT
  IMPORT
}

model ManagedStockLedger {
  id              String                    @id @default(uuid())
  productId       String?
  variantId       String?
  comboId         String?

  quantity        Int                       // absolute quantity moved
  direction       MovementDirection         // IN = stock added, OUT = stock deducted
  type            ManagedStockMovementType  // why this movement happened

  stockBefore     Int?                      // snapshot: product.managedStockQuantity before movement
  stockAfter      Int?                      // snapshot: product.managedStockQuantity after movement

  referenceType   ReferenceEntity?          // what kind of entity triggered this
  referenceId     String?                   // the entity's ID (orderId, etc.)

  note            String?                   // optional audit note
  reason          String?                   // human-readable reason
  performedById   String?
  performedAt     DateTime                  @default(now())

  @@index([productId, variantId, performedAt])
  @@index([referenceType, referenceId])
}
```

### 3.2 Strict Separation Rule

> `ManagedStockLedger` is owned by **Product Management**. It must NEVER store physical inventory movements. Physical inventory goes into `InventoryLog`.

| Movement | ManagedStockLedger | InventoryLog |
|---|---|---|
| Order placed (Managed Stock mode) | `ORDER_DEDUCTION / OUT` | — |
| Order placed (Inventory Controlled mode) | — | `inventory_reservation` → `inventory_allocation` → `inventory_issue` |
| Return — product comes back (Managed Stock mode) | `RETURN / IN` | — |
| Return — product comes back (Inventory mode) | — | `inventory_return / IN` |
| Refund — money goes out (any mode) | No stock impact. Refund does NOT move stock. | No stock impact. |
| Manual stock add | `MANUAL_ADD / IN` | — |
| Warehouse transfer | — | `inventory_transfer_out` / `inventory_transfer_in` |
| GRN receipt (Purchase) | — | `inventory_receipt / IN` |

---

## 4. Product Management vs Inventory Management — Complete Boundary

| Capability | Product Mgmt (#14) | Inventory Mgmt (#44) |
|---|---|---|
| Product CRUD | ✅ | ❌ |
| Variants, Attributes, Tags, Categories | ✅ | ❌ |
| `standardCost` (Estimated Cost) field per product/variant | ✅ Required for Estimated COGS | ❌ |
| Availability Mode: Always In Stock | ✅ Define + Execute | ❌ |
| Availability Mode: Always Out Of Stock | ✅ Define + Execute | ❌ |
| Availability Mode: Managed Product Stock | ✅ Define + Execute | ❌ |
| **Availability Mode: Inventory Controlled** | ✅ **Define** (mode selected) | ✅ **Execute** (stock logic) |
| ManagedStockLedger | ✅ | ❌ |
| InventoryLog | ❌ | ✅ |
| Low Stock Alerts | ✅ (based on managed stock) | ❌ (handled by Inventory) |
| Multi-Warehouse | ❌ | ✅ |
| Bin Locations | ❌ | ✅ |
| Stock Transfers | ❌ | ✅ |
| Inventory Valuation (FIFO) | ❌ | ✅ |
| Physical Count / Adjustment | ❌ | ✅ |
| Purchase Order → GRN → Stock | ❌ | ✅ |
| Order Reservation (Inventory) | ❌ | ✅ (triggered by Order events) |
| Product Import (CSV) | ✅ (admin_import_products) | ❌ |
| Price Tag Printing | ✅ (admin_price_tags) | ❌ |
| Barcode Search | ✅ (admin_barcode_search) | ❌ |

---

## 5. Storefront Feature — Complete Scope

**Feature key:** `storefront`
**License-controlled:** Yes

### What's INCLUDED (all part of the single Storefront feature):

| Area | Included? |
|---|---|
| Homepage | ✅ |
| Product listing pages (category, brand, search) | ✅ |
| Product detail page | ✅ |
| Shopping cart (standard) | ✅ |
| Checkout flow | ✅ |
| User account (profile, address, order history) | ✅ |
| CMS pages display (FAQ, Shipping, T&C) | ✅ |
| Basic SEO (title, meta description per page) | ✅ |

### What's SEPARATE (additional license features):

| Feature | Requires |
|---|---|
| Flying Cart animation | `storefront_flying_cart` |
| Product Reviews on detail page | `storefront_reviews` |
| Wishlist | `storefront_wishlist` |
| Public Order Tracking | `storefront_order_tracking` |
| Referral Program (customer side) | `storefront_referral` |
| PWA / Install App | `pwa_setup` |
| Advanced SEO (sitemap, JSON-LD) | `seo_suite` |

---

## 6. Feature Dependency Rules

### 6.1 Hard Dependencies

If Feature B requires Feature A, Feature B is **inaccessible** unless Feature A is also active. The system should reject activation of Feature B without A at the UI and API level.

| Feature | Depends On |
|---|---|
| `admin_warehouses` (#45) | `admin_inventory` (#44) |
| `admin_inventory_valuation` (#46) | `admin_inventory` (#44) |
| `admin_purchases` (#29) | `admin_suppliers` (#28) + `admin_inventory` (#44) |
| `admin_financial_periods` (#35) | `admin_accounting` (#34) |
| `admin_refunds` (#33) | `admin_orders` (#15) |
| `admin_packing` (#48) | `admin_orders` (#15) |
| `admin_dispatch` (#47) | **`admin_products` (#14)** + **`admin_orders` (#15)** + **at least one courier (#52-55)** |
| `admin_incomplete_orders` (#50) | `admin_orders` (#15) |
| `admin_reviews` (#25) | `storefront_reviews` (#4) (must have public reviews to moderate) |
| `admin_referrals` (#43) | `storefront_referral` (#6) |
| *All couriers (#52-55)* | `admin_orders` (#15) |
| `gateway_bkash` (#56) | `storefront` (#1) |
| `pos_system` (#63) | `admin_products` (#14) **only** (POS creates orders internally — does NOT require `admin_orders`) |
| `admin_barcode_search` (#49) | `pos_system` (#63) |
| `admin_order_import` (#30) | `admin_orders` (#15) |

> **Note on Packing vs Dispatch:** `admin_packing` is NOT a dependency of `admin_dispatch`. Packing is an advanced workflow feature that is optional. Dispatch must work independently. The system supports dispatching orders even if Packing is not licensed.

### 6.2 Payment Architecture (Unchanged)

```
Payment Management (`admin_payments`) = Manual Payment Verification System
  └─ Entire workflow: receive → verify → confirm/reject manual payments

Automatic Payment Gateways (each a separate licensed feature)
  └─ `gateway_bkash`       — bKash Merchant API (PGW)
  └─ `gateway_nagad`       — Nagad Merchant API
  └─ `gateway_rocket`      — Rocket (Dutch-Bangla Bank)
  └─ `gateway_sslcommerz`  — SSLCommerz
  └─ `gateway_surjopay`    — SurjoPay
  └─ `gateway_aamarpay`    — Aamarpay
  └─ ... any future gateway
```

- `admin_payments` is a standalone feature. It never depends on any gateway.
- Each gateway is an independent feature. Enabling a gateway does NOT require `admin_payments`.
- Gateways add their config UI to Settings → Payment Gateways section.

### 6.3 Accounting Integration Rules

```
Expense Management (`admin_expenses`) — standalone
  │
  └── If Accounting (`admin_accounting`) is ALSO licensed:
       │
       ▼
       Every expense entry auto-generates accounting journal entries
       (debit Expense Account, credit Cash/Bank Account)
```

**Rules:**
- `admin_expenses` works fully without `admin_accounting`.
- `admin_accounting` is enhanced by `admin_expenses` (adds Expense-to-Journal pipeline).
- `admin_expenses` **never** depends on `admin_accounting`.
- `admin_accounting` consumes `admin_expenses` data — one-way flow.
- Journal entry generation from expenses is automatic and non-configurable.

### 6.4 Soft Dependencies (Graceful Degradation)

Feature works but has reduced functionality without the dependency.

| Feature | Without Dependency |
|---|---|
| `admin_orders` | Works, but cannot auto-deduct stock if `admin_products` inactive (manual stock update) |
| `admin_accounting` | Works without `admin_inventory_valuation` (no inventory cost data in reports). Works without `admin_expenses` (no expense→journal pipeline). |
| `admin_analytics` | Shows basic sales data only, no inventory/financial metrics |

---

## 7. Global UI Hiding & Access Control

### 7.1 Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    KeyMate Server                        │
│  (defines: plan name + list of active feature keys)     │
└────────────────────┬────────────────────────────────────┘
                     │ verify() / checkIn()
                     ▼
┌─────────────────────────────────────────────────────────┐
│              License Engine (@ecomate/license-engine)     │
│  LicenseInfo.features: string[]  ← active feature keys  │
└────────────────────┬────────────────────────────────────┘
                     │
          ┌──────────┴──────────┐
          ▼                     ▼
┌─────────────────┐   ┌──────────────────────┐
│  Frontend        │   │  Backend              │
│  (FeatureFlags   │   │  (FeatureGuard +      │
│   Service +      │   │   @RequiresFeature)   │
│   Sidebar/Hooks) │   │                       │
└─────────────────┘   └──────────────────────┘
```

### 7.2 UI Hiding — Three Layers

**Layer 1 — Sidebar & Navigation** (react component level)
- Sidebar render loop checks `featureFlagsService.canUse(featureKey)` per menu item
- If `false`: menu item removed from DOM (not just `display:none`)
- Also applies to action buttons (e.g., "Print Invoice" button in order list)

**Layer 2 — Route Protection** (TanStack Router `beforeLoad`)
- Every protected route has a `beforeLoad` hook that calls `featureFlagsService.canUse()`
- If denied: redirect to `/license-denied` with feature-specific message

**Layer 3 — Component-Level** (feature gate wrapper component)
- `<FeatureGate feature="admin_print">` wrapper for inline UI elements
- Renders children only if feature active

### 7.3 License-Denied Page (`/license-denied`)

```
┌────────────────────────────────────────────┐
│                                            │
│           🔒  (Lock Icon)                  │
│                                            │
│   Feature Access Restricted                 │
│   ফিচার ব্যবহারের অনুমতি নেই               │
│                                            │
│   [Feature-specific error message]         │
│                                            │
│   ┌──────────────────┐  ┌────────────────┐ │
│   │ Go to Dashboard  │  │ Update License │ │
│   │ (/op/overview)   │  │ (/mon/settings │ │
│   │                  │  │  /license)     │ │
│   └──────────────────┘  └────────────────┘ │
└────────────────────────────────────────────┘
```

### 7.4 Error Message Table

Each feature has a unique Bengali error message for the `/license-denied` page:

| Feature Key | Error Message |
|---|---|
| `storefront` | *"এই স্টোরটি বর্তমানে সক্রিয় নেই।"* |
| `storefront_order_tracking` | *"দুঃখিত, এই স্টোরে পাবলিক অর্ডার ট্র্যাকিং অপশনটি সচল করা নেই।"* |
| `storefront_flying_cart` | (no route — animation silently disabled) |
| `storefront_reviews` | *"এই স্টোরে রিভিউ অপশনটি বর্তমানে নিষ্ক্রিয় রয়েছে।"* |
| `storefront_wishlist` | (redirect to homepage, no message) |
| `storefront_referral` | *"রেফারেল প্রোগ্রামটি এই মুহূর্তে উপলব্ধ নয়।"* |
| `pwa_setup` | (service worker blocked. No message.) |
| `seo_suite` | (default sitemap/robots returned, no message) |
| `offline_conversion` | *"অফলাইন কনভার্সন এপিআই ব্যবহারের জন্য আপনার লাইসেন্সটি আপগ্রেড করুন।"* |
| `integration_ga4` | (API blocks save. Console error.) |
| `integration_tiktok` | (tracking script blocked.) |
| `integration_meta` | *"Meta Pixel CAPI লাইসেন্স সক্রিয় নেই।"* |
| `integration_google_ads` | (Google tag script not injected.) |
| `admin_products` | *"আপনার এই লাইসেন্সে প্রোডাক্ট ম্যানেজমেন্ট অপশনটি নেই। অনুগ্রহ করে লাইসেন্স কী যাচাই করুন।"* |
| `admin_orders` | *"আপনার এই লাইসেন্সে অর্ডার ম্যানেজমেন্ট অপশনটি নেই।"* |
| `admin_customers` | *"আপনার এই লাইসেন্সে কাস্টমার ম্যানেজমেন্ট অপশনটি নেই।"* |
| `admin_brands` | *"আপনার এই লাইসেন্সে ব্র্যান্ড ম্যানেজমেন্ট অপশনটি নেই।"* |
| `admin_settings` | *"আপনার এই লাইসেন্সে সেটিংস অপশনটি নেই।"* |
| `admin_media` | *"আপনার এই লাইসেন্সে মিডিয়া লাইব্রেরি অপশনটি নেই।"* |
| `admin_users` | *"আপনার এই লাইসেন্সে ইউজার ম্যানেজমেন্ট অপশনটি নেই।"* |
| `admin_print` | *"আপনার লাইসেন্স প্ল্যানে ইনভয়েস প্রিন্ট করার অনুমতি নেই।"* |
| `admin_coupons` | *"আপনার এই লাইসেন্সে কুপন ও ডিসকাউন্ট অপশনটি নেই।"* |
| `admin_size_charts` | *"আপনার এই লাইসেন্সে সাইজ চার্ট অপশনটি নেই।"* |
| `admin_combos` | *"আপনার এই লাইসেন্সে কম্বো ম্যানেজমেন্ট অপশনটি নেই।"* |
| `admin_reviews` | *"আপনার এই লাইসেন্সে রিভিউ মডারেশন অপশনটি নেই।"* |
| `admin_import_products` | (API blocked, alert on upload button) |
| `admin_price_tags` | *"আপনার লাইসেন্স প্ল্যানে বারকোড ও প্রাইস ট্যাগ প্রিন্ট করার অনুমতি নেই।"* |
| `admin_suppliers` | *"আপনার এই লাইসেন্সে সাপ্লায়ার ম্যানেজমেন্ট অপশনটি নেই।"* |
| `admin_purchases` | *"আপনার এই লাইসেন্সে পারচেজ অর্ডার অপশনটি নেই।"* |
| `admin_order_import` | *"আপনার এই লাইসেন্সে অর্ডার ইম্পোর্ট অপশনটি নেই।"* |
| `admin_expenses` | *"আপনার এই লাইসেন্সে এক্সপেন্স ম্যানেজমেন্ট অপশনটি নেই।"* |
| `admin_payments` | *"আপনার এই লাইসেন্সে পেমেন্ট ম্যানেজমেন্ট অপশনটি নেই।"* |
| `admin_refunds` | *"আপনার এই লাইসেন্সে রিফান্ড প্রসেসিং অপশনটি নেই।"* |
| `admin_accounting` | *"আপনার এই লাইসেন্সে ডাবল-এন্ট্রি অ্যাকাউন্টিং অপশনটি নেই।"* |
| `admin_financial_periods` | (API blocked for period edits) |
| `admin_payroll` | *"আপনার এই লাইসেন্সে পেরোল ম্যানেজমেন্ট অপশনটি নেই।"* |
| `admin_employees` | *"আপনার এই লাইসেন্সে এমপ্লয়ি ম্যানেজমেন্ট অপশনটি নেই।"* |
| `admin_tasks` | *"আপনার এই লাইসেন্সে টাস্ক ম্যানেজমেন্ট অপশনটি নেই।"* |
| `admin_email_campaigns` | *"আপনার এই লাইসেন্সে ইমেইল ক্যাম্পেইন অপশনটি নেই।"* |
| `admin_landing_pages` | *"আপনার এই লাইসেন্সে ল্যান্ডিং পেজ বিল্ডার অপশনটি নেই।"* |
| `admin_cms_pages` | *"আপনার এই লাইসেন্সে CMS পেজ বিল্ডার অপশনটি নেই।"* |
| `admin_product_feeds` | *"আপনার এই লাইসেন্সে ফিড জেনারেটর অপশনটি নেই।"* |
| `admin_referrals` | *"আপনার এই লাইসেন্সে রেফারেল ম্যানেজমেন্ট অপশনটি নেই।"* |
| `admin_inventory` | *"আপনার এই লাইসেন্সে ইনভেন্টরি ম্যানেজমেন্ট অপশনটি নেই।"* |
| `admin_warehouses` | *"আপনার এই লাইসেন্সে ওয়্যারহাউস অপশনটি নেই।"* |
| `admin_inventory_valuation` | *"আপনার এই লাইসেন্সে ইনভেন্টরি ভ্যালুয়েশন অপশনটি নেই।"* |
| `admin_dispatch` | *"আপনার এই লাইসেন্সে ডিসপ্যাচ সিস্টেম অপশনটি নেই।"* |
| `admin_packing` | *"আপনার এই লাইসেন্সে প্যাকিং ওয়ার্কস্পেস অপশনটি নেই।"* |
| `admin_barcode_search` | (scanner event silently disabled) |
| `admin_incomplete_orders` | *"আপনার এই লাইসেন্সে ইনকমপ্লিট অর্ডার ট্র্যাকিং অপশনটি নেই।"* |
| `admin_global_search` | (search widget not rendered, API returns 403) |
| `courier_steadfast` | (not in courier dropdown. API blocked.) |
| `courier_pathao` | (not in courier dropdown. API blocked.) |
| `courier_redx` | (not in courier dropdown. API blocked.) |
| `courier_carrybee` | (not in courier dropdown. API blocked.) |
| `gateway_bkash` | *"বিকাশ গেটওয়ে পেমেন্ট সার্ভিসটি সাময়িকভাবে বন্ধ রয়েছে।"* |
| `admin_notifications` | *"আপনার এই লাইসেন্সে নোটিফিকেশন কনফিগারেশন অপশনটি নেই।"* |
| `admin_blocking` | *"আপনার এই লাইসেন্সে ব্লক করার অপশনটি নেই।"* |
| `admin_analytics` | *"আপনার এই লাইসেন্সে এডভান্সড এনালিটিক্স অপশনটি নেই।"* |
| `admin_activity_logs` | *"আপনার এই লাইসেন্সে অ্যাক্টিভিটি লগ অপশনটি নেই।"* |
| `admin_help_center` | *"আপনার এই লাইসেন্সে হেল্প সেন্টার ম্যানেজমেন্ট অপশনটি নেই।"* |
| `image_resize_proxy` | (original image served instead of resized. No UI.) |
| `pos_system` | *"আপনার এই লাইসেন্সে POS সিস্টেম অপশনটি নেই।"* |
| `smtp_server` | *"কাস্টম SMTP ব্যবহারের জন্য আপনার লাইসেন্সটি সক্রিয় করুন।"* |
| `s3_storage` | (local disk forced. Config save blocked.) |
| `db_backup` | *"আপনার এই লাইসেন্সে ডাটাবেস ব্যাকআপ অপশনটি নেই।"* |
| `custom_domain` | *"আপনার এই লাইসেন্সে কাস্টম ডোমেইন অপশনটি নেই।"* |

---

## 8. Backend API Protection

### 8.1 Current System (Already Built)

```typescript
// @ecomate/feature-flags
@RequiresFeature('admin_products')  // NestJS decorator
@Controller('products')
export class ProductsController {}
```

`FeatureGuard` (global + route-level) checks the license's active features before allowing controller access.

### 8.2 Updates Needed

1. **Remove `planMin` from featureDefs** — plan mapping comes from KeyMate
2. **Change `FeatureFlag` interface**:

```typescript
// BEFORE
export interface FeatureFlag {
  key: string;
  enabled: boolean;
  planMin: PlanType;  // ← remove this
}

// AFTER
export interface FeatureFlag {
  key: string;
  enabled: boolean;  // ← always true by default; actual state from KeyMate
}
```

3. **LicenseEngine.verify() response** now returns `{ features: string[] }` (list of active feature keys). No plan-specific logic.

4. **FeatureFlagsService** should be initialized from LicenseEngine's active features list:

```typescript
class FeatureFlagsService {
  private activeFeatures: Set<string> = new Set();

  canUse(featureKey: string): boolean {
    return this.activeFeatures.has(featureKey);
  }

  setLicense(licenseInfo: LicenseInfo) {
    this.activeFeatures = new Set(licenseInfo.features);
  }
}
```

### 8.3 Storefront (Next.js) Protection

Add a `FeatureGate` component for the Next.js storefront:

```tsx
// app/components/FeatureGate.tsx
export function FeatureGate({ feature, children, fallback }: {
  feature: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { canUse } = useFeatureFlags();
  if (canUse(feature)) return <>{children}</>;
  return fallback ?? null;
}
```

Example usage: Product Reviews section
```tsx
<FeatureGate feature="storefront_reviews">
  <ReviewsSection productId={product.id} />
</FeatureGate>
```

---

## 9. Courier Feature — Access Control Pattern

Since couriers are individual features, the access control needs special handling:

### 9.1 Courier Settings Page

```typescript
// Available couriers = intersection of system-supported couriers & user's licensed couriers
const LICENSED_COURIERS = [
  { key: 'courier_steadfast', name: 'Steadfast', ... },
  { key: 'courier_pathao',    name: 'Pathao',    ... },
  { key: 'courier_redx',      name: 'RedX',      ... },
  { key: 'courier_carrybee',  name: 'Carrybee',  ... },
].filter(c => featureFlags.canUse(c.key));
```

- If `LICENSED_COURIERS.length === 0`: Courier Settings tab is **hidden entirely**
- If `LICENSED_COURIERS.length > 0`: Courier Settings tab shows ONLY licensed couriers

### 9.2 Dispatch/Order Courier Dropdown

Same filtering — only licensed couriers appear as options.

---

## 10. Feature Dependency Enforcement

### 10.1 Frontend Dependency Check

When the license syncs, the frontend should validate dependencies:

```typescript
const DEPENDENCY_MAP: Record<string, string[]> = {
  admin_warehouses: ['admin_inventory'],
  admin_purchases: ['admin_suppliers', 'admin_inventory'],
  admin_financial_periods: ['admin_accounting'],
  // ... etc
};

function validateDependencies(activeFeatures: string[]): string[] {
  const featureSet = new Set(activeFeatures);
  return activeFeatures.filter(f => {
    const deps = DEPENDENCY_MAP[f];
    return !deps || deps.every(d => featureSet.has(d));
  });
  // Features with unmet deps are silently excluded from activeFeatures
}
```

### 10.2 Backend Validation

`FeatureGuard` should also check dependencies before allowing route access.

---

## 11. Order State Machine — Business Logic Documentation

> **Important:** This section does NOT redesign or replace the existing order state machine. It documents the business logic (stock, payment, accounting, etc.) that executes at each **existing** state. No new order statuses should be introduced unless separately approved.

### 11.1 Order States

The OrderStatus is a **dynamic model**, not an enum. Statuses and transitions are configurable via the `admin_order_statuses` feature. Below is the **default seed** that ships with the system.

```
                   ┌───────────── Payment Pending ─────────────┐
                   │                    │                       │
Pending ─────┬─────┼──── Payment Verifying                      │
             │     │                    │                       │
             │     └──── Confirmed ◄────┘                       │
             │             │                                    │
             │      ┌──────┴──────┐                             │
             │      │             │                             │
             │   Packed      Packing Hold                       │
             │      │             │                             │
             │      └──────┬──────┘                             │
             │             │                                    │
             │         Shipping                                 │
             │             │                                    │
             │      ┌──────┴──────┐                             │
             │      │             │                             │
             │  Delivered     Partial                           │
             │      │             │                             │
             │      └──────┬──────┘                             │
             │             │                                    │
             │      Return Pending                              │
             │          /      \                                │
             │     Returned   Damaged (final)                   │
             │                                                  │
             ├── Hold ────→ Confirmed / Pending / Cancelled     │
             │                                                  │
             └── Cancelled ──→ Confirmed (reactivation)         │
```

### 11.2 State Transition Behavior

| # | State | Trigger | Managed Stock Action | Inventory Action | Payment Action | Expense Action | Marketing Attribution | Employee Commission | Accounting Action | Analytics Impact |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Pending** | Customer places order | No change | No change | No change (payment not yet verified) | None | Fire Purchase event (GA4/TikTok/Meta) | Record potential commission (unlocked) | No entry | Sales count +1 (pending) |
| 2 | **Payment Pending** | System detects awaiting payment | No change | No change | Awaiting payment confirmation | None | No change | No change | No entry | No change |
| 3 | **Payment Verifying** | Admin reviewing payment proof | No change | No change | Manual verification in progress | None | No change | No change | No entry | No change |
| 4 | **Hold** | Admin places order on hold | No change | No change | No change | None | No change | No change | No entry | No change |
| 5 | **Confirmed** | Admin confirms order | `ORDER_DEDUCTION / OUT` from `Product.managedStockQuantity` → `ManagedStockLedger` | For INV_CONTROLLED items: `inventory_reservation` created | Mark payment as confirmed | None | Fire Purchase event (if not fired at Pending) | Lock commission amount | No entry (order receivable deferred to Delivered) | Sales count confirmed. Revenue in pending reports. |
| 6 | **Packed** | Packer marks done | No change | For INV_CONTROLLED: allocation finalized → `inventory_issue / OUT`. Stock physically moved to dispatch area. | No change | Record packing supply cost (if expense tracking enabled) | No change | No change | No entry | Packing metric updated |
| 7 | **Packing Hold** | Packing paused | No change | No change | No change | None | No change | No change | No entry | No change |
| 8 | **Shipping** | Courier assigned / tracking updated | No change | No change | No change | Record courier charge as expense | No change | No change | No entry | Shipping metric updated |
| 9 | **Delivered** | Customer receives | No change | No change | Auto-confirm payment (if not already). Mark as completed. | Record delivery cost (if any) | Fire Purchase event with revenue (if deferred) | Commission becomes payable | **Journal entries created:** Dr. Cash/Bank, Cr. Sales Revenue, Cr. COGS (if cost snapshot available). Dr. COGS, Cr. Inventory/Stock. | Revenue recorded. COGS recorded. Profit calculated. |
| 10 | **Partial** | Partial delivery completed | No change | Inventory partially issued for delivered items | Partial payment may be confirmed | Record partial delivery cost | No change | Partial commission | Partial revenue booked | Partial metrics updated |
| 11 | **Return Pending** | Customer requests return | No change | No change (return not yet processed) | No change | None | No change | No change | No entry | Return request counted |
| 12 | **Returned** | Return accepted, product received | `RETURN / IN` — stock added back → `ManagedStockLedger` | For INV_CONTROLLED: `inventory_return / IN` — stock back to warehouse. May trigger quality check. | No change (refund is a separate, independent process) | Record return processing cost | Fire Return event (GA4/TikTok/Meta). Refund (if any) fires a separate Refund event. | Reverse or adjust commission | **Reverse original sale entry:** Dr. Sales Returns, Cr. Inventory (if restocked) | Return metrics recorded |
| 13 | **Damaged** | Product damaged in return | No change | Inventory write-off. Stock removed from available. | No change | Record loss/write-off amount | No change | No change | **Write-off entry:** Dr. Loss from Damage, Cr. Inventory | Damage metric recorded |
| 14 | **Cancelled** | Admin cancels order | `CANCEL_RELEASE / IN` — stock added back to `Product.managedStockQuantity` → `ManagedStockLedger` | For INV_CONTROLLED: `inventory_reservation` released. Stock returns to available. | Release payment hold (if any). Initiate refund separately if paid. | Reverse any recorded expenses | Void attribution event | Cancel commission | Reverse any provisional entries | Removed from sales metrics. Cancellation rate updated. |

### 11.3 State-Specific Rules

**State transition protection (per `nextStatuses` DB config):**
- Pending → Payment Pending, Hold, Confirmed, or Cancelled
- Confirmed → Packed, Packing Hold, or Cancelled
- Returns only possible after Shipping → Delivered/Partial → Return Pending → Returned
- Cancelled can reactivate to Confirmed
- Damaged is the only true final state (no outgoing transitions)
- Returned → Damaged if product arrives damaged

**Refund is NOT an order status:**
- Refund is tracked via **`PaymentStatus`** (`PAYMENT_PENDING` → `PAID` → `REFUNDED`) and the **Refund** model, NOT the OrderStatus model
- `admin_refunds` (#33) handles refund processing as an independent payment-domain module
- Issuing a refund does NOT change Order Status, Dispatch Status, or stock levels
- Refund and Return are independent workflows: Return = product movement, Refund = money movement

**Duplicate restock prevention:**
- `restockOrderItems()` method checks `InventoryLog` for existing `refund_restock` / `cancellation_restock` entries before re-restocking
- Same guard applies to `ManagedStockLedger`:

```typescript
const alreadyRestocked = await prisma.managedStockLedger.findFirst({
  where: {
    referenceType: 'ORDER',
    referenceId: orderId,
    type: { in: ['RETURN', 'CANCEL_RELEASE'] },
  },
});
if (alreadyRestocked) return; // or throw
```

---

## 12. Analytics Capability Matrix

Analytics is a **progressive** feature — more modules means richer dashboards.

### 12.1 Dependency Model

`admin_analytics` (#59) is a standalone license feature. Its capabilities expand based on which other business modules are also licensed.

### 12.2 Matrix: What Appears with Which License

| If Licensed | Dashboard Widgets | KPIs Available | Reports Available | Hidden Metrics |
|---|---|---|---|---|
| Only `storefront` + `admin_orders` (#15) | Sales overview, Order count, Revenue chart | Total sales, Order count, AOV | Sales report, Order report | Product-level metrics, COGS, Profit, Inventory |
| + `admin_products` (#14) | Top products, Category breakdown, Stock alerts | Top 10 products, Category-wise sales, Low stock count | Product sales report, Category performance | COGS, Profit margin, Inventory value |
| + `admin_inventory` (#44) | Inventory valuation, Stock movement, Warehouse utilization | Stock value, Inventory turnover, Reorder points | Inventory valuation report, Stock movement report | COGS by batch (unless costing used) |
| + `admin_accounting` (#34) | Profit & Loss summary, Balance sheet snapshot | Gross profit, Net profit, Expense ratio, Cash flow | P&L report, Balance sheet, Trial balance | Nothing hidden — all financial KPIs available |
| + `admin_inventory_valuation` (#46) | FIFO cost breakdown, Margin analysis by batch | Actual COGS, Profit margin per batch | Cost analysis report, Margin by product | — |
| + `admin_expenses` (#31) | Expense breakdown, Category-wise spend | Total expense, Expense by category, Expense ratio | Expense report, Category-wise spend | — |
| + `integration_ga4` (#10) + others (#11-13) | Channel performance, ROAS, Attribution | Traffic by source, Conversion rate, ROAS | Channel report, Attribution report, Funnel analysis | — (all available) |
| + `admin_customers` (#16) | New vs returning, Customer lifetime value | Customer count, Repeat rate, CLV | Customer report, Retention analysis | — |

### 12.3 Graceful Degradation

When `admin_analytics` is NOT licensed:
- The main "Analytics" sidebar link is hidden
- Dashboard shows basic summary cards (total sales, order count, customer count) — NO charts, NO filters, NO export
- API returns 403 for any analytics endpoint

When `admin_analytics` IS licensed but supporting modules are NOT:
- Analytics dashboard loads with limited widgets
- Missing data sources show empty state with upgrade prompt: *"Inventory Management license required for stock valuation metrics"*
- API returns partial data — never throws errors for missing dependencies

---

## 13. Cost Snapshot Strategy

### 13.1 The Two-Tier Costing Model

Every Product and Variant has a manual **`standardCost`** (Estimated Cost) field. This field provides Estimated COGS and Profit calculations when Inventory Management is not licensed. It is set and maintained within Product Management (#14).

| Tier | Name | Source | Used When | Accuracy | `standardCost` Behavior |
|---|---|---|---|---|---|
| Standard Cost | Estimated COGS | `Product.standardCost` field (manual, per product/variant) | Managed Stock mode or no Inventory license | Estimated | **Required.** Source of truth for profit calculations. |
| Inventory Cost | Actual COGS | `CostingLot.unitCost` (FIFO) + `InventoryLog` | Inventory Controlled mode | Actual | **Optional / informational.** Actual COGS comes from Inventory Costing. `standardCost` is preserved but not used for P&L. |

### 13.2 Snapshot Mechanism

When an order item is created, the system **freezes** the cost at that moment:

```prisma
model OrderItem {
  // ... existing fields ...
  costSnapshot   Decimal?  @db.Decimal(10, 2)  // frozen unit cost at time of sale
  costType       String?   // 'estimated' | 'actual' — indicates snapshot source
}
```

**Snapshots happen at order CONFIRMATION** (state transition from Confirmed):

```typescript
// Pseudocode
for (const item of order.items) {
  if (product.availabilityMode === 'MANAGED_STOCK' || !hasInventoryLicense) {
    item.costSnapshot = product.standardCost;    // Estimated — from Product Management
    item.costType = 'estimated';
  } else if (product.availabilityMode === 'INVENTORY_CONTROLLED') {
    item.costSnapshot = getFifoCost(product.id); // Actual — from Inventory Costing
    item.costType = 'actual';
  }
}
```

### 13.3 Historical Integrity

```
┌─────────────────────────────────────────────────────────────────┐
│  UPGRADE EVENT                                                 │
│  User moves from Managed Stock (Basic) → Inventory (Full ERP)  │
│                                                                 │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ Pre-Upgrade  │    │ Upgrade     │    │ Post-Upgrade│         │
│  │ Orders       │───▶│ Happens     │───▶│ Orders      │         │
│  │              │    │              │    │              │         │
│  │ costSnapshot │    │ NO CHANGE   │    │ costSnapshot │         │
│  │ = estimated  │    │ to existing  │    │ = actual     │         │
│  │ costType     │    │ order items  │    │ costType     │         │
│  │ = 'estimated'│    │              │    │ = 'actual'   │         │
│  └─────────────┘    └─────────────┘    └─────────────┘          │
│                                                                 │
│  Reports show: "Estimated Profit" badge for pre-upgrade orders  │
│  Reports show: "Actual Profit" badge for post-upgrade orders    │
└─────────────────────────────────────────────────────────────────┘
```

**Cardinal rule:** A license upgrade must NEVER recalculate historical COGS. Cost snapshots are immutable once created.

### 13.4 Reporting UI

| Scenario | Report Label | Data Source |
|---|---|---|
| All orders before upgrade | Estimated Profit | `OrderItem.costSnapshot` where `costType = 'estimated'` |
| All orders after upgrade | Actual Profit | `OrderItem.costSnapshot` where `costType = 'actual'` |
| Mixed (partial Inventory) | "Estimated / Actual" dual column | Both cost types in same report |

---

## 14. License Upgrade & Downgrade Rules

### 14.1 Basic → Inventory Upgrade

| Aspect | Behavior |
|---|---|
| **Existing products** | `availabilityMode` stays at `MANAGED_STOCK` (existing products are NOT auto-converted to Inventory Controlled). Admin must manually switch per product. |
| **Existing orders** | Cost snapshots remain `estimated`. Never recalculated. |
| **Existing inventory log** | `ManagedStockLedger` entries remain as-is. Physical inventory starts fresh via Inventory module. |
| **New products** | Can now select `INVENTORY_CONTROLLED` mode. |
| **New orders** | Use `actual` cost from `CostingLot` for Inventory Controlled items. |
| **Reports** | Show "Estimated Profit" for old orders, "Actual Profit" for new orders. Filters available to view either. |

### 14.2 Inventory → Basic Downgrade

| Aspect | Behavior |
|---|---|
| **Existing products** | All `INVENTORY_CONTROLLED` products revert to `MANAGED_STOCK` automatically. The last known `Product.managedStockQuantity` (the quantity that was displayed as read-only during Inventory mode) is carried forward as the managed stock quantity. It is NOT a live sync — it is a one-time carryover. |
| **Existing inventory data** | Inventory data becomes **READ-ONLY**. Inventory Management UI is hidden. Warehouses, bin locations, CostingLot data preserved in DB but not modifiable. |
| **Existing orders** | Cost snapshots remain `actual`. Never changed. |
| **Pending inventory operations** | All pending inventory reservations, allocations, and transfers are cancelled. Stock is reconciled. |
| **Warehouses** | Warehouse assignment on products becomes decorative (visible but non-functional). |
| **Reports** | Inventory valuation reports disappear from Analytics. Only estimated profit shown for new orders. Historical actual profit data still viewable (read-only). |

### 14.3 Historical Data Visibility

| Data Type | After Upgrade | After Downgrade |
|---|---|---|
| ManagedStockLedger | Read-write (still active for managed stock items) | Read-write |
| InventoryLog | Read-write | Read-only (preserved but frozen) |
| CostingLot | Read-write | Read-only |
| Cost snapshots on orders | Immutable | Immutable |
| Inventory valuation reports | Available | Hidden from UI |
| Warehouse management | Available | Hidden from UI |

### 14.4 Reporting Differences

| Report Section | Basic License | Inventory License |
|---|---|---|
| Cost of Goods Sold (COGS) | Estimated only (based on standard cost snapshot) | Actual COGS for Inventory Controlled items + Estimated for rest |
| Gross Profit | Estimated Gross Profit | Actual Gross Profit + Estimated Profit badge |
| Inventory Valuation | ❌ Hidden | ✅ Full report |
| Stock Movement | Managed Stock movements only | Full inventory movements + warehouse transfers |
| Profit by Product | Based on estimated cost | Based on actual FIFO cost (if Inventory Controlled) |

---

## 15. ManagedStockQuantity vs Inventory Available Quantity — Independence

### 15.1 Core Principle

> **Managed Stock Quantity and Inventory Available Quantity must NEVER be synchronized automatically.**
> They are two independent business domains that serve different purposes.

```
┌─────────────────────────────┐     ┌──────────────────────────────────┐
│  MANAGED STOCK QUANTITY     │     │  INVENTORY AVAILABLE QUANTITY    │
│                             │     │                                  │
│  Owned by: Product Mgmt     │     │  Owned by: Inventory Mgmt        │
│  Stored in: managedStockQty  │     │  Calculated from: Warehouse      │
│  Logged in: ManagedStockLedger│   │  stock - reservations            │
│  Purpose: Sales availability │     │  Logged in: InventoryLog         │
│  For: Simple e-commerce      │     │  Purpose: Physical fulfillment   │
│                              │     │  For: Multi-warehouse operations │
└─────────────────────────────┘     └──────────────────────────────────┘
           │                                       │
           │       NO SYNC — EVER                  │
           └───────────────────────────────────────┘
```

### 15.2 When Each is Read

| Scenario | Reads From |
|---|---|
| Storefront product page (mode = MANAGED_STOCK) | `Product.managedStockQuantity` |
| Storefront product page (mode = INVENTORY_CONTROLLED) | Inventory Available Quantity |
| Admin product edit form (mode = MANAGED_STOCK) | `Product.managedStockQuantity` (read-write) |
| Admin product edit form (mode = INVENTORY_CONTROLLED) | Inventory Available Quantity (read-only display) |
| Order fulfillment (mode = MANAGED_STOCK) | `Product.managedStockQuantity` — deducts here |
| Order fulfillment (mode = INVENTORY_CONTROLLED) | Inventory — reserves/allocates/issues here |
| Low stock alerts (mode = MANAGED_STOCK) | `Product.managedStockQuantity` vs `lowStockQty` |
| Low stock alerts (mode = INVENTORY_CONTROLLED) | Inventory module's low stock calculation |
| Inventory valuation report | Inventory Cost (via CostingLot) |
| Basic profit report | Snapshot from `OrderItem.costSnapshot` |

### 15.3 What Happens During Each Mode

| Mode | managedStockQuantity | Inventory Available Qty | Storefront Reads |
|---|---|---|---|
| Always In Stock | Ignored | Ignored | Always shows "In Stock" |
| Always Out Of Stock | Ignored | Ignored | Always shows "Out of Stock" |
| Managed Product Stock | **Source of truth** (read-write) | Ignored | `Product.managedStockQuantity` |
| Inventory Controlled | Display-only (read-only snapshot) | **Source of truth** | Inventory Available Qty |

### 15.4 Available Quantity vs On Hand Quantity

For Inventory Controlled mode, the storefront must check **Available Quantity**, not On Hand Quantity:

```
Available Quantity = On Hand Quantity - Reserved Quantity - Allocated Quantity
```

Where:
- **On Hand:** Total physical stock in all warehouses
- **Reserved:** Stock locked by confirmed orders (not yet picked)
- **Allocated:** Stock picked for packing (not yet shipped)
- **Available:** What can actually be sold RIGHT NOW

```typescript
function getStorefrontAvailability(productId: string): number {
  const inventory = await inventoryService.getAvailableQuantity(productId);
  // Available = sum of all warehouse stock - reserved - allocated - quarantined
  return inventory.available;
}
```

---

## Appendix A: Feature List — Mapping from Old 79 → New 72

| Old Key (79) | New Key (72) | Status |
|---|---|---|
| `storefront_catalog` | `storefront` | Absorbed |
| `storefront_detail` | `storefront` | Absorbed |
| `storefront_categories` | `storefront` | Absorbed |
| `storefront_brands` | `storefront` | Absorbed |
| `storefront_tags` | `storefront` | Absorbed |
| `storefront_search` | `storefront` | Absorbed |
| `storefront_cart` | `storefront` | Absorbed |
| `storefront_checkout` | `storefront` | Absorbed |
| `storefront_orders` | `storefront` | Absorbed |
| `storefront_account` | `storefront` | Absorbed |
| `storefront_cms_pages` | `storefront` | Absorbed |
| `storefront_combos` | `storefront` | Absorbed |
| `storefront_reviews` | `storefront_reviews` | Renamed |
| `storefront_wishlist` | `storefront_wishlist` | Renamed |
| `storefront_delivery` | `storefront` | Absorbed |
| `storefront_referral` | `storefront_referral` | Renamed |
| `storefront_landing` | `admin_landing_pages` | Already admin feature |
| `admin_dashboard` | `admin_orders` (implied) | Absorbed (always available with any admin feature) |
| `admin_products` | `admin_products` | ✅ Kept (scope expanded) |
| `admin_orders` | `admin_orders` | ✅ Kept |
| `admin_order_statuses` | `admin_orders` | Absorbed |
| `admin_customers` | `admin_customers` | ✅ Kept |
| `admin_categories` | `admin_products` | Absorbed |
| `admin_brands` | `admin_brands` | ✅ Kept |
| `admin_settings` | `admin_settings` | ✅ Kept |
| `admin_print` | `admin_print` | ✅ Kept |
| `admin_attributes` | `admin_products` | Absorbed |
| `admin_size_charts` | `admin_size_charts` | ✅ Kept |
| `admin_tags` | `admin_products` | Absorbed |
| `admin_combos` | `admin_combos` | ✅ Kept |
| `admin_coupons` | `admin_coupons` | ✅ Kept |
| `admin_reviews` | `admin_reviews` | ✅ Kept |
| `admin_suppliers` | `admin_suppliers` | ✅ Kept |
| `admin_purchases` | `admin_purchases` | ✅ Kept |
| `admin_inventory` | `admin_inventory` | ✅ Kept (scope refined) |
| `admin_expenses` | `admin_expenses` | ✅ Kept |
| `admin_shipments` | `admin_dispatch` | Renamed/re-scoped |
| `admin_courier` | (removed) | Replaced by individual courier features |
| `admin_payments` | `admin_payments` | ✅ Kept |
| `admin_refunds` | `admin_refunds` | ✅ Kept |
| `admin_media` | `admin_media` | ✅ Kept |
| `admin_import` | `admin_import_products` | Renamed |
| `admin_checkout_leads` | `admin_incomplete_orders` | Renamed |
| `admin_staff_users` | `admin_users` | Renamed |
| `admin_notifications` | `admin_notifications` | ✅ Kept |
| `admin_accounting` | `admin_accounting` | ✅ Kept |
| `admin_payroll` | `admin_payroll` | ✅ Kept |
| `admin_employees` | `admin_employees` | ✅ Kept |
| `admin_campaigns` | `admin_email_campaigns` | Renamed |
| `admin_landing_pages` | `admin_landing_pages` | ✅ Kept |
| `admin_cms` | `admin_cms_pages` | Renamed |
| `admin_blocking` | `admin_blocking` | ✅ Kept |
| `admin_analytics` | `admin_analytics` | ✅ Kept |
| `admin_activity_logs` | `admin_activity_logs` | ✅ Kept |
| `admin_tracking` | (split) | → `integration_ga4`, `integration_tiktok`, `integration_meta`, `integration_google_ads` |
| `admin_tasks` | `admin_tasks` | ✅ Kept |
| `admin_referrals` | `admin_referrals` | ✅ Kept |
| `admin_inventory_valuation` | `admin_inventory_valuation` | ✅ Kept |

---

## Appendix B: ManagedStockLedger — Movement Type Reference

| Type | Direction | When Triggered | referenceType |
|---|---|---|---|
| `INITIAL` | IN | First time stock is set for a product | MANUAL |
| `ORDER_DEDUCTION` | OUT | Order confirmed (Managed Stock mode) | ORDER |
| `MANUAL_ADD` | IN | Admin manually adds stock | MANUAL |
| `MANUAL_REMOVE` | OUT | Admin manually removes stock | MANUAL |
| `ADJUSTMENT` | IN/OUT | Admin sets specific quantity (overwrite) | ADJUSTMENT |
| `RETURN` | IN | Customer return — product comes back, stock restored | RETURN |
| `CANCEL_RELEASE` | IN | Order cancellation releases reserved stock | ORDER |

**Important:** `CANCEL_RELEASE` is only relevant for the reservation step. In Managed Stock mode, cancellation simply adds stock back via `RETURN`.

---

## 16. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

1. **Update `shared-types/src/license-types.ts`**
   - Remove `planMin` from all features
   - Replace with new 72-feature list
   - Add `DEPENDENCY_MAP` constant
   - Add enums: `ManagedStockMovementType`, `MovementDirection`, `ReferenceEntity`, `AvailabilityMode`

2. **Add `ManagedStockLedger` to Prisma schema**
   - Run migration

3. **Update Product model**
   - Add `availabilityMode` field (enum)
   - Add `costType` and `costSnapshot` to `OrderItem` model
   - Data migration: `manageStock=false` → `ALWAYS_IN_STOCK`, `manageStock=true` → `MANAGED_STOCK`

### Phase 2: License Engine Updates (Week 2-3)

4. **Update `@ecomate/license-engine`**
   - Remove `planMin` checking logic
   - `verify()` returns raw feature list from KeyMate

5. **Update `@ecomate/feature-flags`**
   - Remove `planMin` from `FeatureFlag` type
   - Add `validateDependencies()` to `FeatureFlagsService`
   - Update `@RequiresFeature` decorator to check dependencies

6. **Update Backend `FeatureGuard`**
   - Remove `planMin` checks
   - Add dependency validation

### Phase 3: Admin UI — Navigation & Route Protection (Week 3-4)

7. **Update Sidebar Navigation**
   - Map all 72 sidebar items to new feature keys
   - Add `canUse()` checks per menu item

8. **Add Route Protection**
   - `beforeLoad` hooks on all protected routes
   - Shared `requireFeature()` route guard utility

9. **Build `/license-denied` Page**
   - 72 feature-specific error messages
   - Lock icon + "Go to Dashboard" + "Update License" buttons

10. **Update Courier UI**
    - Courier settings: filter by licensed couriers
    - Dispatch dropdown: filter by licensed couriers

### Phase 4: Product Availability Modes & ManagedStockLedger (Week 4-6)

11. **Implement `ManagedStockLedgerService`**
    - Record all movements with `stockBefore`/`stockAfter` snapshots
    - Support: initial, order deduction, manual add/remove, adjustment, return, cancel release
    - Duplicate restock prevention guard

12. **Update Product Form UI**
    - `availabilityMode` dropdown (4 modes)
    - Dynamic field visibility per mode
    - Inventory Controlled: read-only stock, "Managed by Inventory" badge

13. **Implement Cost Snapshot on Order Confirmation**
    - On Pending → Confirmed: freeze cost per `OrderItem`
    - `costType` = `'estimated'` or `'actual'`
    - Use `CostingLot` for actual FIFO costing

14. **Update Order Fulfillment**
    - MANAGED_STOCK → `ManagedStockLedger.ORDER_DEDUCTION`
    - INVENTORY_CONTROLLED → Inventory reservation/allocation/issue
    - ALWAYS_IN_STOCK → no deduction
    - ALWAYS_OUT_OF_STOCK → block placement

### Phase 5: Order State Machine (Week 5-6)

15. **Implement state transition guards**
    - Prevent invalid transitions (Section 11.3 rules)
    - Per-state side effects engine

16. **Implement per-state side effects**
    - Stock actions at each state
    - Payment confirmation at DELIVERED
    - Expense recording at Packed / Shipping / Delivered
    - Commission locking/payable
    - Accounting journal entries at DELIVERED
    - Marketing attribution events per state

17. **Implement duplicate restock prevention**
    - `ManagedStockLedger`: check existing RETURN/CANCEL_RELEASE
    - `InventoryLog`: check existing refund_restock/cancellation_restock

### Phase 6: Analytics & Reporting (Week 6-7)

18. **Implement Analytics Capability Matrix**
    - Contextual widgets per licensed module combination
    - Empty states with upgrade prompts
    - Partial data API (no errors for missing deps)

19. **Cost Type badges in reports**
    - "Estimated Profit" / "Actual Profit" labels
    - Dual-column reports for mixed license scenarios

20. **Historical data preservation**
    - Inventory data read-only on downgrade
    - InventoryLog/CostingLot freeze on downgrade

### Phase 7: Storefront Feature Gating (Week 7-8)

21. **Add `FeatureGate` component** for Next.js storefront
22. **License sync** — SSR via API route + CSR via hook
23. **Gate premium features** — reviews, wishlist, flying cart, tracking, referral

### Phase 8: Upgrade/Downgrade & Testing (Week 8-10)

24. **Upgrade flow** (Basic → Inventory)
    - Manual per-product mode switch
    - Cost snapshot preservation
    - Reporting continuity

25. **Downgrade flow** (Inventory → Basic)
    - Auto-revert `INVENTORY_CONTROLLED` → `MANAGED_STOCK`
    - Freeze inventory data to read-only
    - Hide inventory UI

26. **Full dependency matrix testing**
    - 72 features individually
    - Dependencies with/without parent
    - Courier combinations

27. **Error message QA**
    - 72 messages on `/license-denied`
    - Sidebar, route, component level

28. **Edge cases**
    - License expires mid-session
    - License downgrade while running
    - Multiple tabs, race conditions, concurrent stock operations

---

*End of Plan*
