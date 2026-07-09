# Phase 5: Sales & Marketing — Implementation Plan
> **Superseded by:** `docs/3-DOMAINS/07-sales-marketing.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** Add coupon enhancements, marketing email campaigns, SMTP integration, and customer referral system.

**Architecture:** Each module = Prisma model + NestJS module + Admin UI. Builds on Phase 3 email queue + Phase 4 notification infrastructure.

---

### Task 1: Coupons Enhancement

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` — add CouponUsage model, add fields to Coupon
- Create: `apps/backend/src/coupons/coupons.service.ts`
- Modify: `apps/backend/src/coupons/coupons.controller.ts`
- Modify: `apps/backend/src/coupons/coupons.module.ts`
- Create: `apps/backend/src/coupons/dto/create-coupon.dto.ts` (rewrite)
- Create: `apps/backend/src/coupons/dto/update-coupon.dto.ts` (rewrite)
- Modify: `apps/backend/src/orders/orders.service.ts`
- Modify: `apps/admin/src/features/coupons/index.tsx`

**Changes:**

1. Add to Prisma schema:
```prisma
model CouponUsage {
  id        String   @id @default(uuid())
  couponId  String
  orderId   String
  userId    String?
  discount  Decimal  @db.Decimal(10, 2)
  usedAt    DateTime @default(now())

  coupon Coupon @relation(fields: [couponId], references: [id])
  order  Order  @relation(fields: [orderId], references: [id])
  user   User?  @relation(fields: [userId], references: [id])

  @@index([couponId])
  @@index([orderId])
  @@index([userId])
}
```

Add to Coupon model:
```prisma
  maxUsesPerCustomer Int?      
  minOrderValue      Decimal?  
  percentageCap      Decimal?  @db.Decimal(5, 2)
  usageCount         Int       @default(0)  // rename from usedCount
  usages             CouponUsage[]
```

2. Create CouponService with methods: validate(code, userId?), apply(code, orderId, userId), findAll, findOne, create, update, remove
3. Refactor controller to use service
4. Update orders.service.ts to call CouponService.apply() instead of inline SQL
5. Update admin UI: show usage history, add per-customer limit, percentage cap fields

---

### Task 2: SMTP Integration + Email Templates

**Files:**
- Install: nodemailer + @types/nodemailer (or use nodemailer if already present)
- Modify: `apps/backend/src/queue/email-queue/email-queue.processor.ts` — actual SMTP sending
- Create: `apps/backend/src/queue/email-queue/email-templates.ts` — template rendering
- Modify: `apps/backend/src/email/email.service.ts` — delegate to email queue
- Create: `apps/admin/src/features/settings/smtp-settings.tsx` — SMTP config UI
- Modify: `apps/admin/src/routes/_authenticated/mon/settings/general/index.tsx` — add SMTP tab

---

### Task 3: Marketing Campaigns

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` — add EmailTemplate, EmailCampaign, CampaignRecipient models
- Create: `apps/backend/src/campaigns/` — module, controller, service, DTOs
- Create: `apps/admin/src/features/campaigns/` — list, create, stats
- Modify: `apps/admin/src/routes/_authenticated/op/campaigns/index.tsx` — wire to feature component
- Modify: `apps/admin/src/components/layout/data/sidebar-data.ts` — add Campaigns nav

---

### Task 4: Customer Referral System

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` — add Referral, ReferralReward models
- Create: `apps/backend/src/referrals/` — module, controller, service, DTOs
- Create: `apps/admin/src/features/referrals/` — list, stats
- Create: `apps/admin/src/routes/_authenticated/op/referrals/index.tsx`
- Modify: `apps/admin/src/components/layout/data/sidebar-data.ts` — add Referrals nav

---

### Order of Execution

1. Task 1 (Coupon Enhancement) — independent
2. Task 2 (SMTP) — independent, needed by Task 3
3. Task 3 (Campaigns) — depends on Task 2
4. Task 4 (Referrals) — independent

Tasks 1, 2, 4 can be parallel. Task 3 after Task 2.
