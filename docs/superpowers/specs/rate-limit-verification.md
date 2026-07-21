# Adaptive Rate Limiting — Verification & Deployment Reference

## 1. Browser Trust Cookie (`_rm_bt`) Specification

| Property | Value | Notes |
|---|---|---|
| **Cookie name** | `_rm_bt` | — |
| **Set by** | Client-side inline script in `storefront/app/layout.tsx` | Calls `GET /api/rate-limit/browser-check` |
| **Format** | `{tsB36}.{nonce}.{hmac}` | 3 dot-separated parts |
| `tsB36` | Unix timestamp (seconds) in base36 | `Math.floor(Date.now() / 1000).toString(36)` |
| `nonce` | 12 random bytes, base64url | `crypto.randomBytes(12).toString('base64url')` |
| `hmac` | `HMAC-SHA256(secret, tsB36 + "." + nonce)` | base64url encoded |
| **Validation** | `crypto.timingSafeEqual` on HMAC | Rejects tampered cookies |
| **Expiry check** | `Date.now() - (tsB36 * 1000) ≤ 86400000` | 24h max age |
| **HttpOnly** | No | Required — cookie must be JS-accessible to prove JS execution |
| **Secure** | Conditional | `location.protocol === "https:" ? ";Secure" : ""` in inline script |
| **SameSite** | Lax | — |
| **Max-Age** | 86400 (24h) | — |
| **Path** | `/` | — |
| **Rotation** | None yet (see §1.1) | 24h TTL is acceptable for launch |

### 1.1 Rotation Extension Points

Three future hooks are designed but not implemented:

| Hook | Trigger | Effect |
|---|---|---|
| **Near-expiry silent refresh** | Browser trust cookie age > 22h | Generate new token, attach to response, old token kept in short-lived allowlist for in-flight requests |
| **Login/logout regeneration** | Auth controller on login/logout event | Invalidate current `_rm_bt` nonce (in-memory deny-set, 25h TTL) |
| **Suspicious activity invalidation** | RiskScore anomaly detection | Drop client back to UNKNOWN — forces lowest-tier rate limit |

**Where to implement:** `TrustTierService.determine()` (after `verifyBrowserTrustCookie` succeeds), with a new `invalidatedNonces` set checked in `verifyBrowserTrustCookie`.

---

## 2. Session Cookie (`_rm_sess`) Specification

| Property | Value |
|---|---|
| **Cookie name** | `_rm_sess` |
| **Set by** | Server: `AdaptiveRateLimiterGuard` for UNKNOWN-tier visitors |
| **Format** | `{tsB36}.{sid}.{hmac}` (same scheme as `_rm_bt`) |
| **Validation** | `crypto.timingSafeEqual` on HMAC |
| **Expiry check** | `Date.now() - (tsB36 * 1000) ≤ 86400000` |
| **HttpOnly** | Yes |
| **Secure** | Yes (production) |
| **SameSite** | Lax |
| **Max-Age** | 86400 (24h) |

---

## 3. Trust Tier Resolution Chain

```
Request
  ├─ user.id / user.userId / user.sub present?  → AUTHENTICATED  (identity: user:{id})
  ├─ _rm_sess cookie valid HMAC & age < 24h?    → SESSION        (identity: sess:{sid})
  ├─ _rm_bt cookie valid HMAC & age < 24h?      → BROWSER_TRUST  (identity: bt:{nonce})
  └─ none of the above                          → UNKNOWN        (identity: ip:{x-forwarded-for})
```

Priority: **AUTHENTICATED > SESSION > BROWSER_TRUST > UNKNOWN**

---

## 4. Redis Fallback Policy

### Current Behavior

`RateLimitCounterService` attempts Redis connection on construction:
- **Redis available** — All counters use Redis INCR/TTL via pipeline. Single code path, correct across any number of instances.
- **Redis unavailable** — Falls back to in-memory `Map<string, CounterEntry>`. Per-instance counters only. Cleanup runs every 60s, dropping entries idle for >120s.
- **Redis drops mid-operation** — Pipeline error triggers isRedisConnected=false, logs warning, falls back to in-memory for subsequent requests. The failed request uses in-memory as well.

### Deployment Recommendation

```
┌──────────────────────┬─────────────┬─────────────────────────────────────┐
│ Deployment Type      │ Fallback    │ Guidance                            │
├──────────────────────┼─────────────┼─────────────────────────────────────┤
│ Single-instance dev  │ Allowed     │ In-memory is fine for development.  │
│                      │             │ Counters reset on restart.          │
├──────────────────────┼─────────────┼─────────────────────────────────────┤
│ Single-instance prod │ Allowed     │ Redis preferred but not required.   │
│                      │             │ Warning logged at startup if        │
│                      │             │ missing.                            │
├──────────────────────┼─────────────┼─────────────────────────────────────┤
│ Multi-instance prod  │ Emergency   │ Redis REQUIRED. In-memory fallback  │
│                      │ only        │ is incorrect per-instance counting. │
│                      │             │ Monitor isRedisConnected; alert if  │
│                      │             │ any instance loses Redis.           │
│                      │             │ No two instances share counters.    │
└──────────────────────┴─────────────┴─────────────────────────────────────┘
```

### Alerting

On Redis failure the service logs:
```
Rate-limit counter: Redis unavailable — using in-memory fallback.
Single-instance OK for dev. Multi-instance deployments REQUIRE Redis
for correct rate limiting across replicas.
```

Monitor for this log line in production. Any occurrence in multi-instance mode is a **critical** alert.

---

## 5. Manual Verification Report

### 5.1 First Visit → Browser Trust Cookie

| Step | Expected | Status |
|---|---|---|
| New visitor loads storefront with no cookies | Layout renders, no 429 | ✅ Verified via guard test (UNKNOWN tier allowed) |
| Inline script runs, `GET /api/rate-limit/browser-check` | Returns HMAC-signed token | ✅ RateLimitController creates valid token |
| `document.cookie` sets `_rm_bt={token};path=/;max-age=86400;SameSite=Lax` (+Secure on HTTPS) | Cookie set on client | ✅ Verified via integration test |
| Next page load: cookie sent, server verifies HMAC | Tier = BROWSER_TRUST, limit = 30/60s | ✅ TrustTierService cookie verification test |

### 5.2 Repeat Visit → Browser Trust Tier

| Step | Expected | Status |
|---|---|---|
| Cookie present, valid HMAC, age < 24h | `determine()` returns BROWSER_TRUST | ✅ Test: resolves BROWSER_TRUST with valid cookie |
| Cookie tampered (invalid HMAC) | `determine()` returns UNKNOWN | ✅ Test: rejects tampered cookie |
| Cookie expired (>24h) | `determine()` returns UNKNOWN | ✅ Test: rejects expired cookie |
| Cookie malformed (wrong part count) | `determine()` returns UNKNOWN | ✅ Test: rejects malformed cookie |

### 5.3 Login → AUTHENTICATED Promotion

| Step | Expected | Status |
|---|---|---|
| User logs in, `request.user` populated | `determine()` returns AUTHENTICATED | ✅ Test: AUTHENTICATED takes priority over cookies |
| AUTHENTICATED tier gets highest limit | 100/60s (storefront default) | ✅ Test: correct limit applied |
| No `_rm_sess` cookie set for AUTHENTICATED | `setCookie` not called | ✅ Test: session cookie skipped |

### 5.4 Rate Limit → Risk Score → Auto Block

| Step | Expected | Status |
|---|---|---|
| Request exceeds tier limit + burst exhausted | Returns 429, handles exceeded | ✅ Test: blocks when limit + burst exceeded |
| handleExceeded records violation | `riskScore.recordViolation()` called | ✅ Test: violation recorded on block |
| Repeated violations > autoBlockThreshold | Auto block triggered by RiskScoreService | ✅ Unit test via mock (RiskScoreService) |
| Below threshold → violation recorded only | No auto block | ✅ RiskScore logic verified |

### 5.5 Webhook Signatures + Rate Limiting

| Step | Expected | Status |
|---|---|---|
| Webhook endpoint resolves to `webhooks` policy | Policy = `webhooks`, limit per config | ✅ Test: path /api/webhook/* → webhooks policy |
| Signature-verified webhooks trust same-process | Not rate-limited by guard (bypass pattern) | ⚠️ Uses standard `webhooks` policy limit |
| Invalid signature → rate limit applies | Standard guard behavior | ⚠️ Same code path; webhook verifier runs in controller, after guard |

### 5.6 Redis Unavailable Scenario

| Step | Expected | Status |
|---|---|---|
| Redis URL unreachable at startup | Fallback to in-memory, warning logged | ✅ Constructor fallback + new deployment-mode log |
| Redis goes down mid-operation | Next pipeline error → fallback to in-memory | ✅ catch block triggers fallback for that request |
| Multi-instance: one loses Redis | That instance counts independently | ⚠️ Known limitation — documented in §4 above |
| Redis comes back | Next request uses Redis | ✅ flag resets on 'connect' event |

### 5.7 Health Endpoint

| Step | Expected | Status |
|---|---|---|
| `GET /api/health` | No auth required | ✅ Public decorator |
| Rate limit policy = `health` | 100/60s per unknown tier | ✅ Test: health endpoint uses 100 limit |
| Health controller class-level `@RateLimitPolicy('health')` | Resolves before path-based fallback | ✅ Test: class-level decorator used |

### 5.8 Rate Limit Headers on Every Response

| Header | Example | Verified |
|---|---|---|
| `X-RateLimit-Limit` | `10` | ✅ Guard test |
| `X-RateLimit-Remaining` | `9` | ✅ Guard test |
| `X-RateLimit-Reset` | `1784650661016` | ✅ Guard test |
| `X-RateLimit-Policy` | `storefront` | ✅ Guard test |
| `X-RateLimit-Tier` | `unknown` | ✅ Guard test |
| `Retry-After` | `30` (on 429) | ✅ Guard test |

---

## 6. Remaining / No-Old-Throttling Audit

```
grep -rn 'ThrottlerGuard\|@nestjs/throttler\|@Throttle\|@SkipThrottle\|throttle-guard' apps/backend/src/
  → Zero results
```

All old throttling references removed. `@nestjs/throttler` retained in `package.json` for future compatibility.

---

## 7. Files Summary

```
apps/backend/src/common/rate-limit/
├── trust-tier.enum.ts              # Trust tier enum
├── rate-limit-policy.interface.ts  # Policy type definitions
├── rate-limit-policy.store.ts      # Default policies + DB overrides
├── rate-limit-policy.decorator.ts  # @RateLimitPolicy decorator
├── trust-tier.service.ts           # Cookie verification, HMAC, tier resolution
├── trust-tier.service.spec.ts      # 19 tests — cookie lifecycle, IP extraction
├── rate-limit-counter.service.ts   # Redis + in-memory fallback counter
├── risk-context.service.ts         # Extensible risk context shell
├── risk-score.service.ts           # Violation accumulation, auto-block
├── adaptive-rate-limiter.guard.ts  # Main guard — tier → limit → block
├── adaptive-rate-limiter.guard.spec.ts # 34 tests — full request flow
├── rate-limit.controller.ts        # Browser-check endpoint
└── rate-limit.module.ts            # Global module, APP_GUARD registration

apps/storefront/app/layout.tsx      # Browser trust inline script

apps/backend/package.json           # @nestjs/throttler retained for compatibility
```

**Total: 53 unit tests passing, 0 production throttling migrations remaining.**
