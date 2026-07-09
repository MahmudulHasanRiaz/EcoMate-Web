# Blocking & Security System Design
> **Superseded by:** `docs/2-ARCHITECTURE/ARCHITECTURE.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

## Overview
Complete IP and phone number blocking system with whitelist, auto-detection, and configurable restriction rules for the EcoMate e-commerce platform.

## Routes
- `/op/blocked` — Unified blocked items list (IPs + phones)
- `/mon/blocking-settings` — Restriction rules, messages, auto-block config

## Database Models

### BlockedIp (extend existing)
```
blockType   String    @default("order")  // "order" | "full"
reason      String?
blockedAt   DateTime  @default(now())
blockedBy   String?
isActive    Boolean   @default(true)
whitelisted Boolean   @default(false)
autoBlocked Boolean   @default(false)
expiresAt   DateTime?  // auto-block expiry (null = never expires)
createdAt   DateTime  @default(now())
updatedAt   DateTime  @updatedAt
```
Note: `ip` remains `@unique`. When re-blocking, UPSERT: update existing row (upgrade blockType, reset timestamps).

### BlockedPhone (new)
```
phone       String    @unique  // normalized phone
reason      String?
blockedAt   DateTime  @default(now())
blockedBy   String?
isActive    Boolean   @default(true)
whitelisted Boolean   @default(false)
autoBlocked Boolean   @default(false)
expiresAt   DateTime?  // auto-block expiry (null = never expires)
createdAt   DateTime  @default(now())
updatedAt   DateTime  @updatedAt
```

### BlockSettings (new — singleton JSON)
```
id   String @id
data Json   // all config in one document
```

## Important Rules
- **Phone normalization**: All phone values in BlockedPhone must be normalized via `normalizePhone()` before storage and lookup.
- **Whitelist wins**: Whitelisted entries bypass ALL checks including auto-detect. Auto-detect skips whitelisted targets.
- **Upsert behavior**: Creating a block on an already-active entry updates it (upgrade blockType, reset dates). No duplicates.
- **Public block-info endpoint**: Unauthenticated, used by storefront to display block messages to users.

## Backend Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/blocked-entries` | Unified list (all IP + Phone blocks) |
| POST | `/api/blocked-entries` | Create block (body: `{ type: "ip"|"phone", value, reason?, blockType? }`) |
| POST | `/api/blocked-entries/:type/:id/unblock` | Set isActive=false (type = ip|phone) |
| POST | `/api/blocked-entries/:type/:id/whitelist` | Toggle whitelist (type = ip|phone) |
| GET | `/api/block-info` | Public — returns block status + message for given phone/IP (body: `{ phone?, ip? }`) |
| GET/PUT | `/api/block-settings` | Settings CRUD |
| GET | `/api/security/auto-block-stats` | Auto-block analytics (today/week/total counts) |

## Auto-Expiry
Auto-blocked entries (autoBlocked=true) auto-expire at `expiresAt` datetime. Middleware/guard checks `expiresAt && expiresAt < now()` and skips expired blocks. On access, expired auto-blocks are lazily soft-deleted (isActive=false).

Manual blocks never auto-expire (expiresAt = null).

## Enforcement Layers

1. **Full IP Block** — Global middleware, checks `BlockedIp` with `isActive=true AND blockType="full" AND (expiresAt IS NULL OR expiresAt > now)`, excludes whitelisted. 60s cache.
2. **Order Block (IP)** — `OrdersService.create()` checks `BlockedIp` with `isActive=true AND blockType="order" AND (expiresAt IS NULL OR expiresAt > now)`. Excludes whitelisted.
3. **Order Block (Phone)** — `OrdersService.create()` checks `BlockedPhone` with `isActive=true AND (expiresAt IS NULL OR expiresAt > now)`. Excludes whitelisted.
4. **Whitelist** — Whitelisted entries bypass ALL block checks (including auto-block). Highest priority.
5. **Re-blocking** — When creating a block and the target already exists: upgrade blockType (order→full), refresh blockedAt/expiresAt, update reason. Do NOT create duplicate.

## Auto-Detect System

### Failed Login Auto-Block (in-memory TTL)
- Tracked in `SecurityService` using a `Map<string, { count: number; timestamps: number[] }>` with periodic cleanup
- Failed login attempts recorded from `AuthController.login()`
- Threshold: from `BlockSettings.autoBlock.failedLoginThreshold` within `failedLoginWindowMinutes`
- On threshold exceed: UPSERT `BlockedIp` with `blockType="full"`, `autoBlocked=true`, `expiresAt = now + 24h`
- Whitelisted IPs are skipped

### Order Frequency Auto-Block (DB query)
- On new order creation, query recent orders from same phone/IP within `timeWindowMinutes`
- If count >= `maxOrders` → auto block with `autoBlocked=true`, `expiresAt = now + blockDurationMinutes`
- Whitelisted entries skipped
- Phone numbers normalized before check

## BlockSettings JSON Structure

```json
{
  "phoneOrderRestriction": {
    "maxOrders": 3,
    "timeWindowMinutes": 60,
    "blockDurationMinutes": 1440
  },
  "ipOrderRestriction": {
    "maxOrders": 5,
    "timeWindowMinutes": 60,
    "blockDurationMinutes": 1440
  },
  "autoBlock": {
    "failedLoginThreshold": 5,
    "failedLoginWindowMinutes": 10,
    "autoFullBlockIp": true,
    "autoOrderBlockIp": true,
    "autoOrderBlockPhone": true
  },
  "blockMessages": {
    "orderBlockPhone": {
      "title": "অর্ডার করা সম্ভব হচ্ছে না",
      "message": "আপনার ফোন নম্বরটি সাময়িকভাবে ব্লক করা হয়েছে। বিস্তারিত জানতে আমাদের সাপোর্ট টিমের সাথে যোগাযোগ করুন।",
      "ctaLabel": "সাপোর্টে কল করুন",
      "ctaAction": "tel:01700000000"
    },
    "orderBlockIp": {
      "title": "অর্ডার করা সম্ভব হচ্ছে না",
      "message": "আপনার আইপি ঠিকানা থেকে অর্ডার করা সাময়িকভাবে বন্ধ রয়েছে।",
      "ctaLabel": "সাহায্য প্রয়োজন?",
      "ctaAction": "tel:01700000000"
    },
    "fullBlockIp": {
      "title": "অ্যাক্সেস ব্লক করা হয়েছে",
      "message": "আপনার আইপি ঠিকানা ব্লক করা হয়েছে।",
      "ctaLabel": "সাপোর্টে যোগাযোগ",
      "ctaAction": "tel:01700000000"
    }
  }
}
```

## Admin UI

### Route: `/op/blocked`
- Unified table with columns: Type (IP/Phone), Value, Block Type, Reason, Blocked At, Blocked By, Auto, Whitelisted, Actions
- Search bar filters by value
- Tabs/Filter: All | IP | Phone | Active | Whitelisted
- Actions per row: Unblock, Whitelist toggle
- Top buttons: "+ Block IP" modal, "+ Block Phone" modal

### Route: `/mon/blocking-settings`
- Card: Order Restriction Rules (phone + IP config)
- Card: Auto-Block Configuration (thresholds, enabled toggles)
- Card: Block Messages (per type: title, message, CTA label, CTA action)
