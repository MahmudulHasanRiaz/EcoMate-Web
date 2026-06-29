# KeyMate + EcoMate Architecture

## 1. System Overview

Two independent systems working together for SaaS licensing:

### KeyMate (Licensing Server)
- **Location:** `KeyMate-2/backend/`
- **Stack:** Ruby on Rails + Keygen CE
- **Role:** Central licensing server — issues, verifies, and manages product licenses
- **Database:** PostgreSQL (Keygen native tables + custom SaaS tables)
- **Key Dependencies:** Redis (background jobs via Sidekiq), Keygen CE engine

### EcoMate (E-Commerce Platform)
- **Location:** `EcoMate Web/`
- **Stack:** NestJS (backend API) + Next.js (storefront/admin)
- **Role:** Multi-tenant e-commerce platform with feature gating based on license
- **Database:** PostgreSQL (Prisma ORM)
- **Key Dependencies:** `@ecomate/license-engine` (license verification client), `@ecomate/feature-flags` (NestJS feature guard)

## 2. Data Flow

```
Customer buys license → KeyMate creates License → generates API Key (Token)

EcoMate startup → LicenseService.onModuleInit()
  → LicenseEngine.verify(licenseKey, domain, apiKey)
  → HTTP POST to KeyMate /v1/saas/licenses/verify
  → VerifyLicenseService validates license, domain, computes features
  → Returns {valid, plan, features[], limits[], domains[], expiry}
  → EcoMate caches response locally for 7-day offline grace

On each request → FeatureGuard checks @RequiresFeature metadata
  → FeatureFlagsService.canUse(featureKey)
  → Checks cached features from LicenseEngine
  → true → continue | false → 403 Forbidden

On verify failure → check local disk cache (license-cache.json)
  → Cache hit with detail: 'offline_cache' → allow
  → Cache miss → reject with {valid: false, code: 'unreachable'}
```

## 3. Key Components

### KeyMate Server Side

#### SaasController (`app/controllers/api/v1/saas_controller.rb`)
3 **public endpoints** (no auth required — validated via API key headers):
- `POST /v1/saas/licenses/verify` — Main license verification
- `POST /v1/saas/licenses/:id/check-in` — Verify + refresh last_check_in_at
- `GET /v1/saas/licenses/:id/status` — Status check (alias for verify)

30+ **admin endpoints** (auth + authorization required) for:
- Dashboard analytics, Orders CRUD, Payments CRUD, Plans CRUD
- Entitlements/Metrics management, Expenses tracking
- Plan subscriptions and wallet management

#### VerifyLicenseService (`app/services/saas/verify_license_service.rb`)
Core verification logic:
1. Finds license by `license_key` or resolves by `api_key` via TokenLookupService
2. Validates license status (not banned/suspended)
3. Runs standard LicenseValidationService (checks expiry, policy, etc.)
4. Loads associated Saas::Order — checks status and domain whitelist
5. Returns features from plan entitlements + limits from plan_metrics

#### seed_products.rake (`lib/tasks/keygen/seed_products.rake`)
Seeds the entire EcoMate product definition:
- **59 entitlements** (feature flags) across 3 tiers
- **5 metrics** (max_staff_users, max_products, max_monthly_orders, storage_gb, max_customers)
- **8 plans** (Essential/Growth/Enterprise/Ultimate × Subscription/One-Time)
- 1 policy (EcoMate Default — TOKEN auth, machine_limit=1)

#### generate_order_api_key
Creates a Keygen Token scoped to a license with `license.validate`, `machine.create`, `machine.check_out` permissions. Returns the raw token for API-based verification.

### EcoMate Server Side

#### @ecomate/license-engine (`packages/license-engine/src/`)
4 files:
- **api-client.ts** — HTTP client to KeyMate. Sends POST to `/licenses/verify` with `X-API-Key` header. 10s timeout.
- **cache.ts** — File-based JSON cache at `~/.ecomate/cache/license-cache.json`. TTL configurable (default 7-day grace period).
- **types.ts** — TypeScript types: `LicenseInfo`, `LicenseInfo`, `LimitResult`
- **index.ts** — `LicenseEngine` class: verify(), checkIn(), canUseFeature(), checkLimit(), setLicense(), getLicense(). Singleton pattern with `getDefaultEngine()`.

Verification flow:
1. Try HTTP POST to KeyMate with 10s timeout
2. On success → cache result and return
3. On failure (network error / timeout) → check file cache
4. Cache hit (within grace period) → return with `detail: 'offline_cache'`
5. Cache miss → return `{valid: false, code: 'unreachable'}`

#### @ecomate/feature-flags (`packages/feature-flags/src/`)
4 files:
- **decorator.ts** — `@RequiresFeature('feature_key')` decorator using NestJS `SetMetadata`
- **guard.ts** — `FeatureGuard` implementing `CanActivate`. Reads `REQUIRES_FEATURE_KEY` metadata from handler/class, checks `FeatureFlagsService.canUse()`
- **index.ts** — `FeatureFlagsService` (NestJS Injectable). Wraps LicenseEngine. Dev mode fallback when engine is unavailable. `canUse()` returns true in dev mode, delegates to `LicenseEngine.canUseFeature()` in production.
- **__tests__/** — Unit tests for guard and service

#### Feature Guard Registration
In `app.module.ts`, `FeatureGuard` is registered as a global `APP_GUARD`:
```typescript
{ provide: APP_GUARD, useClass: FeatureGuard }
```
Guard chain order: JwtAuthGuard → RolesGuard → ThrottlerGuard → FeatureGuard

#### LicenseService (`apps/backend/src/license/license.service.ts`)
`OnModuleInit` — initializes at application startup:
1. Reads `LICENSE_KEY`, `KEYMATE_API_URL`, `DOMAIN`, `KEYMATE_API_KEY` from config
2. Calls `FeatureFlagsService.initialize()` which calls `LicenseEngine.verify()`
3. If KeyMate unreachable, falls back to `LICENSE_TOKEN` (cached JWT with pre-verified data)
4. If no token either, enables dev mode (all features unrestricted)

#### 48 Feature-Gated Controllers

Breakdown by feature:

| Feature Key | Controllers | Count |
|---|---|---|
| `admin_products` | ProductsController | 7 methods |
| `admin_orders` | OrdersController | 12 methods |
| `admin_payments` | GatewayConfigController, PaymentsController | 14 methods |
| `admin_customers` | CustomersController | 1 class-level |
| `admin_categories` | CategoriesController | 3 methods |
| `admin_brands` | BrandsController | 3 methods |
| `admin_dashboard` | DashboardController | 1 class-level |
| `admin_settings` | SettingsController, SystemSettingsController | 7 methods |
| `admin_staff_users` | UsersController | 1 class-level |
| `admin_coupons` | CouponsController | (via module) |
| `admin_courier` | CourierController | (via module) |
| `admin_media` | MediaController | (via module) |
| `admin_inventory` | InventoryController | (via module) |
| `admin_import` | ImportController | (via module) |
| `admin_reviews` | ReviewsController | 3 methods |
| `admin_tags` | TagsController | 7 methods |
| `admin_notifications` | NotificationsController | (via module) |
| `admin_attributes` | AttributesController | (via module) |
| `admin_purchases` | PurchasesController | (via module) |
| `admin_suppliers` | SuppliersController | (via module) |
| `admin_expenses` | ExpensesController | (via module) |
| `admin_shipments` | ShipmentController | (via module) |
| `admin_size_charts` | SizeChartsController | 5 methods |
| `admin_order_statuses` | OrderStatusController | 1 class-level |
| `admin_checkout_leads` | CheckoutLeadsController | 8 methods |
| `admin_combos` | CombosController | 3 methods |
| `admin_refunds` | RefundsController | (via module) |
| `admin_staff_users` | UsersController | 1 class-level |
| `admin_blocking` | BlockSettingsController, BlockedEntriesController | 2 class-level |
| `admin_accounting` | AccountsController, AccountingController, FinancialPeriodsController, OpeningBalancesController | 4 class-level |
| `admin_analytics` | TrackingController | (via module) |
| `admin_cms` | CmsPagesController | 5 methods |
| `admin_landing_pages` | LandingPagesController | 7 methods |
| `admin_tasks` | TasksController | 1 class-level |
| `admin_employees` | EmployeesController | (via module) |
| `admin_campaigns` | CampaignsController | (via module) |
| `admin_payroll` | PayrollController | (via module) |
| `admin_referrals` | ReferralsController | 3 methods |
| `admin_activity_logs` | ActivityLogsController | (via module) |
| `admin_tracking` | TrackingController | (via module) |
| `admin_inventory_valuation` | StockController | (via module) |
| `storefront_account` | AddressesController | 1 class-level |
| `storefront_search` | SearchController | 1 class-level |

33 class-level gated + 15 method-level gated = **48 total**

## 4. Auth Flows

### Admin Login (EcoMate)
1. User authenticates via Clerk
2. Backend validates Clerk JWT, issues httpOnly session cookie
3. All subsequent API calls include the cookie
4. `JwtAuthGuard` (global APP_GUARD) validates and extracts user identity

### API Key Auth (EcoMate → KeyMate)
1. Each EcoMate order generates a Keygen Token via `generate_order_api_key`
2. Token has limited permissions: `license.validate`, `machine.create`, `machine.check_out`
3. EcoMate sends token in `X-API-Key` header with verification requests
4. KeyMate's `authenticate_with_token!` validates the token and scopes to account

### License Key Auth (for client-side verification)
1. License key (string format: alphanumeric with dashes) sent as `licenseKey` in POST body
2. KeyMate looks up by `@account.licenses.find_by(key: @license_key)`
3. Used when no API key is available (e.g., public verification endpoints)

## 5. Database Structure

### KeyMate Tables

**Keygen Native (auto-managed):**
- `accounts` — Tenant accounts
- `users` — Admin users per account
- `licenses` — Core license records (key, status, expiry, metadata)
- `tokens` — API tokens with permission scopes
- `entitlements` — Feature definitions (code, name, product)
- `policies` — License policy templates
- `machines` — Machine activations
- `products` — Product definitions

**SaaS Custom Tables (`saas_*`):**
- `saas_orders` — Orders linking customers, products, licenses, plans
- `saas_plans` — Plan definitions with pricing, plan_type, status
- `saas_plan_entitlements` — Join table: which features a plan includes
- `saas_plan_metrics` — Join table: plan limits per metric
- `saas_metrics` — Metric definitions (max_products, etc.)
- `saas_license_metrics` — Per-license limit overrides
- `saas_policy_metrics` — Per-policy limit defaults
- `saas_payments` — Payment records per order
- `saas_expenses` — Expense tracking
- `saas_usage_records` — Usage tracking per license per metric
- `saas_order_entitlements` — Custom plan entitlement selections

### EcoMate Tables (Prisma, 60+ models)

Key groups:
- **Auth:** `User`, `RefreshToken`, `VerificationToken`, `UserSettings`
- **Catalog:** `Product`, `ProductVariant`, `Category`, `Brand`, `Tag`, `Attribute`
- **Commerce:** `Order`, `OrderItem`, `Coupon`, `CouponUsage`, `Refund`
- **Payments:** `PaymentGateway`, `PaymentOption`, `Payment`, `ProductPaymentOption`
- **Inventory:** `Warehouse`, `BinLocation`, `InventoryLog`, `Stock`
- **Supply Chain:** `Supplier`, `Purchase`, `PurchaseItem`, `GoodsReceiptNote`, `CostingLot`
- **Accounting:** `Account`, `JournalEntry`, `JournalEntryLine`, `FinancialPeriod`, `OpeningBalance`
- **HR/Payroll:** `Employee`, `Department`, `Designation`, `SalaryStructure`, `Payslip`
- **Marketing:** `Referral`, `ReferralLead`, `ReferralReward`, `EmailCampaign`, `EmailTemplate`
- **CMS:** `CmsPage`, `LandingPage`
- **Security:** `BlockedIp`, `BlockedPhone`, `BlockSettings`
- **Logistics:** `Shipment`, `ShippingOption`, `ShippingZoneGroup`, `CourierCredentials`, `CourierDispatchLog`
- **Notifications:** `NotificationSetting`, `NotificationLog`
- **Reviews:** `Review`
- **Checkout:** `CheckoutLead`
- **Other:** `Media`, `MediaAttachment`, `SystemSetting`, `OrderCounter`, `Expense`, `ExpenseCategory`

## 6. Feature Gating System

### Architecture
```
@RequiresFeature('admin_orders')     ← decorator sets metadata
        ↓
FeatureGuard (global APP_GUARD)      ← reads metadata at request time
        ↓
FeatureFlagsService.canUse()         ← checks cached LicenseInfo
        ↓
LicenseEngine.canUseFeature()        ← checks features array from KeyMate
```

### Rules
1. If no `@RequiresFeature` on handler or class → **pass** (public/meta endpoints)
2. If `@RequiresFeature('feature_key')` present → check `features.includes('feature_key')`
3. Dev mode (no LicenseEngine) → **always pass** (returns true)
4. Invalid/missing license → **deny** (returns false)

### Adding a New Feature Flag
1. Add entitlement to `seed_products.rake` → add code to the appropriate tier array
2. Run `rake keygen:seed_products` to create the entitlement
3. Add `@RequiresFeature('new_code')` to the controller/method
4. Assign the entitlement to a plan via admin UI or seed data
5. Test: verify guard blocks in test mode without entitlement

## 7. Key Decisions

### Why HTTP API over JWT
No shared secret is needed between KeyMate and EcoMate. Each EcoMate instance gets a per-order API key (Keygen Token) that is independently scoped and revocable. HTTP call to verify ensures the license status is always current. JWT-based approaches either require a shared secret (increases attack surface) or introduce validation drift (stale claims).

### Why Per-Order API Key
Each order's API key has minimal permissions (`license.validate`, `machine.create`, `machine.check_out`). If a token is compromised, only that order's license verification is at risk. Tokens are independently revocable without affecting other customers.

### Why localStorage for Currency
Single-tenant deployment means all storefront configuration is static per instance. Storing currency preference in localStorage avoids additional API calls for non-critical UI display data. If multi-currency is needed, it can migrate to server-side.

### Why Manual Payment Gateways
No external payment processor integration (Stripe, SSLCommerz, etc.). Payments are manually tracked via `saas_payments` and EcoMate's `Payment` model with gateway codes (`bkash`, `nagad`, `rocket`, `upay`, `cash`, etc.). Admin marks payments as received manually or via API. This is intentional for markets where bank transfers, mobile banking, and cash-on-delivery dominate.
