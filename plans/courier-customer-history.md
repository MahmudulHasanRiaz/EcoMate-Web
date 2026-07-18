# Feature 2: Customer Courier History — Implementation Plan

## Research: Courier API Customer History Endpoints

### Steadfast
- **Has no public customer-history API**. The `fraudCheck()` methods in community SDKs (`@dreygur/steadfast-api`, `sabitahmad/laravel-steadfast`) actually **web-scrape the merchant portal**: login at `https://steadfast.com.bd/login` with email/password → extract CSRF token → POST login → scrape fraud check page → logout.
- **Existing dispatch creds** (API key + secret key) do NOT work for this — requires merchant panel login credentials (email + password).
- **Risk**: Scraping breaks when HTML changes; fragile for production.

### Pathao
- **Has a proper API endpoint**: `POST /aladdin/api/v1/user/success-rate` with phone number.
- Uses same OAuth2 token as dispatch (clientId + clientSecret + username + password).
- Returns `{ success, cancel, total }` per phone number.
- **Confirmed working** by `devrkb21/pathao-laravel`, `enuenan/pathao-courier`, `nayemuf/pathao-courier` packages.
- **Stable**: Official merchant API, not scraping.

### RedX
- **Has no public customer-history API**. Community fraud-checkers use merchant portal scraping (phone + password login).
- No official endpoint for per-phone-number stats.
- **Risk**: Scraping only.

### Carrybee
- **Has no public customer-history API**. Community fraud-checkers use merchant portal scraping (phone + password login).
- No official endpoint for per-phone-number stats.
- **Risk**: Scraping only.

### FraudBD (Third-Party Aggregator, fraudbd.com)
- `POST /api/check-courier-info` with `phone_number` + `api_key`.
- Returns per-courier stats for: Pathao, Steadfast, RedX, Paperfly, Carrybee.
- Also returns aggregate total across all couriers.
- **Pricing**: Free (10 req/day), Pro BDT 200/month (50 req/day), Enterprise BDT 850/6mo (150 req/day), Ultimate BDT 1500/year (200 req/day).
- Has free sandbox for testing: `POST /api/sandbox/check-courier-info`.
- **Pros**: Proper REST API, single integration, covers all needed couriers, affordable.
- **Cons**: Third-party dependency, rate-limited.

### Summary

| Courier | Has Native Customer History API? | Approach |
|---------|----------------------------------|----------|
| Pathao | ✅ `POST /aladdin/api/v1/user/success-rate` | Direct API call (stable) |
| Steadfast | ❌ (only web scraping) | FraudBD proxy |
| RedX | ❌ (only web scraping) | FraudBD proxy |
| Carrybee | ❌ (only web scraping) | FraudBD proxy |

## Recommendation: Hybrid Approach

Since only Pathao has a stable API and the other 3 require fragile scraping, the best architecture is:

### Primary: FraudBD for Steadfast + RedX + Carrybee
- Single REST API call covers all 3 couriers
- Returns `{ total, success, cancel }` per courier + aggregate
- Clean, stable, maintained by FraudBD team
- BDT 200/month (50 req/day) — cheap for business use

### Direct: Pathao native API
- Pathao's own endpoint directly from our existing credentials
- Same OAuth2 token auth already implemented
- No extra cost

### Cache Layer: CourierReportCache (already in Prisma)
- Stale-while-revalidate pattern per courier, per phone
- Fresh: return cached data, skip API call
- Stale: return cached immediately + background-refresh
- Empty: call API, persist on success, return; on failure → return empty (no error thrown)

### Per-Courier Independence
Each courier is fully independent:
- Pathao ✅ + Steadfast ❌ + RedX ✅ = show Pathao & RedX reports, hide Steadfast
- Partial success built in at the cache/controller level

---

## Architecture

### 1. Data Flow

```
Admin Order Detail Page
  ↓ GET /couriers/customer-history?phone=017XXXXXX
CourierCustomerHistoryController
  ├── pathao() → CourierReportCache lookup → cache hit? → return
  │                           → cache stale/empty → call Pathao API
  │                           → persist to CourierReportCache → return
  ├── steadfast() → CourierReportCache lookup → cache hit? → return
  │                           → cache stale/empty → call FraudBD API
  │                           → persist to CourierReportCache → return
  ├── redx() → CourierReportCache lookup → cache hit? → return
  │                           → cache stale/empty → call FraudBD API
  │                           → persist to CourierReportCache → return
  └── carrybee() → CourierReportCache lookup → cache hit? → return
                              → cache stale/empty → call FraudBD API
                              → persist to CourierReportCache → return
```

### 2. Cache Strategy (CourierReportCache)

```
model CourierReportCache {
  id             String   @id @default(uuid())
  courier        String
  phone          String
  report         Json     // { total, success, cancel, successRatio, riskLevel }
  courierStatus  String?  // 'fresh' | 'stale' | 'error'
  fetchedAt      DateTime
  expiresAt      DateTime  // fetchedAt + TTL
}

@@unique([courier, phone])
```

- **TTL**: fresh for 30 min (reuse without API call)
- **Stale window**: up to 24 hours (serve cached + background refresh)
- **If no cache**: call API, persist, return
- **If API fails and no cache**: skip courier (no error thrown)
- **If API fails but stale cache exists**: return stale cache (graceful degradation)

### 3. API Design

#### New Service: `CourierCustomerHistoryService`

```
apps/backend/src/courier-customer-history/
  courier-customer-history.module.ts
  courier-customer-history.service.ts
  courier-customer-history.controller.ts
```

#### Endpoints

```
GET /couriers/customer-history/:courier?phone=017XXXXXX
  → returns per-courier report

GET /couriers/customer-history/all?phone=017XXXXXX
  → returns all connected couriers' reports (parallel fetch)
```

**Response shape (per courier)**:
```json
{
  "courier": "steadfast",
  "phone": "017XXXXXXX",
  "total": 45,
  "success": 38,
  "cancel": 7,
  "successRatio": 84.44,
  "riskLevel": "low",
  "cachedAt": "2026-07-18T10:30:00Z",
  "status": "fresh"
}
```

**Response shape (all)**:
```json
{
  "pathao": { "total": 12, "success": 10, "cancel": 2, "successRatio": 83.33, ... },
  "steadfast": { "total": 33, "success": 28, "cancel": 5, "successRatio": 84.85, ... },
  "redx": null,  // courier not configured or error
  "carrybee": { "total": 5, "success": 5, "cancel": 0, "successRatio": 100, ... }
}
```

### 4. Courier API Details

#### Pathao — Direct API
- **Endpoint**: `POST {base}/aladdin/api/v1/user/success-rate`
- **Auth**: OAuth2 Bearer token (same as dispatch)
- **Body**: `{ "phone": "017XXXXXXX" }`
- **Response**: `{ "data": { "success": 10, "cancel": 2, "total": 12 } }`
- **Error handling**: 401 → refresh token & retry; 404/other → skip

#### Steadfast, RedX, Carrybee — Via FraudBD
- **Endpoint**: `POST https://fraudbd.com/api/check-courier-info/{courier}`
- **Auth**: `x-api-key` header
- **Body**: `{ "phone_number": "017XXXXXXX" }`
- **Response**: `{ "data": { "Summaries": { "Steadfast": { "total": 33, "success": 28, "cancel": 5 } } } }`
- **Sandbox**: `POST https://fraudbd.com/api/sandbox/check-courier-info/{courier}` (no API key needed)

### 5. Credentials

**Pathao**: Reuse existing `CourierCredentials` (clientId, clientSecret, username, password, storeId).

**FraudBD**: New credential — store in `system_settings` table:
- Key: `fraudbd_api_key`
- Or add `fraudbdApiKey` field to `CourierCredentials` model.

### 6. Implementation Order

1. **Prisma**: Ensure `CourierReportCache` model exists (already does — line 979).
   - Run `npx prisma generate` only (no migration needed — model already deployed).
   - Verify `@@unique([courier, phone])` index.

2. **FraudBD settings**: Add UI to Courier Settings page for FraudBD API key.

3. **Service**: `CourierCustomerHistoryService` — one method per courier + `getAll()` parallel.
   - Pathao: direct API call with OAuth2.
   - Steadfast/RedX/Carrybee: FraudBD API call.
   - Cache logic: check → return/refresh/fallback.

4. **Controller**: `GET /couriers/customer-history/:courier` + `GET /couriers/customer-history/all`.

5. **Admin Frontend**: New component `<CustomerCourierHistoryCard>` on order detail page:
   - Calls `GET /couriers/customer-history/all?phone={customer.phone}`.
   - Renders per-courier card: logo, success ratio, count badges (delivered/cancelled/total).
   - Shows `"No data"` gracefully for couriers with no report.
   - Always visible, no condition.

6. **Cleanup**: Deprecate old `CourierQuickView` + `CourierService.search()` after verification.

7. **Build + type-check**: `npx nest build` + `npx tsc --noEmit`.

### 7. Key Design Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| Data source per courier | Pathao = direct API; others = FraudBD | Only Pathao has a stable native API |
| Third-party dependency | FraudBD (BDT 200/mo) | Better than web scraping 3 fragile portals |
| Cache layer | CourierReportCache (existing model) | Already designed for this exact use case |
| Failure behavior | Silent skip per courier | Partial success, no error thrown |
| Phone normalization | Same as dispatch (`normalizePhone`) | Consistent with existing code |
| Parallel fetching | `Promise.allSettled` for all couriers | One slow courier doesn't block others |

### 8. Migration from Old Hooren System

Once new system is verified:
- Remove `CourierService` (`apps/backend/src/courier/courier.service.ts`)
- Remove `CourierController` search/summary endpoints
- Remove `CourierQuickView` from orders list page
- Remove `system_setting` entry `courier_hoorin_api_key`

---

## Edge Cases & Risks

1. **FraudBD goes down**: We can still serve cached reports up to 24h stale. After that, couriers with no fresh data show as unavailable. Mitigation: add monitoring/alerting on FraudBD failures.

2. **Pathao OAuth token expires**: Same OAuth2 handling as dispatch — auto-refresh on 401.

3. **Rate limiting (FraudBD)**: Pro plan = 50 req/day. We cache per phone per courier with 30min TTL, so 50 req/day = ~25 unique phone checks/day (since each `all` call = 3 FraudBD requests). Mitigation: monitor usage, upgrade plan if needed.

4. **Phone format mismatch**: Normalize all phone numbers same as dispatch (strip country code, keep 11 digits).

5. **New courier added**: Only need to add FraudBD courier name + cache model entry — no new API integration.

## Questions for User

1. **FraudBD subscription**: OK to sign up (BDT 200/mo pro plan) as primary data source for Steadfast/RedX/Carrybee? Or prefer building from our own dispatch data (less accurate — only our merchant's data)?
2. **Pathao direct API**: Already have credentials — no extra cost.
3. **Should we keep a fallback to our own dispatch data** for couriers not covered by FraudBD?
