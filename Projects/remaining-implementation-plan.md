# Remaining Implementation Plan

Status: RequiresFeature gating done. Tests 335/336 passing.

---

## Sprint A: KeyMate Database and Seed Data

**Goal:** Create admin account + seed EcoMate product/plans/features

| Step | Command | Location |
|------|---------|----------|
| A1 | bundle exec rake keygen:setup | KeyMate-2/backend |
| A2 | bundle exec rake keygen:seed_products | KeyMate-2/backend |

Prerequisites: PostgreSQL running, DATABASE_URL set in .env

---

## Sprint B: Payment Gateway Management UI

**Goal:** CRUD for payment gateways (bKash, Nagad, Rocket, Cash, Upay, Cellfin)

**Backend:** Already exists in apps/backend/src/gateways/gateway-config.controller.ts

API endpoints:
- GET /gateways/admin - list all (admin view)
- POST /gateways - create gateway
- PUT /gateways/:code - upsert gateway
- GET /gateways/options - list payment options
- PUT /gateways/options/:type - update payment option

**Frontend tasks (draft/jannat-fashion/):**

| Step | Action | File |
|------|--------|------|
| B1 | Create gateways.ts service | src/services/gateways.ts |
| B2 | Create payment gateway settings page | src/app/dashboard/(main)/settings/gateways/payment/page.tsx |
| B3 | Add sidebar nav link for payment gateways | settings/layout.tsx |

Page features:
- Table of gateways with name, code, type, status, mode, phone number
- Enable/disable toggle
- Edit modal for name, phone, mode, sort order, credentials
- Create new gateway button
- Payment options management (FULL_PAYMENT, PARTIAL_PAYMENT, CASH_ON_DELIVERY)

---

## Sprint C: License Info and API Key in Order Detail

**Goal:** Display license status + API key on order detail page

**Frontend tasks (draft/jannat-fashion/):**

| Step | Action | File |
|------|--------|------|
| C1 | Read order-details-view.tsx to find license section | components/orders/order-details-view.tsx |
| C2 | Add API key display with copy button | Same file |
| C3 | Add license status section (plan, features, domain, last check-in) | Same file |

Data source: ORDER already has licenseKey field from KeyMate API. API key is generated via POST /v1/saas/orders/:id/generate_api_key.

---

## Sprint D: Documentation Portal

**Goal:** AI-readable + human-readable project documentation

| Step | Action | File |
|------|--------|------|
| D1 | Architecture overview | docs/architecture.md |
| D2 | API reference | docs/api-reference.md |
| D3 | Development setup guide | docs/development.md |
| D4 | Deployment guide | docs/deployment.md |

---

## Sprint E: Production Deployment

**Goal:** Deploy KeyMate + EcoMate to production

Steps:
1. Docker Compose setup for KeyMate (Rails + PostgreSQL)
2. Docker Compose setup for EcoMate (NestJS + Next.js + PostgreSQL)
3. nginx/SSL configuration
4. Environment variable guide
5. Domain setup

---

## Execution Order

Parallel groups (can run simultaneously):
- Group 1: Sprint B (Payment Gateway UI)
- Group 2: Sprint C (License Info in Order Detail)
- Group 3: Sprint D (Documentation Portal)
- Group 4: Sprint A (KeyMate seeds) - needs database access

Sequential dependencies: Sprint E (production deployment) after all others.
