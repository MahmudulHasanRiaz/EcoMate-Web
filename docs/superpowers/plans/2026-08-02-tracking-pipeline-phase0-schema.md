# CAPI Tracking Pipeline — Phase 0: Database Schema + Constants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the six tracking tables and `Order.trackingSessionId` to the Prisma schema, run the migration, and add the shared status/event-type constants and the `TrackingSettingsService` scaffold — with **no runtime behavior change** to the existing tracking flow.

**Architecture:** This is Phase 0 of the approved design (`docs/superpowers/specs/2026-08-02-ecomate-capi-redesign-design.md`). The `TrackingEvent` table is deliberately left untouched so `getContext`/`saveContext` keep working; the context switch happens in Phase 1. Phase 0 delivers only: schema + migration + constants + settings service.

**Tech Stack:** NestJS 11, Prisma 7 (PostgreSQL), Jest, TypeScript.

## Global Constraints

- **AGENTS.md migration rule:** any `schema.prisma` change MUST be followed by an instant migration (`npx prisma migrate dev --name <name>`), verified, then `npx prisma generate`. NEVER use `prisma db push`/`migrate reset` without explicit approval. Commit schema + migration + generated client atomically.
- **Backend rules:** run `npm run build --workspace=backend` before completion; no new TypeScript errors in modified files; keep controllers thin.
- **No behavior change:** Phase 0 must not alter how orders/refunds/leads fire tracking today. `TrackingEvent`, `TrackingService`, `MetaConversionsService`, `TrackingQueueProcessor` are untouched.
- **Preserve business integrity:** no changes to order, stock, payment, or refund logic in this phase.

---
## File Structure

| File | Change | Responsibility |
|---|---|---|
| `apps/backend/prisma/schema.prisma` | Modify | Add `TrackingContext`, `TrackingSnapshot`, `TrackingOutbox`, `TrackingDispatch`, `TrackingDispatchEvent`, `TrackingReplayArchive`; add `Order.trackingSessionId` + index |
| `apps/backend/prisma/migrations/<ts>_add_tracking_pipeline/migration.sql` | Generated | Migration (must be reviewed before commit) |
| `apps/backend/src/tracking/tracking.constants.ts` | Create | Status enums, event types, versions, success policies |
| `apps/backend/src/tracking/__tests__/tracking.constants.spec.ts` | Create | Unit tests for constants |
| `apps/backend/src/tracking/tracking-settings.service.ts` | Create | Central settings reader (system_settings + env fallback, gated test codes) |
| `apps/backend/src/tracking/__tests__/tracking-settings.service.spec.ts` | Create | Unit tests for the settings service |
| `apps/backend/src/tracking/tracking.module.ts` | Modify | Register `TrackingSettingsService` in providers |

---
### Task 1: Add tracking models + `Order.trackingSessionId` to Prisma schema

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Generated: `apps/backend/prisma/migrations/<ts>_add_tracking_pipeline/migration.sql`

**Interfaces:**
- Produces: Prisma models `TrackingContext`, `TrackingSnapshot`, `TrackingOutbox`, `TrackingDispatch`, `TrackingDispatchEvent`, `TrackingReplayArchive`, and `Order.trackingSessionId` — used by all later phases. Column names and types MUST match this task exactly (later tasks reference them).

- [ ] **Step 1: Inspect the schema tail and Order model**

Run: `tail -40 apps/backend/prisma/schema.prisma`
Expected: `BackupJob` is the last model (ends around line 2449). Also confirm the `Order` model's index block (around lines 602-670) — you will add one field and one index there.

- [ ] **Step 2: Append the six tracking models to the end of `schema.prisma`**

Append exactly this (after the `BackupJob` model, at the end of the file):

```prisma
// ── Tracking pipeline (Phase 0, design v2 §15) ──────────────────────────────
// FKs are intentionally omitted: append-only log tables; orphan prevention is
// enforced in application code (capture writes snapshot+outbox atomically).

model TrackingContext {
  id           String   @id @default(uuid())
  ctxId        String   @unique
  externalId   String   @default(uuid()) // customer-keyed when auth known; journey-uuid fallback for guests
  ip           String?
  userAgent    String?
  url          String?
  referrer     String?
  identifiers  Json     @default("{}") // per-key {value, firstSeenAt, lastSeenAt}; serialized merge
  firstSeenAt  DateTime @default(now())
  lastSeenAt   DateTime @updatedAt
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([externalId])
  @@index([lastSeenAt]) // retention/anonymization
}

model TrackingSnapshot {
  id            String   @id @default(uuid())
  eventId       String   @unique
  eventType     String
  orderId       String?
  ctxId         String?
  eventTime     BigInt // Unix seconds; BigInt avoids INT4 2038 overflow
  actionSource  String?
  schemaVersion Int      @default(1)
  payload       Json
  createdAt     DateTime @default(now())

  @@index([orderId])
  @@index([eventType, createdAt])
}

model TrackingOutbox {
  id             String   @id @default(uuid())
  snapshotId     String   @unique
  configSnapshot Json     @default("{}")
  status         String   @default("PENDING") // PENDING | CLAIMED | SENT | FAILED | DEAD
  attemptCount   Int      @default(0)
  nextAttemptAt  DateTime @default(now())
  priority       Int      @default(0) // higher = claimed first (Purchase/Refund high)
  lockedAt       DateTime?
  lockedBy       String?
  lastError      String?
  createdAt      DateTime @default(now())
  publishedAt    DateTime?
  dispatchedAt   DateTime?

  @@index([status, priority, nextAttemptAt]) // claim query
  @@index([createdAt]) // retention
}

model TrackingDispatch {
  id                 String   @id @default(uuid())
  snapshotId         String
  eventId            String
  orderId            String?
  ctxId              String?
  queueJobId         String?
  provider           String
  status             String   @default("PENDING") // PENDING|SENDING|SENT|RETRY|FAILED|DEDUPED|SKIPPED|DEAD
  providerEventId    String?
  httpStatus         Int?
  responseBody       String?
  errorMsg           String?
  attemptCount       Int      @default(0)
  adapterVersion     Int? // null for SKIPPED/DEDUPED (no send)
  providerApiVersion String? // null for SKIPPED/DEDUPED
  payloadVersion     Int? // null for SKIPPED/DEDUPED
  normalizerVersion  Int?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([snapshotId, provider])
  @@index([provider, status, createdAt])
  @@index([eventId, createdAt])
  @@index([orderId, createdAt])
  @@index([ctxId])
  @@index([createdAt]) // retention
}

model TrackingDispatchEvent {
  id           String   @id @default(uuid())
  snapshotId   String
  eventId      String
  orderId      String?
  ctxId        String?
  provider     String?
  queueJobId   String?
  fromStatus   String?
  toStatus     String
  attempt      Int?
  message      String?
  createdAt    DateTime @default(now())

  @@index([snapshotId, createdAt])
  @@index([provider, toStatus, createdAt])
  @@index([eventId, createdAt])
  @@index([orderId, createdAt])
  @@index([ctxId])
  @@index([createdAt]) // retention
}

model TrackingReplayArchive {
  id              String   @id @default(uuid())
  snapshotId      String   @unique
  eventId         String
  eventType       String
  eventTime       BigInt
  archivedPayload Json     @default("{}") // canonical payload, PII-stripped (hashed keys only)
  configSnapshot  Json     @default("{}")
  versions        Json     @default("{}") // {schemaVersion, adapterVersion, providerApiVersion, payloadVersion, normalizerVersion}
  archivedAt      DateTime @default(now())

  @@index([eventId])
  @@index([eventType, archivedAt])
}
```

- [ ] **Step 3: Add `trackingSessionId` to the `Order` model**

In the `Order` model (around line 660, near `viewToken`), add the field:

```prisma
  trackingSessionId String?
```

And add the index inside the `Order` model's `@@index([...])` block (alphabetical, near the other indexes):

```prisma
  @@index([trackingSessionId])
```

- [ ] **Step 4: Validate the schema**

Run: `cd apps/backend && npx prisma validate`
Expected: `Your schema is valid.` (no drift/parse errors)

- [ ] **Step 5: Generate the migration**

Run: `cd apps/backend && npx prisma migrate dev --name add_tracking_pipeline`
Expected: a new migration directory `prisma/migrations/<timestamp>_add_tracking_pipeline/migration.sql` is created and applied to the local dev DB. (If `prisma migrate dev` reports drift, STOP and diagnose — do not run `db push`/`migrate reset`.)

- [ ] **Step 6: Review the generated migration.sql**

Read `apps/backend/prisma/migrations/<timestamp>_add_tracking_pipeline/migration.sql`. Confirm it:
- `CREATE TABLE` for each of the six models with the exact columns above.
- Adds `trackingSessionId TEXT` to `Order` and the `Order_trackingSessionId_idx` index.
- Does **NOT** drop or alter `TrackingEvent`, `Order`, or any unrelated table.

- [ ] **Step 7: Regenerate the client**

Run: `cd apps/backend && npx prisma generate`
Expected: Prisma Client regenerated with the new models (exit 0).

- [ ] **Step 8: Verify the backend build**

Run: `npm run build --workspace=backend`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 9: Commit (schema + migration atomic)**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations
git commit -m "feat(tracking): add tracking pipeline schema (context/snapshot/outbox/dispatch + replay archive)"
```

---
### Task 2: Tracking constants (statuses, event types, versions)

**Files:**
- Create: `apps/backend/src/tracking/tracking.constants.ts`
- Create: `apps/backend/src/tracking/__tests__/tracking.constants.spec.ts`

**Interfaces:**
- Consumes: nothing (Task 1 only added schema).
- Produces: `TRACKING_EVENT_TYPES` + type `TrackingEventType`; `OUTBOX_STATUS` + type `OutboxStatus`; `DISPATCH_STATUS` + type `DispatchStatus`; `SUCCESS_POLICIES` + type `SuccessPolicy`; `SCHEMA_VERSION`. Later phases import these to keep status strings consistent.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/tracking/__tests__/tracking.constants.spec.ts`:

```ts
import {
  TRACKING_EVENT_TYPES,
  OUTBOX_STATUS,
  DISPATCH_STATUS,
  SUCCESS_POLICIES,
  SCHEMA_VERSION,
} from '../tracking.constants';

describe('tracking.constants', () => {
  it('exposes the canonical event types (PageView excluded by design)', () => {
    expect(TRACKING_EVENT_TYPES).toEqual([
      'Purchase',
      'Refund',
      'AddToCart',
      'InitiateCheckout',
      'AddPaymentInfo',
      'ViewContent',
      'Search',
      'CompleteRegistration',
      'Lead',
    ]);
  });

  it('exposes the outbox status machine', () => {
    expect(OUTBOX_STATUS).toEqual(['PENDING', 'CLAIMED', 'SENT', 'FAILED', 'DEAD']);
  });

  it('exposes the dispatch status machine', () => {
    expect(DISPATCH_STATUS).toEqual([
      'PENDING',
      'SENDING',
      'SENT',
      'RETRY',
      'FAILED',
      'DEDUPED',
      'SKIPPED',
      'DEAD',
    ]);
  });

  it('exposes success policies and schema version', () => {
    expect(SUCCESS_POLICIES).toEqual(['ALL_SENT', 'ANY_SENT', 'N_SENT']);
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('freezes all exported arrays', () => {
    expect(Object.isFrozen(TRACKING_EVENT_TYPES)).toBe(true);
    expect(Object.isFrozen(OUTBOX_STATUS)).toBe(true);
    expect(Object.isFrozen(DISPATCH_STATUS)).toBe(true);
    expect(Object.isFrozen(SUCCESS_POLICIES)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/backend && npx jest src/tracking/__tests__/tracking.constants.spec.ts`
Expected: FAIL with `Cannot find module '../tracking.constants'`.

- [ ] **Step 3: Implement the constants**

Create `apps/backend/src/tracking/tracking.constants.ts`:

```ts
/** Canonical snapshot event types. PageView is deliberately excluded (Pixel + analytics only). */
export const TRACKING_EVENT_TYPES = Object.freeze([
  'Purchase',
  'Refund',
  'AddToCart',
  'InitiateCheckout',
  'AddPaymentInfo',
  'ViewContent',
  'Search',
  'CompleteRegistration',
  'Lead',
] as const);
export type TrackingEventType = (typeof TRACKING_EVENT_TYPES)[number];

/** TrackingOutbox.status — DB is source of truth. DEAD->PENDING only via ReplayService. */
export const OUTBOX_STATUS = Object.freeze(['PENDING', 'CLAIMED', 'SENT', 'FAILED', 'DEAD'] as const);
export type OutboxStatus = (typeof OUTBOX_STATUS)[number];

/** TrackingDispatch.status — per-provider state. Version columns are null for SKIPPED/DEDUPED. */
export const DISPATCH_STATUS = Object.freeze([
  'PENDING',
  'SENDING',
  'SENT',
  'RETRY',
  'FAILED',
  'DEDUPED',
  'SKIPPED',
  'DEAD',
] as const);
export type DispatchStatus = (typeof DISPATCH_STATUS)[number];

/** TrackingOutbox.configSnapshot.successPolicy */
export const SUCCESS_POLICIES = Object.freeze(['ALL_SENT', 'ANY_SENT', 'N_SENT'] as const);
export type SuccessPolicy = (typeof SUCCESS_POLICIES)[number];

/** Canonical snapshot payload schema version — bump only on breaking shape changes. */
export const SCHEMA_VERSION = 1;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/backend && npx jest src/tracking/__tests__/tracking.constants.spec.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/tracking/tracking.constants.ts apps/backend/src/tracking/__tests__/tracking.constants.spec.ts
git commit -m "feat(tracking): add shared tracking status/event-type constants"
```

---
### Task 3: TrackingSettingsService scaffold

**Files:**
- Create: `apps/backend/src/tracking/tracking-settings.service.ts`
- Create: `apps/backend/src/tracking/__tests__/tracking-settings.service.spec.ts`
- Modify: `apps/backend/src/tracking/tracking.module.ts`

**Interfaces:**
- Consumes: `PrismaService`, NestJS `ConfigService` (both already provided by `TrackingModule`'s imports — `PrismaModule`).
- Produces: `TrackingSettingsService.get(systemKey: string, envKey: string | null): Promise<string | null>`; `isEnabled(enabledKey: string): Promise<boolean>`; `getTestEventCode(provider: string): Promise<string | null>` (gated by the provider's test-mode flag; DB-only, no env fallback per design §4.11/D10). Later phases (adapters) consume these.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/src/tracking/__tests__/tracking-settings.service.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { TrackingSettingsService } from '../tracking-settings.service';

describe('TrackingSettingsService', () => {
  const findUnique = jest.fn();
  const prisma = { systemSetting: { findUnique } } as any;
  const config = new ConfigService();

  const service = new TrackingSettingsService(prisma, config);

  beforeEach(() => {
    jest.clearAllMocks();
    config.set('META_PIXEL_ID', '');
  });

  it('reads a system setting when present', async () => {
    findUnique.mockResolvedValue({ key: 'tracking_meta_pixel_id', value: 'PIX-1' });
    await expect(service.get('tracking_meta_pixel_id', null)).resolves.toBe('PIX-1');
    expect(findUnique).toHaveBeenCalledWith({ where: { key: 'tracking_meta_pixel_id' } });
  });

  it('falls back to env when the setting is absent', async () => {
    findUnique.mockResolvedValue(null);
    config.set('META_PIXEL_ID', 'PIX-ENV');
    await expect(service.get('tracking_meta_pixel_id', 'META_PIXEL_ID')).resolves.toBe('PIX-ENV');
  });

  it('returns null when setting and env are both absent', async () => {
    findUnique.mockResolvedValue(null);
    await expect(service.get('tracking_meta_pixel_id', 'META_PIXEL_ID')).resolves.toBeNull();
  });

  it('treats a read error as absent and falls back to env', async () => {
    findUnique.mockRejectedValue(new Error('db down'));
    config.set('META_PIXEL_ID', 'PIX-ENV');
    await expect(service.get('tracking_meta_pixel_id', 'META_PIXEL_ID')).resolves.toBe('PIX-ENV');
  });

  it('isEnabled returns true only for the string "true"', async () => {
    findUnique.mockResolvedValue({ key: 'tracking_meta_enabled', value: 'true' });
    await expect(service.isEnabled('tracking_meta_enabled')).resolves.toBe(true);
    findUnique.mockResolvedValue({ key: 'tracking_meta_enabled', value: 'false' });
    await expect(service.isEnabled('tracking_meta_enabled')).resolves.toBe(false);
  });

  it('gates test_event_code on the provider test-mode flag', async () => {
    // test mode off -> null even though a code exists
    findUnique.mockImplementation(({ where }) =>
      where.key === 'tracking_meta_test_mode'
        ? Promise.resolve(null)
        : Promise.resolve({ key: where.key, value: 'TEST123' }),
    );
    await expect(service.getTestEventCode('meta')).resolves.toBeNull();

    // test mode on -> code returned
    findUnique.mockImplementation(({ where }) =>
      where.key === 'tracking_meta_test_mode'
        ? Promise.resolve({ key: where.key, value: 'true' })
        : Promise.resolve({ key: where.key, value: 'TEST123' }),
    );
    await expect(service.getTestEventCode('meta')).resolves.toBe('TEST123');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/backend && npx jest src/tracking/__tests__/tracking-settings.service.spec.ts`
Expected: FAIL with `Cannot find module '../tracking-settings.service'`.

- [ ] **Step 3: Implement the service**

Create `apps/backend/src/tracking/tracking-settings.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TrackingSettingsService {
  private readonly logger = new Logger(TrackingSettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Read a system setting, falling back to an env var when the setting is absent or unreadable. */
  async get(systemKey: string, envKey: string | null): Promise<string | null> {
    try {
      const setting = await this.prisma.systemSetting.findUnique({
        where: { key: systemKey },
      });
      if (setting?.value) return setting.value;
    } catch (err) {
      this.logger.warn(`Failed to read setting ${systemKey}: ${err}`);
    }
    if (envKey) return this.config.get(envKey) || null;
    return null;
  }

  async isEnabled(enabledKey: string): Promise<boolean> {
    return (await this.get(enabledKey, null)) === 'true';
  }

  /**
   * test_event_code is honored only when the provider's explicit test-mode flag is set,
   * so a leftover value can never leak into production traffic (design v2 §4.11, fixes D10).
   */
  async getTestEventCode(provider: string): Promise<string | null> {
    const testMode = await this.get(`tracking_${provider}_test_mode`, null);
    if (testMode !== 'true') return null;
    return this.get(`tracking_${provider}_test_code`, null);
  }
}
```

- [ ] **Step 4: Register the service in the module**

Modify `apps/backend/src/tracking/tracking.module.ts`:
- Add `import { TrackingSettingsService } from './tracking-settings.service';`
- Add `TrackingSettingsService,` to the `providers:` array.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/backend && npx jest src/tracking/__tests__/tracking-settings.service.spec.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 6: Verify the backend build**

Run: `npm run build --workspace=backend`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/tracking/tracking-settings.service.ts apps/backend/src/tracking/__tests__/tracking-settings.service.spec.ts apps/backend/src/tracking/tracking.module.ts
git commit -m "feat(tracking): add TrackingSettingsService with gated test-event codes"
```

---
## Self-Review Notes

- **Spec coverage:** Task 1 = §15 schema + `Order.trackingSessionId` + `TrackingReplayArchive`; Task 2 = §4.2/§4.3/§4.4/§4.7/§8 status/enum/version constants; Task 3 = §4.11 settings + D10 test-code gating. Phase 0 roadmap's "settings config" and "schema only, no behavior change" are covered; `TrackingEvent` is untouched (retired in Phase 1/3).
- **Type consistency:** `eventTime` is `BigInt` in Task 1 and stays `BigInt` everywhere (§4.2, §4.10, §15). Version columns are nullable (`Int?`/`String?`) in Task 1, matching §4.4. Status strings in Task 2 exactly match the `@default(...)` comments in Task 1.
- **Placeholders:** none — every code step is complete.
