# KeyMate + EcoMate Integration Plan

## Architecture (Revised — No JWT)

KeyMate = Central licensing server (Rails + Keygen CE)
EcoMate = E-commerce platform (1st product managed by KeyMate)
License Engine = HTTP client + cache layer

### Data Flow

```
┌────────────────────────────┐       POST /v1/saas/licenses/verify
│        KeyMate Server        │◄──────── { licenseKey, domain }
│   (Rails + Keygen CE)        │            + X-API-Key header
│                              │
│  Saas::Plan                  │── { valid, plan, features[],
│  Saas::PlanEntitlement       │    limits{}, domains[], expiry } ────►
│  Saas::PlanMetric            │
│  Saas::LicenseMetric         │       POST /v1/saas/licenses/:id/check-in
│  Saas::Order                 │◄──────────── { domain }
│  License (Keygen native)     │
│  Token (API Key)             │── { valid, plan, features[], limits{} }
│                              │
└──────────────────────────────┘     ┌───────────────────────────────┐
                                     │  Client App (EcoMate)         │
                                     │                               │
                                     │  @ecomate/license-engine       │
                                     │  ├─ verify(key, domain, key)  │
                                     │  │  → HTTP POST to KeyMate    │
                                     │  │  → cache response          │
                                     │  ├─ canUseFeature(key)        │
                                     │  │  → check cached features   │
                                     │  ├─ checkLimit(metric, val)   │
                                     │  │  → check cached limits     │
                                     │  ├─ checkIn(key, domain)      │
                                     │  │  → refresh from server     │
                                     │  └─ 7-day offline cache       │
                                     │                               │
                                     │  @ecomate/feature-flags       │
                                     │  ├─ FeatureGuard (global)     │
                                     │  ├─ @RequiresFeature('x')     │
                                     │  └─ Dev mode fallback         │
                                     └───────────────────────────────┘
```

### Key Decisions vs Old Approach

| Aspect | Old (Prisma + JWT) | Revised (Rails + HTTP) |
|--------|-------------------|----------------------|
| Auth | HMAC shared secret | Per-order API key (X-API-Key) |
| License proof | JWT signed with secret | HTTPS + Keygen native Ed25519 license |
| Feature source | Client-side feature-map.ts | Server DB (PlanEntitlements) |
| Offline cache | 7-day JWT grace | 7-day JSON response cache |
| Feature changes | Require client redeploy | Instant — via check-in refresh |
| C++ native addon | For JWT base64 | Removed (not needed) |
| Secret distribution | Every client has KEY | No shared secret needed |

## Phase 1: KeyMate License Verify API

### Endpoints (3 public routes)

All accept `X-API-Key` header (token generated via `generate_order_api_key`).

#### POST /v1/saas/licenses/verify
Auth: X-API-Key
Body:
```json
{ "licenseKey": "XXXX-XXXX-XXXX-XXXX", "domain": "client-store.com" }
```
Response (200):
```json
{
  "valid": true,
  "plan": { "id": "uuid", "name": "Growth", "planType": "fixed", "price": 99.0 },
  "features": ["storefront_catalog", "admin_products", ...],
  "limits": { "orders_per_month": 5000, "staff_users": 10 },
  "domains": ["client-store.com"],
  "expiry": "2026-12-31T00:00:00Z",
  "lastCheckIn": null
}
```

#### POST /v1/saas/licenses/:id/check-in
Auth: X-API-Key
Body: `{ "domain": "client-store.com" }`
Response (200): Same shape as verify (refreshed features/limits)

#### GET /v1/saas/licenses/:id/status
Auth: X-API-Key
Response (200): Same shape as verify

### Implementation

**Service:** `app/services/saas/verify_license_service.rb`
- Look up API token → find bearer license + account
- Run native `LicenseValidationService` (scope: false, skip env check)
- Find Saas::Order for this license
- Check domain against order.domains
- Compute features: from PlanEntitlements (if plan_id on order) or LicenseEntitlements (custom)
- Compute limits: from PlanMetrics + LicenseMetric overrides
- Return structured JSON

**Controller:** Add to `Api::V1::SaasController` with `skip_before_action :authenticate_with_token!`
Or create `Api::V1::Saas::LicensesController`

## Phase 2: EcoMate License Engine Rewrite

### Package: @ecomate/license-engine

**Remove:**
- `src/verifier.ts` — JWT/HMAC logic (not needed)
- `src/feature-map.ts` — features come from server
- `src/addon.cc`, `src/validator.cc` — C++ native addon
- `node-addon-api`, `node-gyp` dependencies

**Keep:**
- `src/cache.ts` — file-based 7-day cache (unchanged)
- `src/types.ts` — `LicenseInfo` shape (same interface, populated from API)
- Test structure (rewrite to mock HTTP)

**Add:**
- `src/api-client.ts` — HTTP client for KeyMate API (uses native fetch)
- `src/index.ts` — rewritten: `verify(licenseKey, domain, apiKey)` → HTTP POST instead of JWT verify

**API:**
```typescript
class LicenseEngine {
  constructor(options: {
    keymateUrl: string       // e.g. https://keymate.example.com/api/v1/saas
    apiKey?: string           // optional, can also pass per-call
    offlineGraceMs?: number   // default 7 days
  })

  async verify(licenseKey: string, domain?: string, apiKey?: string): Promise<LicenseInfo>
  async checkIn(licenseKey: string, domain?: string, apiKey?: string): Promise<LicenseInfo>

  canUseFeature(license: LicenseInfo | null, featureKey: string): boolean
  checkLimit(license: LicenseInfo | null, metricKey: string, currentUsage: number): LimitResult

  // Backwards compat for FeatureFlagsService
  setLicense(token: string): LicenseInfo   // calls verify(token)
  getLicense(): LicenseInfo | null
}
```

### Package: @ecomate/feature-flags

Minimal changes:
- `setLicense(token)` stays — internally calls `engine.verify(token)`
- Dev mode fallback unchanged
- `@RequiresFeature` + `FeatureGuard` unchanged

## Phase 3: Seed Data

One-time seed to create EcoMate's feature catalog in KeyMate:

### Entitlements (48 features, 3 groups)
All features from EcoMate `feature-map.ts` become Keygen `Entitlement` records.

### Metrics (4 base metrics)
- `orders_per_month` — monthly order limit
- `staff_users` — max staff accounts
- `products` — max product count
- `purchase_orders` — max purchase orders

### Plans (3 tiers)

| Plan | Price | Features | Limits |
|------|-------|----------|--------|
| Essential | 49 | 25 features (essential group) | 500 products, 3 staff, 500 orders/mo, 0 PO |
| Growth | 99 | 39 features (+ growth group) | 5,000 products, 10 staff, 5,000 orders/mo, 200 PO/mo |
| Enterprise | 199 | 48 features (all) | 50,000 products, unlimited staff, 50,000 orders/mo, 5,000 PO/mo |

## Phase 4: KeyMate SaaS Integration

- Admin panel: add API key display to order detail page
- Admin panel: license status show (last check-in, domain, active)
- Customer registration page already exists

## Files Changed

### KeyMate (Rails)
| File | Action |
|------|--------|
| `app/services/saas/verify_license_service.rb` | NEW |
| `app/controllers/api/v1/saas_controller.rb` | ADD 3 endpoints |
| `config/routes.rb` | ADD 3 routes |
| `db/seeds/ecoMate_feature_seeds.rb` | NEW |

### EcoMate (TypeScript)
| File | Action |
|------|--------|
| `packages/license-engine/src/index.ts` | REWRITE |
| `packages/license-engine/src/types.ts` | REWRITE |
| `packages/license-engine/src/api-client.ts` | NEW |
| `packages/license-engine/src/verifier.ts` | DELETE |
| `packages/license-engine/src/feature-map.ts` | DELETE |
| `packages/license-engine/src/addon.cc` | DELETE |
| `packages/license-engine/src/validator.cc` | DELETE |
| `packages/license-engine/package.json` | UPDATE deps |
| `packages/license-engine/test/index.test.js` | REWRITE |
| `packages/feature-flags/src/index.ts` | MINOR UPDATE |

## Client Deployment

EcoMate deployed to client's server via Docker Compose:

```yaml
# .env
LICENSE_KEY=XXXX-XXXX-XXXX-XXXX
KEYMATE_API_URL=https://keymate.example.com/api/v1/saas
KEYMATE_API_KEY=generated-api-token
DOMAIN=client-store.com
```
