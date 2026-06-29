# Phase 4 — KeyMate UI (Future Work)

Remaining UI work for the KeyMate admin frontend (`KeyMate-2/frontend/`, Next.js).

## 1. License Dashboard

**Purpose:** List, search, filter, and manage all licenses with real-time status.

**Features:**
- Table view with columns: License Key, Product, Plan, Customer, Status, Expiry, Last Check-in
- Search by license key, customer name/email, domain
- Filter by status (active, expired, suspended, banned), plan, product
- Bulk actions: suspend, ban, extend expiry
- Quick stats: total licenses, active %, expiring within 30 days
- Pagination (50 per page default)
- Export to CSV

**Key API endpoints:**
- `GET /v1/accounts/:id/licenses` — Keygen native list
- Extend with `Saas::Order` join for plan/customer details

**UI Components:**
- `LicenseTable` — sortable, filterable data grid
- `LicenseStatusBadge` — color-coded status indicator
- `LicenseFilterBar` — search + multi-select filters
- `BulkActionBar` — batch operations toolbar

## 2. Analytics Dashboard

**Purpose:** Revenue, activations, churn, and usage metrics over time.

**Features:**
- Revenue chart (line): monthly sales, expenses, net profit (already in `SaasController#dashboard`)
- Activation chart (bar): new licenses created per month
- Churn rate: % of licenses not renewed within 30 days of expiry
- Top plans by revenue
- Usage tracking: active licenses consuming limits (from `Saas::UsageRecord`)
- Export charts as PNG/CSV

**Key API endpoints:**
- `GET /v1/saas/dashboard` — existing 6-month trend endpoint
- `GET /v1/saas/licenses/:id/usage` — usage records per license
- `GET /v1/saas/license_limits/:id` — limit checker

**UI Components:**
- `RevenueChart` — recharts line chart with 3 series (sales, expenses, profit)
- `ActivationBarChart` — monthly new licenses
- `ChurnRateCard` — percentage with trend arrow
- `PlanBreakdownPie` — revenue share by plan

## 3. Order Detail Page

**Purpose:** View and manage a single order with its API key and license status.

**Features:**
- Order summary header: invoice number, customer, date, status
- License widget: key, status, expiry, last check-in, domain whitelist
- API key section:
  - Generate new API key (`POST /v1/saas/orders/:id/generate_api_key`)
  - Display raw token once with copy-to-clipboard
  - Regenerate (invalidates old token)
  - Revoke token
- Payment history table: receipts, amounts, methods
- Manual payment entry button
- Wallet balance adjustment
- Edit domains
- Extend/renew subscription
- Cancel order
- Delete order (with confirmation)

**Key API endpoints:**
- `GET /v1/saas/orders/:id` — existing (from `index_orders`)
- `POST /v1/saas/orders/:id/generate_api_key` — existing
- `POST /v1/saas/orders/:id/pay_due` — existing
- `PATCH /v1/saas/orders/:id` — existing (update status/discount)

**UI Components:**
- `OrderHeader` — invoice info, status badge, actions toolbar
- `LicenseWidget` — card with key, status indicator, domain list
- `ApiKeyCard` — token display, generate/regenerate/revoke buttons
- `PaymentTimeline` — chronological payment list
- `WalletAdjustModal` — add/remove wallet balance

## 4. Customer Registration Page

**Purpose:** Self-service registration for new customers to create accounts and purchase licenses.

**Features:**
- Registration form: name, email, password
- Email verification flow
- Login with email/password
- Forgot password / reset flow
- Session management (JWT or cookie-based auth)

**Note:** Currently, admin must create users manually via the KeyMate admin panel. This page replaces that workflow with self-service.

**Considerations:**
- Must integrate with Keygen's existing `User` model
- Email verification via `user_mailer.rb` (already exists)
- Password hashing by Keygen's built-in auth
- Reuses existing `POST /v1/saas/users/:id/wallet` for initial credit

## 5. Wallet Balance Management

**Purpose:** Allow customers to top up wallet, view transaction history, and use wallet balance for license purchases.

**Features:**
- Wallet balance display (current, pending, total deposited)
- Top-up form: amount input, payment method selector
- Transaction history: date, amount, type (deposit/payment/refund), reference
- Auto-use wallet during checkout (already implemented in `create_order`)
- Refund to wallet when overpayments occur (already implemented)
- Admin override: adjust balance (existing `POST /v1/saas/users/:id/wallet`)

**Key API endpoints:**
- `POST /v1/saas/users/:id/wallet` — existing (admin adjusts balance)
- `GET /v1/saas/payments?user_id=:id` — transaction history filtered by user

**UI Components:**
- `WalletCard` — balance summary with top-up button
- `TopUpModal` — amount input + payment method picker
- `TransactionTable` — sorted, paginated history
- `AutoPayToggle` — enable/disable auto-wallet-payment for renewals

## Implementation Priority

1. License Dashboard (highest — replaces manual license search)
2. Order Detail with API Key widget (needed for customer support)
3. Analytics Dashboard (visibility into business health)
4. Customer Registration (enables self-service)
5. Wallet Management (nice-to-have, partial logic already exists)
