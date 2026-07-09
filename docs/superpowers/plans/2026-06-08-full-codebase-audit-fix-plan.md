# Full Codebase Audit Fix Plan
> **Superseded by:** `docs/2-ARCHITECTURE/ARCHITECTURE.md` — migrated to domain-specific documentation during Phase 2 architecture cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all 85+ issues found across Backend, Admin, and Storefront, and add Storefront Menu Category Management feature.

**Architecture:** 6 sequential phases — Critical crashes → Security → Data integrity → Storefront → Admin → Menu Categories. Each phase is independently testable.

**Tech Stack:** NestJS 11 + Prisma + PostgreSQL (backend), React 19 + Vite + TanStack Router (admin), Next.js 16 (storefront)

---

## File Structure Map

### Files to Create
| # | File | Purpose |
|---|------|---------|
| 1 | `apps/backend/prisma/migrations/20260608000001_add_menu_fields_to_category/` | Migration: add `showInMenu`, `menuSortOrder` to Category |
| 2 | `apps/storefront/components/MenuCategories.tsx` | Server Component to fetch & render menu categories |
| 3 | `apps/admin/src/features/settings/storefront/components/sections/menu-categories.tsx` | Admin UI: toggle & reorder categories in menu |
| 4 | `apps/backend/src/common/guards/throttler.guard.ts` | Rate limiting guard (if not existing) |

### Files to Modify
See each task for exact paths.

---

## Phase 1: CRITICAL CRASH FIXES (Batch 1)

### Task 1.1: Fix Inventory Page — Missing useState

**Files:**
- Modify: `apps/admin/src/features/inventory/index.tsx:1-20`

- [ ] **Add missing useState declarations**

In `apps/admin/src/features/inventory/index.tsx`, find the state declarations section (around line 10-20) and add:

```tsx
const [quantity, setQuantity] = useState('0')
const [reason, setReason] = useState('')
```

These must be declared before they are used in the JSX and mutation callbacks.

- [ ] **Verify the fix**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: No `ReferenceError` for `quantity` or `reason`

- [ ] **Commit**

```bash
git add apps/admin/src/features/inventory/index.tsx
git commit -m "fix(admin): add missing useState for quantity/reason in Inventory"
```

### Task 1.2: Fix Categories Page — Wrong Response Extraction

**Files:**
- Modify: `apps/admin/src/features/categories/index.tsx:26`
- Modify: `apps/admin/src/features/products/index.tsx:36`
- Modify: `apps/admin/src/features/products/components/product-form.tsx:32`

- [ ] **Fix categoriesApi.list response extraction**

In `apps/admin/src/features/categories/index.tsx:26`, change:
```tsx
queryFn: () => categoriesApi.list().then(r => r.data),
```
to:
```tsx
queryFn: () => categoriesApi.list().then(r => r.data.data || []),
```

- [ ] **Fix products filter category extraction**

In `apps/admin/src/features/products/index.tsx:36`, change:
```tsx
.then(r => Array.isArray(r.data) ? r.data : [])
```
to:
```tsx
.then(r => r.data?.data || [])
```

- [ ] **Fix product form category dropdown**

In `apps/admin/src/features/products/components/product-form.tsx:32`, change:
```tsx
.then(r => Array.isArray(r.data) ? r.data : [])
```
to:
```tsx
.then(r => r.data?.data || [])
```

- [ ] **Verify**

Run: `cd apps/admin && npx tsc --noEmit`
Expected: No type errors

- [ ] **Commit**

```bash
git add apps/admin/src/features/categories/index.tsx apps/admin/src/features/products/index.tsx apps/admin/src/features/products/components/product-form.tsx
git commit -m "fix(admin): fix category response extraction - unwrap PaginatedResponse wrapper"
```

### Task 1.3: Fix Bulk Operations — Wrong Response Level

**Files:**
- Modify: `apps/admin/src/features/products/index.tsx:65-69,76-79`

- [ ] **Fix bulkDeleteMut onSuccess**

Change:
```tsx
onSuccess: (res: any) => {
  toast.success(`${res.success} product(s) deleted${res.failed ? `, ${res.failed} failed` : ''}`);
  if (res.errors?.length) console.error('Bulk delete errors:', res.errors);
},
```
to:
```tsx
onSuccess: (res: any) => {
  const d = res.data || res;
  toast.success(`${d.success} product(s) deleted${d.failed ? `, ${d.failed} failed` : ''}`);
  if (d.errors?.length) console.error('Bulk delete errors:', d.errors);
},
```

- [ ] **Fix bulkUpdateMut onSuccess**

Change:
```tsx
onSuccess: (res: any) => {
  toast.success(`${res.success} product(s) updated${res.failed ? `, ${res.failed} failed` : ''}`);
},
```
to:
```tsx
onSuccess: (res: any) => {
  const d = res.data || res;
  toast.success(`${d.success} product(s) updated${d.failed ? `, ${d.failed} failed` : ''}`);
},
```

- [ ] **Commit**

```bash
git add apps/admin/src/features/products/index.tsx
git commit -m "fix(admin): unwrap Axios response in bulk delete/update handlers"
```

### Task 1.4: Add sonner Dependency to Storefront

**Files:**
- Modify: `apps/storefront/package.json`

- [ ] **Add sonner to dependencies**

In `apps/storefront/package.json`, add to `dependencies`:
```json
"sonner": "^2.0.7"
```

Run: `cd apps/storefront && npm install`

- [ ] **Commit**

```bash
git add apps/storefront/package.json apps/storefront/package-lock.json
git commit -m "fix(storefront): add missing sonner dependency"
```

---

## Phase 2: SECURITY (Batch 2)

### Task 2.1: Enforce JWT Secret From Environment

**Files:**
- Modify: `apps/backend/src/auth/jwt.strategy.ts:11`
- Modify: `apps/backend/src/auth/auth.service.ts:190,197`

- [ ] **Replace hardcoded fallback with explicit env check**

In `apps/backend/src/auth/jwt.strategy.ts:11`, change:
```ts
secretOrKey: process.env['JWT_SECRET'] || 'eco-mate-jwt-secret',
```
to:
```ts
secretOrKey: process.env['JWT_SECRET'],
```

In `apps/backend/src/auth/auth.service.ts:190`, change:
```ts
secret: process.env['JWT_SECRET'] || 'eco-mate-jwt-secret',
```
to:
```ts
secret: process.env['JWT_SECRET'],
```

In `apps/backend/src/auth/auth.service.ts:197`, change:
```ts
secret: process.env['JWT_REFRESH_SECRET'] || 'eco-mate-refresh-secret',
```
to:
```ts
secret: process.env['JWT_REFRESH_SECRET'],
```

- [ ] **Add startup validation**

In `apps/backend/src/main.ts`, add after `bootstrap()`:
```ts
if (!process.env['JWT_SECRET'] || !process.env['JWT_REFRESH_SECRET']) {
  throw new Error('JWT_SECRET and JWT_REFRESH_SECRET environment variables are required');
}
```

- [ ] **Commit**

```bash
git add apps/backend/src/auth/jwt.strategy.ts apps/backend/src/auth/auth.service.ts apps/backend/src/main.ts
git commit -m "fix(backend): enforce JWT secrets from env - remove hardcoded fallbacks"
```

### Task 2.2: Fix Mass Assignment via customerInfo

**Files:**
- Modify: `apps/backend/src/orders/dto/order.dto.ts:61`
- Modify: `apps/backend/src/orders/orders.service.ts:463-467`

- [ ] **Create strict CustomerInfoDto**

In `apps/backend/src/orders/dto/order.dto.ts`, add:
```ts
export class CustomerInfoDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
```

Change the `customerInfo` field in `UpdateOrderDto`:
```ts
@IsObject()
@ValidateNested()
@Type(() => CustomerInfoDto)
customerInfo?: CustomerInfoDto;
```

- [ ] **Update orders.service.ts to validate fields**

In `apps/backend/src/orders/orders.service.ts:463-467`, replace:
```ts
if (dto.customerInfo) {
  await this.prisma.user.update({
    where: { id: order.customerId },
    data: dto.customerInfo,
  });
}
```
with:
```ts
if (dto.customerInfo) {
  const allowedFields: (keyof CustomerInfoDto)[] = ['firstName', 'lastName', 'phoneNumber', 'email'];
  const safeData: Record<string, string> = {};
  for (const field of allowedFields) {
    if (dto.customerInfo[field] !== undefined) {
      safeData[field] = dto.customerInfo[field] as string;
    }
  }
  if (Object.keys(safeData).length > 0) {
    await this.prisma.user.update({
      where: { id: order.customerId },
      data: safeData,
    });
  }
}
```

- [ ] **Commit**

```bash
git add apps/backend/src/orders/dto/order.dto.ts apps/backend/src/orders/orders.service.ts
git commit -m "fix(backend): prevent mass assignment via customerInfo with strict DTO"
```

### Task 2.3: Add Auth Guards to All CRUD Endpoints

**Files:**
- Modify: `apps/backend/src/users/users.controller.ts`
- Modify: `apps/backend/src/categories/categories.controller.ts`
- Modify: `apps/backend/src/attributes/attributes.controller.ts`
- Modify: `apps/backend/src/coupons/coupons.controller.ts`
- Modify: `apps/backend/src/tasks/tasks.controller.ts`

- [ ] **Add @Roles decorators to each controller**

For `users.controller.ts`, add `@Roles('superadmin', 'admin')` to create, update, remove, invite endpoints.

For `categories.controller.ts`, add `@Roles('superadmin', 'admin', 'manager')` to create, update, remove endpoints.

For `attributes.controller.ts`, add `@Roles('superadmin', 'admin', 'manager')` to create, update, remove endpoints.

For `coupons.controller.ts`, add `@Roles('superadmin', 'admin', 'manager')` to create, update, remove endpoints.

For `tasks.controller.ts`, add `@Roles('superadmin', 'admin', 'manager')` to create, update, remove endpoints.

Example (categories):
```ts
@Post()
@Roles('superadmin', 'admin', 'manager')
async create(@Body() dto: CreateCategoryDto) { ... }
```

- [ ] **Commit**

```bash
git add apps/backend/src/users/users.controller.ts apps/backend/src/categories/categories.controller.ts apps/backend/src/attributes/attributes.controller.ts apps/backend/src/coupons/coupons.controller.ts apps/backend/src/tasks/tasks.controller.ts
git commit -m "fix(backend): add role-based access control to all CRUD endpoints"
```

### Task 2.4: Add RedX Webhook Authentication

**Files:**
- Modify: `apps/backend/src/courier-manager/courier-webhook.controller.ts:61-65`

- [ ] **Add webhook signature verification**

In `handleRedx()` method, add before processing:
```ts
const signature = request.headers['x-redx-signature'] as string;
const webhookSecret = process.env['REDX_WEBHOOK_SECRET'];
if (webhookSecret && signature) {
  const payload = JSON.stringify(body);
  const expected = crypto.createHmac('sha256', webhookSecret).update(payload).digest('hex');
  if (signature !== expected) {
    throw new UnauthorizedException('Invalid webhook signature');
  }
}
```

Add `import * as crypto from 'crypto'` at top.

- [ ] **Commit**

```bash
git add apps/backend/src/courier-manager/courier-webhook.controller.ts
git commit -m "fix(backend): add HMAC signature verification for RedX webhooks"
```

### Task 2.5: Add Secure Flags to Auth Cookie

**Files:**
- Modify: `apps/admin/src/lib/cookies.ts:33`

- [ ] **Add Secure/HttpOnly/SameSite flags**

In `apps/admin/src/lib/cookies.ts`, change:
```ts
document.cookie = `${name}=${value}; path=/; max-age=${maxAge}`;
```
to:
```ts
const secureFlag = window.location.protocol === 'https:' ? '; Secure' : '';
document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}${secureFlag}; SameSite=Lax`;
```

- [ ] **Commit**

```bash
git add apps/admin/src/lib/cookies.ts
git commit -m "fix(admin): add Secure and SameSite flags to auth cookie"
```

### Task 2.6: Add Rate Limiting to Backend

**Files:**
- Create: `apps/backend/src/common/guards/throttler.guard.ts` (if using custom)
- Modify: `apps/backend/package.json`
- Modify: `apps/backend/src/app.module.ts`

- [ ] **Install @nestjs/throttler**

Run: `cd apps/backend && npm install @nestjs/throttler`

- [ ] **Configure throttler in app.module.ts**

In `apps/backend/src/app.module.ts`:
```ts
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

// In imports array:
ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),

// In providers array:
{ provide: APP_GUARD, useClass: ThrottlerGuard },
```

- [ ] **Add @SkipThrottle to health endpoint**

In `apps/backend/src/health/health.controller.ts`, add `@SkipThrottle()` decorator.

- [ ] **Commit**

```bash
git add apps/backend/package.json apps/backend/src/app.module.ts apps/backend/src/health/health.controller.ts
git commit -m "feat(backend): add rate limiting with @nestjs/throttler"
```

---

## Phase 3: DATA INTEGRITY & BUSINESS LOGIC (Batch 3)

### Task 3.1: Fix Checkout — Cart Cleared Before Payment

**Files:**
- Modify: `apps/storefront/app/checkout/page.tsx:544-562`

- [ ] **Move clearCart after payment flow**

In `apps/storefront/app/checkout/page.tsx`, restructure the payment flow:

```tsx
const order = await createOrder(payload);

if (isOnlinePayment) {
  // Don't clear cart yet — payment popup may be cancelled
  setPaymentPopup({ orderId: order.id, total: totalWithDelivery });
  // Cart is cleared in the payment success callback
} else {
  clearCart();
  // Clear checkout localStorage
  try {
    ['checkout_guestName','checkout_guestPhone','checkout_district','checkout_thana',
     'checkout_address','checkout_notes','checkout_paymentMode'].forEach(k => localStorage.removeItem(k));
  } catch {}
  router.push(`/checkout/thank-you?orderId=${order.id}`);
}
```

Then in the payment success handler (around line 700-720), add `clearCart()` call.

- [ ] **Commit**

```bash
git add apps/storefront/app/checkout/page.tsx
git commit -m "fix(storefront): move clearCart after payment success to prevent data loss"
```

### Task 3.2: Fix Refund — Respect manageStock Flag

**Files:**
- Modify: `apps/backend/src/refunds/refunds.service.ts:138-173`

- [ ] **Add manageStock check before restocking**

In `apps/backend/src/refunds/refunds.service.ts`, before incrementing stock:
```ts
// Only restock if the product manages stock
if (orderItem.product?.manageStock !== false) {
  await this.prisma.productVariant.update({
    where: { id: item.variantId },
    data: { stock: { increment: item.qty } },
  });
}
```

Do this for both single-item refund (line ~138) and bulk refund (line ~168).

- [ ] **Commit**

```bash
git add apps/backend/src/refunds/refunds.service.ts
git commit -m "fix(backend): respect manageStock flag during refund restock"
```

### Task 3.3: Fix Inventory — Respect manageStock Flag

**Files:**
- Modify: `apps/backend/src/inventory/inventory.service.ts:32-55`

- [ ] **Add manageStock check in adjust()**

Before adjusting stock:
```ts
const product = await this.prisma.product.findUnique({
  where: { id: data.productId },
  select: { manageStock: true },
});
if (product && !product.manageStock) {
  throw new BadRequestException('This product does not manage stock');
}
```

- [ ] **Commit**

```bash
git add apps/backend/src/inventory/inventory.service.ts
git commit -m "fix(backend): prevent stock adjustment on non-managed products"
```

### Task 3.4: Fix "New Arrivals" vs "Popular Items" Duplicate Data

**Files:**
- Modify: `apps/storefront/lib/api/products-server.ts:142-161`

- [ ] **Make getPopularItemsServer use different criteria**

Change `getPopularItemsServer()`:
```ts
export async function getPopularItemsServer(perPage = 8) {
  const params = new URLSearchParams({
    isActive: 'true',
    isFeatured: 'true',
    sort: 'orderCount',  // or 'soldCount' — whichever field exists
    order: 'desc',
    perPage: String(perPage),
  });
  const res = await serverFetch<any>(`/products?${params}`, { revalidate: 300 });
  // ... rest
}
```

If the backend doesn't have an `orderCount` field, fallback to sorting by `updatedAt` with a note to add popularity tracking later.

- [ ] **Commit**

```bash
git add apps/storefront/lib/api/products-server.ts
git commit -m "fix(storefront): differentiate New Arrivals and Popular Items queries"
```

### Task 3.5: Fix getProductBySlug — Use Dedicated Endpoint

**Files:**
- Modify: `apps/storefront/lib/api/products.ts:110-117`
- Modify: `apps/storefront/lib/api/products-server.ts:163-174`

- [ ] **Update client-side getProductBySlug**

Change to:
```ts
export async function getProductBySlug(slug: string): Promise<any | null> {
  try {
    const { data } = await apiClient.get(`/products/slug/${encodeURIComponent(slug)}`);
    return data;
  } catch {
    return null;
  }
}
```

- [ ] **Update server-side getProductBySlugServer**

Change to:
```ts
export async function getProductBySlugServer(slug: string): Promise<any | null> {
  return serverFetch(`/products/slug/${encodeURIComponent(slug)}`, { revalidate: 60 });
}
```

- [ ] **Add slug endpoint to backend**

In `apps/backend/src/products/products.controller.ts`, add:
```ts
@Public()
@Get('slug/:slug')
async findBySlug(@Param('slug') slug: string) {
  return this.productsService.findBySlug(slug);
}
```

In `apps/backend/src/products/products.service.ts`, add:
```ts
async findBySlug(slug: string) {
  const product = await this.prisma.product.findUnique({
    where: { slug },
    include: { /* same includes as findOne */ },
  });
  if (!product) throw new NotFoundException('Product not found');
  return product;
}
```

- [ ] **Commit**

```bash
git add apps/storefront/lib/api/products.ts apps/storefront/lib/api/products-server.ts apps/backend/src/products/products.controller.ts apps/backend/src/products/products.service.ts
git commit -m "fix(storefront+backend): add dedicated /products/slug/:slug endpoint"
```

### Task 3.6: Fix Coupon Display on Checkout

**Files:**
- Modify: `apps/storefront/app/checkout/page.tsx:378,876`

- [ ] **Add coupon discount to totalWithDelivery**

Find where `totalWithDelivery` is calculated (around line 378):
```tsx
const totalWithDelivery = cartTotal + deliveryCharge;
```
Change to:
```tsx
const discountAmount = appliedCoupon?.discount
  ? (appliedCoupon.type === 'percentage'
    ? (cartTotal * appliedCoupon.discount) / 100
    : appliedCoupon.discount)
  : 0;
const totalWithDelivery = cartTotal + deliveryCharge - discountAmount;
```

Update the display in the PAY button (line ~876) and order summary section to show the discount line item.

- [ ] **Commit**

```bash
git add apps/storefront/app/checkout/page.tsx
git commit -m "fix(storefront): show coupon discount in checkout total display"
```

---

## Phase 4: STOREFRONT FIXES (Batch 4)

### Task 4.1: Implement Real Orders Page

**Files:**
- Modify: `apps/storefront/app/orders/page.tsx`

- [ ] **Add real API integration**

Change the page to call API on "Track" button click:

```tsx
import { serverFetch } from '@/lib/api-server';

const handleSearch = async (e: React.FormEvent) => {
  e.preventDefault();
  if (!orderNumber.trim()) return;
  setIsSearched(true);
  setLoading(true);
  setError(null);
  try {
    const data = await serverFetch(`/orders/public/${encodeURIComponent(orderNumber)}`);
    setOrder(data);
  } catch {
    setError('Order not found. Please check your order number.');
  } finally {
    setLoading(false);
  }
};
```

If no public order lookup endpoint exists, add one in the backend:
```ts
// In orders.controller.ts
@Public()
@Get('public/:viewToken')
async findByViewToken(@Param('viewToken') viewToken: string) {
  return this.ordersService.findByViewToken(viewToken);
}
```

- [ ] **Commit**

```bash
git add apps/storefront/app/orders/page.tsx
git commit -m "feat(storefront): implement real order tracking with API integration"
```

### Task 4.2: Fix Account Page — Save Changes

**Files:**
- Modify: `apps/storefront/app/account/page.tsx:243-258`

- [ ] **Add useState and onChange handlers**

Add state:
```tsx
const [profile, setProfile] = useState({
  name: user?.name || '',
  email: user?.email || '',
  phone: user?.phone || '',
});
const [saving, setSaving] = useState(false);
```

Add onChange to inputs:
```tsx
<input
  defaultValue={profile.name}
  onChange={e => setProfile(p => ({ ...p, name: e.target.value }))}
  className="w-full px-4 py-3 border rounded-xl"
/>
```

Add onClick to save button:
```tsx
<button
  onClick={async () => {
    setSaving(true);
    try {
      await apiClient.put('/users/profile', profile);
      toast.success('Profile updated successfully');
    } catch {
      toast.error('Failed to update profile');
    } finally {
      setSaving(false);
    }
  }}
  disabled={saving}
  className="px-6 py-3 bg-brand-blue text-white rounded-xl disabled:opacity-50"
>
  {saving ? 'Saving...' : 'Save Changes'}
</button>
```

- [ ] **Commit**

```bash
git add apps/storefront/app/account/page.tsx
git commit -m "fix(storefront): implement account profile save functionality"
```

### Task 4.3: Fix Category Navigation — Use CategoryId

**Files:**
- Modify: `apps/storefront/components/Header.tsx:159`
- Modify: `apps/storefront/components/MobileMenu.tsx`

- [ ] **Update Header to use category ID**

Change the nav item generation. The navItems should include category items with `href: /products?categoryId={id}`:

In the Header component, add a categories state that's populated alongside nav items:

```tsx
// Instead of deriving href from name:
const navItems = config.navigation?.items?.length ? config.navigation.items.map(item => {
  // If this nav item references a category, use its ID
  if (item.categoryId) {
    return { ...item, href: `/products?categoryId=${item.categoryId}` };
  }
  return item;
}) : [];
```

- [ ] **Update MobileMenu.tsx similarly**

Same pattern.

- [ ] **Commit**

```bash
git add apps/storefront/components/Header.tsx apps/storefront/components/MobileMenu.tsx
git commit -m "fix(storefront): use categoryId instead of name for menu navigation"
```

### Task 4.4: Sanitize Product Description (XSS Fix)

**Files:**
- Modify: `apps/storefront/components/ProductDetailClient.tsx:255`

- [ ] **Add HTML sanitization**

Install DOMPurify:
```bash
cd apps/storefront && npm install isomorphic-dompurify dompurify
```

Update the dangerouslySetInnerHTML:
```tsx
import DOMPurify from 'isomorphic-dompurify';

// In component:
dangerouslySetInnerHTML={{
  __html: DOMPurify.sanitize(product.description, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'img', 'span', 'div', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'target', 'src', 'alt', 'class', 'style', 'width', 'height'],
  })
}}
```

- [ ] **Commit**

```bash
git add apps/storefront/components/ProductDetailClient.tsx apps/storefront/package.json
git commit -m "fix(storefront): add HTML sanitization to product description (XSS fix)"
```

### Task 4.5: Fix Production API Rewrite

**Files:**
- Modify: `apps/storefront/next.config.ts:19`

- [ ] **Add environment-aware rewrite destination**

Change:
```ts
destination: 'http://localhost:4000/api/:path*'
```
to:
```ts
destination: `${process.env.API_URL || 'http://localhost:4000'}/api/:path*'
```

Add `API_URL` to production env config.

- [ ] **Commit**

```bash
git add apps/storefront/next.config.ts
git commit -m "fix(storefront): make API rewrite destination configurable via env"
```

### Task 4.6: Add SEO — sitemap, robots, metadata

**Files:**
- Create: `apps/storefront/app/sitemap.ts`
- Create: `apps/storefront/app/robots.ts`
- Modify: Various page files for `generateMetadata`

- [ ] **Create sitemap.ts**

```tsx
import type { MetadataRoute } from 'next';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://example.com';

  // Fetch categories for dynamic routes
  let categories: { slug: string; updatedAt: string }[] = [];
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/categories?isActive=true`);
    const data = await res.json();
    categories = (data.data || data || []).map((c: any) => ({
      slug: c.slug,
      updatedAt: c.updatedAt,
    }));
  } catch {}

  const staticPages = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: 'daily' as const, priority: 1 },
    { url: `${baseUrl}/about`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${baseUrl}/faq`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.5 },
    { url: `${baseUrl}/privacy-policy`, lastModified: new Date(), changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${baseUrl}/terms-conditions`, lastModified: new Date(), changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${baseUrl}/shipping-policy`, lastModified: new Date(), changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${baseUrl}/refund-policy`, lastModified: new Date(), changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${baseUrl}/exchange-policy`, lastModified: new Date(), changeFrequency: 'yearly' as const, priority: 0.3 },
    { url: `${baseUrl}/delivery-areas`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.4 },
    { url: `${baseUrl}/stores`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.4 },
    { url: `${baseUrl}/support`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.4 },
    { url: `${baseUrl}/careers`, lastModified: new Date(), changeFrequency: 'monthly' as const, priority: 0.4 },
    { url: `${baseUrl}/combos`, lastModified: new Date(), changeFrequency: 'daily' as const, priority: 0.8 },
  ];

  const categoryPages = categories.map(cat => ({
    url: `${baseUrl}/products?category=${cat.slug}`,
    lastModified: new Date(cat.updatedAt),
    changeFrequency: 'daily' as const,
    priority: 0.7,
  }));

  return [...staticPages, ...categoryPages];
}
```

- [ ] **Create robots.ts**

```tsx
import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://example.com';
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/account/', '/admin/'] },
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
```

- [ ] **Add generateMetadata to product/combo pages**

For `apps/storefront/app/products/[slug]/page.tsx` and `apps/storefront/app/combos/[id]/page.tsx`, add `generateMetadata` following the pattern in AGENTS.md.

- [ ] **Commit**

```bash
git add apps/storefront/app/sitemap.ts apps/storefront/app/robots.ts apps/storefront/app/products/[slug]/page.tsx apps/storefront/app/combos/[id]/page.tsx
git commit -m "feat(storefront): add sitemap, robots, and page-level metadata"
```

### Task 4.7: Add Error/Loading/Not-Found Boundaries

**Files:**
- Create: `apps/storefront/app/error.tsx`
- Create: `apps/storefront/app/not-found.tsx`
- Create: `apps/storefront/app/loading.tsx`
- Create: `apps/storefront/app/products/error.tsx`
- Create: `apps/storefront/app/checkout/error.tsx`
- Create: `apps/storefront/app/checkout/thank-you/error.tsx`

- [ ] **Create root error.tsx**

```tsx
'use client';
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center px-4">
        <h1 className="text-4xl font-bold text-red-600 mb-4">Something went wrong</h1>
        <p className="text-gray-600 mb-6">{error.message || 'An unexpected error occurred.'}</p>
        <button onClick={reset} className="px-6 py-3 bg-brand-blue text-white rounded-xl hover:opacity-90">
          Try again
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Create root not-found.tsx**

```tsx
import Link from 'next/link';
export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center px-4">
        <h1 className="text-6xl font-bold text-gray-300 mb-4">404</h1>
        <p className="text-gray-600 mb-6">Page not found</p>
        <Link href="/" className="px-6 py-3 bg-brand-blue text-white rounded-xl inline-block hover:opacity-90">
          Go Home
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Create root loading.tsx**

```tsx
export default function Loading() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="animate-spin h-10 w-10 border-4 border-brand-blue border-t-transparent rounded-full" />
    </div>
  );
}
```

- [ ] **Commit**

```bash
git add apps/storefront/app/error.tsx apps/storefront/app/not-found.tsx apps/storefront/app/loading.tsx apps/storefront/app/products/error.tsx apps/storefront/app/checkout/error.tsx apps/storefront/app/checkout/thank-you/error.tsx
git commit -m "feat(storefront): add error, not-found, and loading boundaries"
```

---

## Phase 5: ADMIN FIXES (Batch 5)

### Task 5.1: Fix Dashboard — Connect to Real API

**Files:**
- Modify: `apps/admin/src/features/dashboard/index.tsx:79`
- Modify: `apps/admin/src/features/dashboard/components/overview.tsx`
- Modify: `apps/admin/src/features/dashboard/components/analytics.tsx`

- [ ] **Call API in dashboard index.tsx**

Replace hardcoded data with API calls:
```tsx
const { data: stats, isLoading: statsLoading } = useQuery({
  queryKey: ['dashboard-stats'],
  queryFn: () => dashboardApi.getStats().then(r => r.data),
});

const { data: analytics, isLoading: analyticsLoading } = useQuery({
  queryKey: ['dashboard-analytics'],
  queryFn: () => dashboardApi.getAnalytics().then(r => r.data),
});
```

Pass the real data to child components instead of mock data.

- [ ] **Fix backend dashboard service**

In `apps/backend/src/dashboard/dashboard.service.ts`, implement real queries:
```ts
async getStats() {
  const [totalOrders, totalRevenue, totalCustomers, totalProducts] = await Promise.all([
    this.prisma.order.count(),
    this.prisma.payment.aggregate({ _sum: { amount: true } }),
    this.prisma.user.count({ where: { role: 'customer' } }),
    this.prisma.product.count({ where: { isActive: true } }),
  ]);
  return {
    totalRevenue: Number(totalRevenue._sum.amount || 0),
    totalOrders,
    totalCustomers,
    totalProducts,
    // ... other stats
  };
}
```

- [ ] **Commit**

```bash
git add apps/admin/src/features/dashboard/index.tsx apps/admin/src/features/dashboard/components/overview.tsx apps/admin/src/features/dashboard/components/analytics.tsx apps/backend/src/dashboard/dashboard.service.ts
git commit -m "fix(admin+backend): replace hardcoded dashboard data with real API queries"
```

### Task 5.2: Fix Sidebar — Remove Broken Links or Add Pages

**Files:**
- Modify: `apps/admin/src/components/layout/data/sidebar-data.ts`

- [ ] **Remove non-existent route entries**

Remove or comment out entries for: `campaigns`, `transactions`, `chats`, `apps`, `activity-logs` — unless pages for them exist.

- [ ] **Commit**

```bash
git add apps/admin/src/components/layout/data/sidebar-data.ts
git commit -m "fix(admin): remove sidebar links to non-existent routes"
```

### Task 5.3: Fix SignIn2 — Pass redirectTo

**Files:**
- Modify: `apps/admin/src/features/auth/sign-in/sign-in-2.tsx:33`

- [ ] **Pass redirectTo prop**

Change:
```tsx
<UserAuthForm />
```
to:
```tsx
<UserAuthForm redirectTo={redirect} />
```

- [ ] **Commit**

```bash
git add apps/admin/src/features/auth/sign-in/sign-in-2.tsx
git commit -m "fix(admin): pass redirectTo to UserAuthForm in SignIn2"
```

### Task 5.4: Fix Media Upload Error Visibility

**Files:**
- Modify: `apps/admin/src/features/media/index.tsx:108-110`

- [ ] **Keep error items visible longer**

Change:
```tsx
setPending((prev) => prev.filter((p) => p.status === 'uploading'))
```
to:
```tsx
setPending((prev) => prev.map((p) =>
  p.status === 'error' ? { ...p, errorShownSince: Date.now() } : p
).filter((p) => {
  if (p.status === 'error' && p.errorShownSince) {
    return Date.now() - p.errorShownSince < 5000; // show errors for 5s
  }
  return p.status === 'uploading';
}))
```

- [ ] **Commit**

```bash
git add apps/admin/src/features/media/index.tsx
git commit -m "fix(admin): keep upload error indicators visible for 5 seconds"
```

### Task 5.5: Add staleTime to Queries

**Files:**
- Modify: `apps/admin/src/main.tsx` (QueryClient default options)

- [ ] **Configure default staleTime**

In QueryClient creation:
```tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000, // 30s default
      gcTime: 5 * 60_000, // 5min gc
      retry: process.env.NODE_ENV === 'production' ? 3 : 0,
      refetchOnWindowFocus: process.env.NODE_ENV === 'production',
    },
  },
});
```

- [ ] **Commit**

```bash
git add apps/admin/src/main.tsx
git commit -m "perf(admin): add staleTime and gcTime to React Query defaults"
```

### Task 5.6: Fix Customers Page Currency Symbol

**Files:**
- Modify: `apps/admin/src/features/customers/index.tsx:154,213`

- [ ] **Replace $ with ৳**

Replace all `$` currency display with `৳` in the customers feature.

- [ ] **Commit**

```bash
git add apps/admin/src/features/customers/index.tsx
git commit -m "fix(admin): use ৳ instead of $ for BDT currency in customers"
```

### Task 5.7: Fix handleServerError — Check message field

**Files:**
- Modify: `apps/admin/src/lib/handle-server-error.ts:21-26`

- [ ] **Add fallback to message field**

```ts
const title = error.response?.data?.title || error.response?.data?.message || error.message || 'Something went wrong!';
const description = error.response?.data?.description || '';
```

- [ ] **Commit**

```bash
git add apps/admin/src/lib/handle-server-error.ts
git commit -m "fix(admin): fallback to message field in handleServerError"
```

### Task 5.8: Add Loading Skeleton to Settings

**Files:**
- Modify: `apps/admin/src/features/settings/index.tsx`

- [ ] **Add loading state**

```tsx
if (isLoading) {
  return (
    <Main>
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" />
      </div>
    </Main>
  );
}
```

- [ ] **Commit**

```bash
git add apps/admin/src/features/settings/index.tsx
git commit -m "fix(admin): add loading skeleton to settings page"
```

---

## Phase 6: STOREFRONT MENU CATEGORY MANAGEMENT (New Feature)

### Design Decision

**Approach: Per-category `showInMenu` toggle + `menuSortOrder`**

Instead of an include/exclude mode selector (which adds UX complexity), we add two fields directly on the `Category` model:
- `showInMenu: Boolean` (default: `true`) — controls visibility in storefront navigation
- `menuSortOrder: Int` (default: `0`) — controls ordering in the menu

This is superior because:
1. Each category independently controllable — no mode switching
2. Intuitive toggle UI in admin
3. Drag-and-drop reordering within the same admin section
4. No edge cases with include/exclude logic conflicts
5. Parent-child hierarchy respected automatically

**Admin UI** — Placed in Storefront Settings > Content > Navigation Menu. The existing "Navigation Menu" section gets a new sub-section "Menu Categories" with a toggle list + drag-reorder.

**Storefront Flow:**
1. Header/MobileMenu fetches storefront config (existing)
2. On mount, also fetches categories with `showInMenu: true` sorted by `menuSortOrder`
3. Merges custom nav items + category items together in the menu
4. Category items link to `/products?categoryId={id}`

### Task 6.1: Add showInMenu and menuSortOrder to Category Schema

**Files:**
- Modify: `apps/backend/prisma/schema.prisma:124-140`

- [ ] **Add fields to Category model**

```prisma
model Category {
  // ... existing fields ...
  showInMenu    Boolean   @default(true)
  menuSortOrder Int       @default(0)
  // ... rest ...
}
```

- [ ] **Create migration**

```bash
cd apps/backend && npx prisma migrate dev --name add_menu_fields_to_category
```

- [ ] **Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/20260608000001_add_menu_fields_to_category/
git commit -m "feat(db): add showInMenu and menuSortOrder to Category"
```

### Task 6.2: Update Backend Categories Service

**Files:**
- Modify: `apps/backend/src/categories/categories.service.ts`
- Modify: `apps/backend/src/categories/categories.controller.ts`

- [ ] **Add menu categories endpoint**

In `categories.controller.ts`:
```ts
@Public()
@Get('menu')
async getMenuCategories() {
  return this.categoriesService.findMenuCategories();
}
```

In `categories.service.ts`:
```ts
async findMenuCategories() {
  return this.prisma.category.findMany({
    where: { showInMenu: true, isActive: true },
    include: {
      children: { where: { showInMenu: true, isActive: true }, orderBy: { menuSortOrder: 'asc' } },
    },
    orderBy: { menuSortOrder: 'asc' },
  });
}
```

- [ ] **Update category DTOs to include new fields**

In `CreateCategoryDto` and `UpdateCategoryDto`, add:
```ts
@IsOptional()
@IsBoolean()
showInMenu?: boolean;

@IsOptional()
@IsInt()
@Min(0)
menuSortOrder?: number;
```

- [ ] **Commit**

```bash
git add apps/backend/src/categories/categories.controller.ts apps/backend/src/categories/categories.service.ts apps/backend/src/categories/dto/category.dto.ts
git commit -m "feat(backend): add menu categories endpoint and DTO fields"
```

### Task 6.3: Add "Menu Categories" Section to Admin Storefront Settings

**Files:**
- Create: `apps/admin/src/features/settings/storefront/components/sections/menu-categories.tsx`
- Modify: `apps/admin/src/features/settings/storefront/lib/categories.ts` (section registry)
- Modify: `apps/admin/src/features/settings/storefront/lib/field-schemas.ts`

- [ ] **Create MenuCategoriesSection component**

```tsx
import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SectionShell } from '@/features/settings/storefront/components/section-shell'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { GripVertical, Loader2 } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import type { UseStorefrontSettingsReturn } from '@/features/settings/storefront/hooks/use-storefront-settings'

interface Props { hook: UseStorefrontSettingsReturn }

interface MenuCategory {
  id: string; name: string; slug: string
  showInMenu: boolean; menuSortOrder: number
  children?: MenuCategory[]
}

export function MenuCategoriesSection({ hook }: Props) {
  const sectionId = 'menu-categories'

  const { data: categories, isLoading } = useQuery({
    queryKey: ['categories', 'all'],
    queryFn: () => apiClient.get<MenuCategory[]>('/categories')
      .then(r => {
        const data = r.data?.data || r.data || []
        return Array.isArray(data) ? data : []
      }),
  })

  const activeCategories = categories?.filter(c => c.showInMenu) || []
  const inactiveCategories = categories?.filter(c => !c.showInMenu) || []

  return (
    <SectionShell
      id={sectionId}
      title='Menu Categories'
      description='Toggle which product categories appear in the storefront navigation header. Drag to reorder.'
      isDirty={false}
      isSaving={hook.isSaving}
      dirtyCount={0}
      onSave={() => {}}
      onReset={() => {}}
    >
      {isLoading ? (
        <div className='flex justify-center py-8'><Loader2 className='animate-spin h-6 w-6' /></div>
      ) : (
        <div className='space-y-3'>
          <div className='text-sm font-medium text-muted-foreground mb-2'>
            Shown in menu ({activeCategories.length})
          </div>
          {activeCategories.map(cat => (
            <CategoryRow key={cat.id} category={cat} depth={0} />
          ))}
          {inactiveCategories.length > 0 && (
            <>
              <div className='text-sm font-medium text-muted-foreground mt-6 mb-2'>
                Hidden from menu ({inactiveCategories.length})
              </div>
              {inactiveCategories.map(cat => (
                <CategoryRow key={cat.id} category={cat} depth={0} />
              ))}
            </>
          )}
        </div>
      )}
    </SectionShell>
  )
}

function CategoryRow({ category, depth }: { category: MenuCategory; depth: number }) {
  const [checked, setChecked] = useState(category.showInMenu)
  const [updating, setUpdating] = useState(false)

  const toggle = async () => {
    setUpdating(true)
    try {
      await apiClient.put(`/categories/${category.id}`, { showInMenu: !checked })
      setChecked(!checked)
    } catch {
      // revert on error
    }
    setUpdating(false)
  }

  return (
    <div>
      <div
        className='flex items-center gap-2 p-2.5 border rounded-lg bg-muted/20'
        style={{ marginLeft: depth * 20 }}
      >
        <GripVertical className='h-4 w-4 text-muted-foreground shrink-0 cursor-grab' />
        <div className='flex-1 text-sm font-medium'>{category.name}</div>
        <Switch checked={checked} onCheckedChange={toggle} disabled={updating} />
      </div>
      {category.children?.map(child => (
        <CategoryRow key={child.id} category={child} depth={depth + 1} />
      ))}
    </div>
  )
}
```

- [ ] **Register section in categories.ts**

In `apps/admin/src/features/settings/storefront/lib/categories.ts`, add:
```ts
'menu-categories': {
  id: 'menu-categories',
  categoryId: 'content',
  title: 'Menu Categories',
  description: 'Toggle and reorder categories in the storefront navigation.',
  icon: List,
  fields: [],
},
```

Add to `content` sections list: `sections: ['content-navigation', 'menu-categories', 'content-faq', 'content-hours', 'content-about']`

- [ ] **Commit**

```bash
git add apps/admin/src/features/settings/storefront/components/sections/menu-categories.tsx apps/admin/src/features/settings/storefront/lib/categories.ts
git commit -m "feat(admin): add Menu Categories section to storefront settings"
```

### Task 6.4: Update Storefront Header to Show Menu Categories

**Files:**
- Modify: `apps/storefront/components/Header.tsx`
- Modify: `apps/storefront/components/MobileMenu.tsx`

- [ ] **Update Header to fetch and merge menu categories**

In `apps/storefront/components/Header.tsx`, add state and fetch for menu categories:

```tsx
const [menuCategories, setMenuCategories] = React.useState<any[]>([])

React.useEffect(() => {
  fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api'}/categories/menu`)
    .then(res => res.json())
    .then(data => {
      const cats = data.data || data || []
      setMenuCategories(Array.isArray(cats) ? cats : [])
    })
    .catch(() => {})
}, [])
```

Build the final nav items by merging custom nav items and categories:
```tsx
const allNavItems = React.useMemo(() => {
  const items = [...(config.navigation?.items || [])]
  // Add category items for categories not overridden by custom nav items
  for (const cat of menuCategories) {
    const alreadyAdded = items.some(i => i.href === `/products?categoryId=${cat.id}`)
    if (!alreadyAdded) {
      items.push({
        name: cat.name,
        href: `/products?categoryId=${cat.id}`,
        isCategory: true,
      })
    }
  }
  return items
}, [config.navigation?.items, menuCategories])
```

- [ ] **Update category link generation**

In the rendering loop (line 159), use the href directly:
```tsx
onClick={() => router.push(item.href)}
```

Instead of:
```tsx
onClick={() => router.push(item.href || `/products?category=${item.name.toLowerCase().replace(/\s+/g, '-')}`)}
```

- [ ] **Apply same changes to MobileMenu.tsx**

- [ ] **Commit**

```bash
git add apps/storefront/components/Header.tsx apps/storefront/components/MobileMenu.tsx
git commit -m "feat(storefront): merge menu categories with custom nav items in header"
```

### Task 6.5: Add Drag-and-Drop Reordering for Menu Categories

**Files:**
- Modify: `apps/admin/src/features/settings/storefront/components/sections/menu-categories.tsx`

- [ ] **Add drag-and-drop reordering**

Use HTML5 Drag and Drop API (no extra dependency):

```tsx
const [orderedCats, setOrderedCats] = useState<MenuCategory[]>([])
const [dragIdx, setDragIdx] = useState<number | null>(null)

useEffect(() => {
  if (categories) {
    setOrderedCats([...categories].sort((a, b) => a.menuSortOrder - b.menuSortOrder))
  }
}, [categories])

const handleDragStart = (idx: number) => { setDragIdx(idx) }
const handleDragOver = (e: React.DragEvent, idx: number) => {
  e.preventDefault()
  if (dragIdx === null || dragIdx === idx) return
  const next = [...orderedCats]
  const [moved] = next.splice(dragIdx, 1)
  next.splice(idx, 0, moved)
  setOrderedCats(next)
  setDragIdx(idx)
}
const handleDragEnd = async () => {
  setDragIdx(null)
  // Save new order
  for (let i = 0; i < orderedCats.length; i++) {
    if (orderedCats[i].menuSortOrder !== i) {
      await apiClient.put(`/categories/${orderedCats[i].id}`, { menuSortOrder: i })
    }
  }
}
```

- [ ] **Commit**

```bash
git add apps/admin/src/features/settings/storefront/components/sections/menu-categories.tsx
git commit -m "feat(admin): add drag-and-drop reordering for menu categories"
```

---

## Spec Coverage Check

| Audit Finding | Task | Status |
|--------------|------|--------|
| CRIT-1: JWT hardcoded secret | Task 2.1 | Covered |
| CRIT-2: Inventory crash | Task 1.1 | Covered |
| CRIT-3: Categories empty | Task 1.2 | Covered |
| CRIT-4: Product filter broken | Task 1.2 | Covered |
| CRIT-5: Bulk ops wrong response | Task 1.3 | Covered |
| CRIT-6: sonner dependency missing | Task 1.4 | Covered |
| CRIT-7: Orders page mock | Task 4.1 | Covered |
| CRIT-8: Cart cleared before payment | Task 3.1 | Covered |
| CRIT-9: Category nav name vs id | Task 4.3 | Covered |
| CRIT-10: No auth guards | Task 2.3 | Covered |
| CRIT-11: Mass assignment | Task 2.2 | Covered |
| CRIT-12: RedX webhook no auth | Task 2.4 | Covered |
| CRIT-13: Account page can't save | Task 4.2 | Covered |
| CRIT-14: Duplicate CartItem | Manual fix | Covered (see below) |
| CRIT-15: Coupon display not showing | Task 3.6 | Covered |
| HIGH-1: Rate limiting | Task 2.6 | Covered |
| HIGH-2/3: Forgot-password broken | Not in plan (needs email service) | Deferred |
| HIGH-4: Dashboard mock data | Task 5.1 | Covered |
| HIGH-5: Sidebar broken links | Task 5.2 | Covered |
| HIGH-6: SignIn2 redirect | Task 5.3 | Covered |
| HIGH-7: Cookie security | Task 2.5 | Covered |
| HIGH-8: Rewrite localhost | Task 4.5 | Covered |
| HIGH-9: XSS in product description | Task 4.4 | Covered |
| HIGH-10: Refund manageStock | Task 3.2 | Covered |
| HIGH-11: Display ID race | Not in plan (needs transaction) | Deferred |
| HIGH-12: Weak password | Task 2.1 (env check) | Partial |
| HIGH-13: Email verification | Not in plan | Deferred |
| HIGH-14: New arrivals vs popular | Task 3.4 | Covered |
| HIGH-15: getProductBySlug | Task 3.5 | Covered |
| HIGH-16: Coupons no validation | Part of Task 2.3 | Partial |
| HIGH-17: Inventory manageStock | Task 3.3 | Covered |
| HIGH-18: SSE stub | Not in plan | Deferred |
| HIGH-19: CMS force-dynamic | Not in plan (minor perf) | Deferred |
| HIGH-20: Checkout shipping validation | Not in plan | Deferred |
| Menu Category Management | Tasks 6.1-6.5 | Covered |

### Fix for CRIT-14: Duplicate CartItem Interface

In `apps/storefront/lib/types.ts`, remove the second `CartItem` definition (lines 152-167) and merge the fields into the first definition (line 72). Add `comboSelectionLabels` and `comboSelectionAttributes` to the first `CartItem` interface.

---

## Execution Handoff

**Plan complete and saved.** Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
