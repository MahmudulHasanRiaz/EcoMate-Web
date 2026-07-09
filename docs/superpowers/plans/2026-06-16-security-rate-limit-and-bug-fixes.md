# Security, Rate Limit & Incomplete Orders Bug Fixes
> **Superseded by:** `docs/2-ARCHITECTURE/ARCHITECTURE.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all identified bugs, security vulnerabilities, rate limiting gaps, and CSRF issues across the EcoMate Web codebase.

**Architecture:** The fixes span 4 independent domains: (1) rate limiting on public endpoints, (2) checkout leads bugs (display ID race condition, input validation, order close fix), (3) frontend checkout page bugs, (4) CSRF protection. Domains 1-4 are independent and can be dispatched in parallel.

**Tech Stack:** NestJS 11, Express, Prisma ORM, @nestjs/throttler, csrf-csrf, class-validator

---

## File Inventory

### Files to Create:
- `apps/backend/src/checkout-leads/dto/upsert-lead.dto.ts` — DTO for lead upsert validation

### Files to Modify:
- `apps/backend/src/checkout-leads/checkout-leads.controller.ts` — Add @Throttle + DTO validation
- `apps/backend/src/checkout-leads/checkout-leads.service.ts` — Fix display ID race condition
- `apps/backend/src/orders/orders.controller.ts` — Add @Throttle to create endpoint
- `apps/backend/src/orders/orders.service.ts` — Fix lead close for logged-in users
- `apps/backend/src/gateways/bkash-pgw.controller.ts` — Add @Throttle
- `apps/backend/src/upload/upload.controller.ts` — Add @Throttle
- `apps/backend/src/main.ts` — Add CSRF protection
- `apps/backend/src/media/media.controller.ts` — Add @Roles() to GET endpoints
- `apps/storefront/app/checkout/page.tsx` — Fix duplicate sendBeacon
- `apps/backend/src/checkout-leads/checkout-leads.module.ts` — Import validation dependencies (if needed)
- `apps/backend/package.json` — Add csrf-csrf dependency

---

### Task 1: Add Rate Limiting to Critical Public Endpoints

**Files:**
- Modify: `apps/backend/src/checkout-leads/checkout-leads.controller.ts:54-70`
- Modify: `apps/backend/src/orders/orders.controller.ts:88-92`
- Modify: `apps/backend/src/gateways/bkash-pgw.controller.ts:15-21`
- Modify: `apps/backend/src/upload/upload.controller.ts`

- [ ] **Step 1: Add rate limit to POST /checkout-leads**

In `checkout-leads.controller.ts`, add `@Throttle()` decorator to the upsert method:

```typescript
@Public()
@Throttle({ default: { ttl: 60000, limit: 10 } })
@Post()
upsert(
```

Import `Throttle` from `@nestjs/throttler` at the top.

- [ ] **Step 2: Add rate limit to POST /orders**

In `orders.controller.ts`, add `@Throttle()` to the create method:

```typescript
@Public()
@Throttle({ default: { ttl: 60000, limit: 5 } })
@Post()
create(@Body() dto: CreateOrderDto) {
```

Import `Throttle` at top.

- [ ] **Step 3: Add rate limit to POST /payments/bkash/create**

In `bkash-pgw.controller.ts`, add `@Throttle()`:

```typescript
@Public()
@Throttle({ default: { ttl: 60000, limit: 10 } })
@Post('create')
```

Import `Throttle` at top.

- [ ] **Step 4: Add rate limit to POST /upload**

Read the upload controller to find the upload endpoint, then add `@Throttle({ default: { ttl: 60000, limit: 10 } })`.

Target file: `apps/backend/src/upload/upload.controller.ts` or `apps/backend/src/media/` if upload is handled there.

Actually, check `apps/backend/src/upload/` for the upload controller.

---

### Task 2: Fix Checkout Lead Display ID Race Condition

**Files:**
- Modify: `apps/backend/src/checkout-leads/checkout-leads.service.ts:382-397`

- [ ] **Step 1: Fix `generateOrderDisplayId()` to use atomic transaction**

Replace the manual `findFirst` + increment logic with a Prisma `$transaction` + `orderCounter.upsert()` approach, identical to `orders.service.ts:59-67`:

```typescript
private async generateOrderDisplayId(): Promise<string> {
  const today = new Date();
  const yy = String(today.getFullYear()).slice(2);
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const dateStr = `${yy}${mm}${dd}`;
  const prefix = `ORD-${dateStr}`;

  return this.prisma.$transaction(async (tx) => {
    const counter = await tx.orderCounter.upsert({
      where: { date: dateStr },
      create: { date: dateStr, seq: 1 },
      update: { seq: { increment: 1 } },
    });
    return `${prefix}-${String(counter.seq).padStart(4, '0')}`;
  });
}
```

Note: `leadDisplayId()` (line 364-380) already uses the correct `$transaction` + `orderCounter.upsert()` approach. Only `generateOrderDisplayId()` needs fixing.

---

### Task 3: Add Input Validation DTO for Checkout Lead Upsert

**Files:**
- Create: `apps/backend/src/checkout-leads/dto/upsert-lead.dto.ts`
- Modify: `apps/backend/src/checkout-leads/checkout-leads.controller.ts:56-69`

- [ ] **Step 1: Create UpsertLeadDto**

Create `apps/backend/src/checkout-leads/dto/upsert-lead.dto.ts`:

```typescript
import {
  IsOptional,
  IsString,
  IsObject,
  IsArray,
  ValidateNested,
  IsNumber,
} from 'class-validator';
import { Type } from 'class-transformer';

class LeadItemDto {
  @IsOptional() @IsString() id?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsNumber() price?: number;
  @IsOptional() @IsNumber() quantity?: number;
  @IsOptional() @IsString() image?: string;
  @IsOptional() @IsString() comboId?: string;
}

export class UpsertLeadDto {
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsObject() address?: Record<string, unknown>;
  @IsOptional() @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LeadItemDto)
  items?: LeadItemDto[];
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
  @IsOptional() @IsString() paymentMethod?: string;
  @IsOptional() @IsString() fingerprint?: string;
}
```

- [ ] **Step 2: Update controller to use DTO**

In `checkout-leads.controller.ts`, replace the inline body type and import `UpsertLeadDto`:

```typescript
import { UpsertLeadDto } from './dto/upsert-lead.dto';
```

Change the `upsert` method to:

```typescript
@Public()
@Throttle({ default: { ttl: 60000, limit: 10 } })
@Post()
upsert(@Body() dto: UpsertLeadDto) {
  return this.svc.upsert(dto);
}
```

---

### Task 4: Fix Lead Close for Logged-in Users

**Files:**
- Modify: `apps/backend/src/orders/orders.service.ts:366-476`

- [ ] **Step 1: Fix the order create query to include customer data**

In `orders.service.ts`, modify the `order.create` to include `customer` so that `order.customer?.phoneNumber` is available at line 466:

Change the `create` call (line 366-433) to include customer:

```typescript
const order = await this.prisma.order.create({
  data: {
    // ... existing data ...
  },
  include: {
    customer: {
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phoneNumber: true,
      },
    },
    // ... existing includes ...
    status: true,
    items: {
      include: {
        product: { select: { id: true, name: true, images: true } },
      },
    },
  },
});
```

Now at line 466, `order.customer?.phoneNumber` will actually be available.

- [ ] **Step 2: Verify the phoneToClose logic works**

No code change needed if Step 1 is done correctly — `dto.guestPhone` is checked first, then `order.customer?.phoneNumber` will now be loaded correctly.

---

### Task 5: Fix Duplicate sendBeacon in Checkout Page

**Files:**
- Modify: `apps/storefront/app/checkout/page.tsx:491-503`

- [ ] **Step 1: Fix the lead capture on unmount to not double-fire**

Change the `beforeunload` cleanup effect to avoid duplicate sendBeacon calls. The `sendLead()` in the return cleanup is redundant when `beforeunload` also fires it:

```typescript
useEffect(() => {
  const beaconUrl = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/checkout-leads`;
  const sendLead = () => {
    const data = leadDataRef.current;
    if (data) navigator.sendBeacon(beaconUrl, new Blob([JSON.stringify(data)], { type: 'application/json' }));
  };

  // Only use beforeunload — the return cleanup already runs on unmount
  window.addEventListener('beforeunload', sendLead);
  return () => {
    window.removeEventListener('beforeunload', sendLead);
    if (leadTimer.current) clearTimeout(leadTimer.current);
    // Don't call sendLead() here — it already runs via beforeunload.
    // If the user navigates within the SPA, the timer-based capture handles it.
  };
}, []);
```

---

### Task 6: Add CSRF Protection

**Files:**
- Modify: `apps/backend/src/main.ts` — Add csrf-csrf middleware
- Modify: `apps/backend/package.json` — Add `csrf-csrf` dependency

- [ ] **Step 1: Install csrf-csrf package**

Run: `npm install csrf-csrf` in the backend directory (or workspace root).

- [ ] **Step 2: Add CSRF protection middleware to main.ts**

In `main.ts`, import and configure csrf-csrf. Skip CSRF for webhook endpoints (they use their own auth):

```typescript
import { doubleCsrf } from 'csrf-csrf';
import type { Request, Response } from 'express';

// After cookieParser setup:
const { doubleCsrfProtection, generateToken } = doubleCsrf({
  getSecret: () => process.env['CSRF_SECRET'] || 'eco-mate-csrf-secret-change-in-production',
  cookieName: 'x-csrf-token',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
});

// Apply CSRF protection to all routes except webhooks
app.use((req: Request, res: Response, next) => {
  if (req.path.startsWith('/api/webhooks/')) {
    return next();
  }
  doubleCsrfProtection(req, res, next);
});

// Expose CSRF token endpoint
app.get('/api/csrf-token', (req: Request, res: Response) => {
  res.json({ csrfToken: generateToken(req, res) });
});
```

Also add the CSRF_SECRET to `.env`.

- [ ] **Step 3: Update .env file**

Add `CSRF_SECRET="eco-mate-csrf-secret-change-in-production"` to `apps/backend/.env`.

---

### Task 7: Fix Media Controller Access Control

**Files:**
- Modify: `apps/backend/src/media/media.controller.ts:18-43`

- [ ] **Step 1: Add @Roles() to GET /media endpoints**

In `media.controller.ts`, add `@Roles('superadmin', 'admin', 'manager')` to `findAll`, `findOne`, and `getAttachments`:

```typescript
@Roles('superadmin', 'admin', 'manager')
@Get()
findAll(...) { ... }

@Roles('superadmin', 'admin', 'manager')
@Get(':id')
findOne(...) { ... }

@Roles('superadmin', 'admin', 'manager')
@Get(':id/attachments')
getAttachments(...) { ... }
```

---

### Task 8: Remove `@SkipThrottle` from Auth Refresh

**Files:**
- Modify: `apps/backend/src/auth/auth.controller.ts:69`

- [ ] **Step 1: Add rate limit to refresh endpoint**

Replace `@SkipThrottle()` with a reasonable limit:

```typescript
@Throttle({ default: { ttl: 60000, limit: 20 } })
@Public()
@UseGuards(RefreshJwtGuard)
@Post('refresh')
```

---

### Verification

After all tasks are done:

- [ ] **Verify rate limits:** Check every public endpoint has a `@Throttle()` decorator
- [ ] **Build check:** `npm run build` in backend
- [ ] **TypeScript check:** `npx tsc --noEmit` in backend
