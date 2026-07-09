# Blocking & Security System Implementation Plan
> **Superseded by:** `docs/2-ARCHITECTURE/ARCHITECTURE.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build complete IP/phone blocking system with whitelist, auto-detection, order restriction rules, and admin management UI.

**Architecture:** Extends Prisma schema with BlockedPhone + BlockSettings models and expands BlockedIp. Unified BlockedEntries service abstracts both IP and phone blocks. SecurityService handles auto-detect (failed login, order frequency). Middleware enforces full IP block at request level; OrdersService enforces order blocks.

**Tech Stack:** NestJS, Prisma, TanStack Router, React, Tailwind

---

## File Structure

### Modified Files:
- `apps/backend/prisma/schema.prisma` — Add BlockedPhone, BlockSettings models; extend BlockedIp
- `apps/backend/src/app.module.ts` — Register new modules
- `apps/backend/src/orders/orders.service.ts` — Add order block checks + auto-block
- `apps/backend/src/common/middleware/ip-block.middleware.ts` — Full block only, respect whitelist/expiry
- `apps/admin/src/features/customers/index.tsx` — Already updated (View button)

### New Backend Files:
- `apps/backend/src/blocked-entries/blocked-entries.module.ts`
- `apps/backend/src/blocked-entries/blocked-entries.service.ts`
- `apps/backend/src/blocked-entries/blocked-entries.controller.ts`
- `apps/backend/src/block-settings/block-settings.module.ts`
- `apps/backend/src/block-settings/block-settings.service.ts`
- `apps/backend/src/block-settings/block-settings.controller.ts`
- `apps/backend/src/security/security.module.ts`
- `apps/backend/src/security/security.service.ts`

### New Admin Files:
- `apps/admin/src/features/blocking/api.ts`
- `apps/admin/src/features/blocking/hooks.ts`
- `apps/admin/src/features/blocking/blocked-list.tsx`
- `apps/admin/src/features/blocking/block-settings.tsx`
- `apps/admin/src/routes/_authenticated/op/blocked/index.tsx`
- `apps/admin/src/routes/_authenticated/mon/blocking-settings.tsx`

---

### Task 1: Prisma Schema + Migration

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`

**Changes to BlockedIp model (extend existing):**
```
blockType   String    @default("order")
reason      String?
blockedBy   String?
isActive    Boolean   @default(true)
whitelisted Boolean   @default(false)
autoBlocked Boolean   @default(false)
expiresAt   DateTime?
createdAt   DateTime  @default(now())
updatedAt   DateTime  @updatedAt
```

**New BlockedPhone model:**
```
model BlockedPhone {
  id          String    @id @default(uuid())
  phone       String    @unique
  reason      String?
  blockedAt   DateTime  @default(now())
  blockedBy   String?
  isActive    Boolean   @default(true)
  whitelisted Boolean   @default(false)
  autoBlocked Boolean   @default(false)
  expiresAt   DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([phone])
  @@index([isActive])
}
```

**New BlockSettings model:**
```
model BlockSettings {
  id   String @id @default("singleton")
  data Json
}
```

**After editing schema:**
```bash
cd apps/backend && npx prisma generate
```

---

### Task 2: Backend — BlockedEntries Service + Controller

**Files:**
- Create: `apps/backend/src/blocked-entries/blocked-entries.module.ts`
- Create: `apps/backend/src/blocked-entries/blocked-entries.service.ts`
- Create: `apps/backend/src/blocked-entries/blocked-entries.controller.ts`

**blocked-entries.service.ts:**
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../common/utils/phone-utils';

@Injectable()
export class BlockedEntriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(type?: string, search?: string) {
    const ipBlocks = await this.prisma.blockedIp.findMany({
      where: type && type !== 'all' ? { blockType: type } : undefined,
      orderBy: { blockedAt: 'desc' },
    });
    const phoneBlocks = await this.prisma.blockedPhone.findMany({
      orderBy: { blockedAt: 'desc' },
    });

    const entries = [
      ...ipBlocks.map(b => ({ ...b, entryType: 'ip', value: b.ip })),
      ...phoneBlocks.map(b => ({ ...b, entryType: 'phone', value: b.phone })),
    ];

    if (search) {
      const q = search.toLowerCase();
      return entries.filter(e => e.value.toLowerCase().includes(q));
    }

    return entries;
  }

  async create(dto: { type: 'ip' | 'phone'; value: string; reason?: string; blockType?: string; blockedBy?: string }) {
    const blockType = dto.blockType || 'order';
    const expiresAt = null; // manual blocks never expire

    if (dto.type === 'ip') {
      return this.prisma.blockedIp.upsert({
        where: { ip: dto.value },
        update: { blockType, reason: dto.reason, blockedBy: dto.blockedBy, isActive: true, blockedAt: new Date(), expiresAt },
        create: { ip: dto.value, blockType, reason: dto.reason, blockedBy: dto.blockedBy, expiresAt },
      });
    } else {
      const phone = normalizePhone(dto.value) || dto.value;
      return this.prisma.blockedPhone.upsert({
        where: { phone },
        update: { reason: dto.reason, blockedBy: dto.blockedBy, isActive: true, blockedAt: new Date(), expiresAt },
        create: { phone, reason: dto.reason, blockedBy: dto.blockedBy, expiresAt },
      });
    }
  }

  async unblock(type: string, id: string) {
    if (type === 'ip') {
      await this.prisma.blockedIp.update({ where: { id }, data: { isActive: false } });
    } else {
      await this.prisma.blockedPhone.update({ where: { id }, data: { isActive: false } });
    }
  }

  async toggleWhitelist(type: string, id: string) {
    if (type === 'ip') {
      const entry = await this.prisma.blockedIp.findUnique({ where: { id } });
      await this.prisma.blockedIp.update({ where: { id }, data: { whitelisted: !entry?.whitelisted } });
    } else {
      const entry = await this.prisma.blockedPhone.findUnique({ where: { id } });
      await this.prisma.blockedPhone.update({ where: { id }, data: { whitelisted: !entry?.whitelisted } });
    }
  }

  async findBlockedIp(ip: string) {
    return this.prisma.blockedIp.findFirst({
      where: { ip, isActive: true, whitelisted: false, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
  }

  async findBlockedPhone(phone: string) {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    return this.prisma.blockedPhone.findFirst({
      where: { phone: normalized, isActive: true, whitelisted: false, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    });
  }

  async isIpWhitelisted(ip: string) {
    const entry = await this.prisma.blockedIp.findUnique({ where: { ip } });
    return entry?.whitelisted === true;
  }

  async isPhoneWhitelisted(phone: string) {
    const normalized = normalizePhone(phone);
    if (!normalized) return false;
    const entry = await this.prisma.blockedPhone.findUnique({ where: { phone: normalized } });
    return entry?.whitelisted === true;
  }
}
```

**blocked-entries.controller.ts:**
```typescript
import { Controller, Get, Post, Param, Query, Body, Req } from '@nestjs/common';
import { BlockedEntriesService } from './blocked-entries.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('blocked-entries')
export class BlockedEntriesController {
  constructor(private readonly svc: BlockedEntriesService) {}

  @Roles('superadmin', 'admin', 'manager')
  @Get()
  async findAll(@Query('type') type?: string, @Query('search') search?: string) {
    return this.svc.findAll(type, search);
  }

  @Roles('superadmin', 'admin')
  @Post()
  async create(@Body() dto: { type: 'ip' | 'phone'; value: string; reason?: string; blockType?: string }, @Req() req: any) {
    return this.svc.create({ ...dto, blockedBy: req.user?.username || 'admin' });
  }

  @Roles('superadmin', 'admin')
  @Post(':type/:id/unblock')
  async unblock(@Param('type') type: string, @Param('id') id: string) {
    await this.svc.unblock(type, id);
    return { success: true };
  }

  @Roles('superadmin', 'admin')
  @Post(':type/:id/whitelist')
  async toggleWhitelist(@Param('type') type: string, @Param('id') id: string) {
    await this.svc.toggleWhitelist(type, id);
    return { success: true };
  }
}
```

**blocked-entries.module.ts:**
```typescript
import { Module } from '@nestjs/common';
import { BlockedEntriesController } from './blocked-entries.controller';
import { BlockedEntriesService } from './blocked-entries.service';

@Module({
  controllers: [BlockedEntriesController],
  providers: [BlockedEntriesService],
  exports: [BlockedEntriesService],
})
export class BlockedEntriesModule {}
```

---

### Task 3: Backend — BlockSettings Service + Controller

**Files:**
- Create: `apps/backend/src/block-settings/block-settings.module.ts`
- Create: `apps/backend/src/block-settings/block-settings.service.ts`
- Create: `apps/backend/src/block-settings/block-settings.controller.ts`

**Default settings JSON:**
```typescript
const DEFAULT_SETTINGS = {
  phoneOrderRestriction: { maxOrders: 3, timeWindowMinutes: 60, blockDurationMinutes: 1440 },
  ipOrderRestriction: { maxOrders: 5, timeWindowMinutes: 60, blockDurationMinutes: 1440 },
  autoBlock: { failedLoginThreshold: 5, failedLoginWindowMinutes: 10, autoFullBlockIp: true, autoOrderBlockIp: true, autoOrderBlockPhone: true },
  blockMessages: {
    orderBlockPhone: { title: 'Order Blocked', message: 'Your phone has been temporarily blocked. Contact support.', ctaLabel: 'Call Support', ctaAction: 'tel:01700000000' },
    orderBlockIp: { title: 'Order Blocked', message: 'Orders from your IP are temporarily restricted.', ctaLabel: 'Need Help?', ctaAction: 'tel:01700000000' },
    fullBlockIp: { title: 'Access Denied', message: 'Your IP has been blocked.', ctaLabel: 'Contact Support', ctaAction: 'tel:01700000000' },
  },
};
```

Service provides `getSettings()` (init singleton on first call), `updateSettings(data)`.

---

### Task 4: Backend — SecurityService (Auto-Detect)

**Files:**
- Create: `apps/backend/src/security/security.module.ts`
- Create: `apps/backend/src/security/security.service.ts`

**SecurityService:**
- In-memory `Map<string, { count: number; firstAttempt: number }>` for failed logins
- `recordFailedLogin(ip: string)` — increments counter, checks threshold, auto-blocks if exceeded
- `recordOrder(phone: string, ip: string)` — called after order creation, checks frequency from DB
- Auto-cleanup every 60s for expired entries
- Whitelisted targets are skipped for auto-block

---

### Task 5: Backend — Enforcement Updates

**Files:**
- Modify: `apps/backend/src/common/middleware/ip-block.middleware.ts`
- Modify: `apps/backend/src/orders/orders.service.ts`
- Modify: `apps/backend/src/app.module.ts`

**ip-block.middleware.ts:** Check only `blockType: "full"` active blocks. Skip whitelisted. If `expiresAt < now`, lazily deactivate.

**orders.service.ts:** In `create()`:
1. Check `blockedEntriesService.findBlockedIp(req.ip)` for order blocks → throw with message
2. Check `blockedEntriesService.findBlockedPhone(dto.guestPhone)` → throw with message
3. After successful creation, call `securityService.recordOrder(phone, ip)` for auto-block check

**app.module.ts:** Register `BlockedEntriesModule`, `BlockSettingsModule`, `SecurityModule`

---

### Task 6: Admin — API + Hooks

**Files:**
- Create: `apps/admin/src/features/blocking/api.ts`
- Create: `apps/admin/src/features/blocking/hooks.ts`

**api.ts:** Exports:
- `blockedEntriesApi.list(type?, search?)`
- `blockedEntriesApi.create(data)` 
- `blockedEntriesApi.unblock(type, id)`
- `blockedEntriesApi.toggleWhitelist(type, id)`
- `blockSettingsApi.get()`
- `blockSettingsApi.update(data)`

**hooks.ts:** React Query hooks: `useBlockedEntries`, `useBlockEntryMutations`, `useBlockSettings`, `useUpdateBlockSettings`

---

### Task 7: Admin — Blocked List Page (/op/blocked)

**Files:**
- Create: `apps/admin/src/routes/_authenticated/op/blocked/index.tsx`
- Create: `apps/admin/src/features/blocking/blocked-list.tsx`

Full page with:
- Header with search + "Block IP" / "Block Phone" modals
- Table: Type, Value, Block Type, Reason, Blocked At, Blocked By, Auto, Whitelisted, Actions
- Actions: Unblock, Whitelist toggle
- Filter tabs: All / IP / Phone / Active / Whitelisted

---

### Task 8: Admin — Block Settings Page (/mon/blocking-settings)

**Files:**
- Create: `apps/admin/src/routes/_authenticated/mon/blocking-settings.tsx`
- Create: `apps/admin/src/features/blocking/block-settings.tsx`

Full page with:
- Order Restriction Rules card (phone + IP)
- Auto-Block Configuration card
- Block Messages card (title, message, ctaLabel, ctaAction per type)
- Save button

---

### Task 9: Typecheck & Verify

Run typecheck for all 3 apps:
```bash
cd apps/backend && npx tsc --noEmit
cd apps/admin && npx tsc --noEmit
cd apps/storefront && npx tsc --noEmit
```

Check for existing pre-admin errors that are not introduced by us.
