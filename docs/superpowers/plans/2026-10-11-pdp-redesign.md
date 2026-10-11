# PDP Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the storefront PDP to the mockup (sticky buy box, 3 sheets, new sections) plus header/footer/card consistency, backend fields, and admin editors — with zero §3 regressions — on branch `feat/pdp-redesign`.

**Architecture:** Hybrid — `ProductDetailClient.tsx` keeps every line of state/logic, render moves into focused units (`BuyBox`, `PdpGallery`, `PdpSections`, `CartVariantSheet`, `SizeGuideSheet`, `ReviewModal`, `StickyBar`, `SheetShell`). Backend adds 3 columns + `deliveryInfo` settings keys; admin adds 3 editors. Each phase below commits working, tested software.

**Tech Stack:** Next.js storefront (Tailwind v4 `@theme`), NestJS + Prisma backend, React admin (TanStack Query), vitest/jest.

**Branch invariants (every task):** work on `feat/pdp-redesign` only; `git push` only to `feat/pdp-redesign` (never main); the stashed taste-profile file (`git stash list` → `keep-taste-profile-out-of-pdp-branch`) is never popped/applied here; verify with `git status --porcelain` before each commit that only intended files are staged.

---

## File structure

| File | Responsibility |
|------|----------------|
| `apps/backend/prisma/schema.prisma` | +`Product.videoUrl String?`, +`Product.detailRows Json?`, +`Review.mobile String?` |
| `apps/backend/src/common/utils/video-url.ts` (new) + `__tests__/video-url.spec.ts` | `isSupportedVideoUrl()` host allowlist (YouTube/Facebook), shared by DTO |
| `apps/backend/src/products/dto/product.dto.ts` | +videoUrl/detailRows on Create + Update |
| `apps/backend/src/reviews/dto/create-review.dto.ts` | mobile required, name/rating optional |
| `apps/backend/src/products/products.service.ts` (scalars ~722, update `data` ~900) | persist new scalars (create scalars + update spread already covers; verify) |
| `apps/backend/src/reviews/reviews.service.ts` | normalize mobile, mobile-first dup guard, public selects exclude mobile |
| `apps/backend/src/system-settings/system-settings.controller.ts` (storefront map ~385-460) | `deliveryInfo` keys → config; PUT path accepts new keys |
| `apps/backend/src/reviews/__tests__/*.spec.ts`, `products/__tests__/*` | new specs |
| `apps/storefront/lib/types.ts` | `Product.detailRows`, `StorefrontConfig.deliveryInfo` |
| `apps/storefront/lib/api/products.ts` (`transformBackendProduct` ~85-115) | map `videoUrl`, `detailRows` |
| `apps/storefront/app/globals.css` (`@theme`/`:root`) | mockup tokens, no render-blocking font change |
| `apps/storefront/components/pdp/SheetShell.tsx` (new) | focus trap + ESC/backdrop + scroll lock |
| `apps/storefront/components/pdp/PdpGallery.tsx` (new) | 76px thumb strip + 4:5 main + counter; mobile stacked |
| `apps/storefront/components/pdp/BuyBox.tsx` (new) | §4 15-step order |
| `apps/storefront/components/pdp/PdpSections.tsx` (new) | video + description + features + details + perfect-for |
| `apps/storefront/components/pdp/CartVariantSheet.tsx` (new) | variant sheet + confirmation |
| `apps/storefront/components/pdp/SizeGuideSheet.tsx` (new) | tabs + Inch/Cm + tap-to-apply |
| `apps/storefront/components/pdp/ReviewModal.tsx` (new) | modal form per §8 |
| `apps/storefront/components/pdp/StickyBar.tsx` (new) | mobile bar → sheet |
| `apps/storefront/components/ProductDetailClient.tsx` | slim orchestrator (logic kept, render delegated) |
| `apps/storefront/components/Header.tsx`, `Footer.tsx`, `ProductCard.tsx` | storefront-wide consistency |
| `apps/storefront/components/__tests__/pdp-*.test.tsx` (new) | §3 matrix + new behavior |
| `apps/admin/src/features/products/components/product-form.tsx` (`buildPayload` ~666, tabs ~972) | Video URL + detailRows editor |
| `apps/admin/src/features/reviews/index.tsx` (`ReviewItem` ~30, table) | mobile column (admin-only) |
| `apps/admin/src/features/settings/storefront/components/sections/commerce-delivery-info.tsx` (new) + registry | deliveryInfo editor |

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` (Product block ~582-606, Review block ~1719-1731)

- [ ] **Step 1: Add columns**

```prisma
// Product block, after `sizeChartId`/`sizeChart` area — add:
videoUrl   String?
detailRows Json?
```

```prisma
// Review block, after `text` — add:
mobile String?
```

- [ ] **Step 2: Migrate + generate + build**

Run: `npx prisma migrate dev --name pdp_video_detailrows_review_mobile` (workdir `apps/backend`)
Expected: new migration dir, `prisma migrate status` up-to-date
Run: `npx prisma generate && npx nest build` (workdir `apps/backend`)
Expected: build exit 0

- [ ] **Step 3: Commit**

```bash
git status --porcelain
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/*pdp_video_detailrows_review_mobile*
git commit -m "feat(pdp): product videoUrl/detailRows + review mobile columns"
```

### Task 2: videoUrl validator util + spec

**Files:**
- Create: `apps/backend/src/common/utils/video-url.ts`
- Create: `apps/backend/src/common/utils/__tests__/video-url.spec.ts` (check existing `__tests__` layout under `common/utils` first; if none, place spec beside file as `video-url.spec.ts`)

- [ ] **Step 1: Write failing spec**

```ts
import { isSupportedVideoUrl } from '../video-url';

describe('isSupportedVideoUrl', () => {
  it('accepts YouTube watch/shorts/embed/11-char id', () => {
    expect(isSupportedVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isSupportedVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(true);
    expect(isSupportedVideoUrl('dQw4w9WgXcQ')).toBe(true);
  });
  it('accepts facebook watch/video urls', () => {
    expect(isSupportedVideoUrl('https://www.facebook.com/watch/?v=123456789')).toBe(true);
  });
  it('rejects empty/arbitrary urls', () => {
    expect(isSupportedVideoUrl('')).toBe(false);
    expect(isSupportedVideoUrl('https://evil.example/x')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL** — Run: `npx jest src/common/utils/video-url --silent` (workdir `apps/backend`). Expected: FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
const YT = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})|^([a-zA-Z0-9_-]{11})$/;
const FB = /facebook\.com\/(?:watch\/?\?v=\d+|reel\/\d+|video\/\d+|share\/\d+|plugins\/video\.php\?href=)|fb\.watch\/|facebook\.com\/[^/]+\/videos\/\d+/;

export function isSupportedVideoUrl(url: string): boolean {
  const t = (url || '').trim();
  if (!t) return false;
  return YT.test(t) || FB.test(t);
}
```

- [ ] **Step 4: Run, expect PASS** — same jest command. Expected: 3/3 pass.
- [ ] **Step 5: Commit** — `git add` both files, `git commit -m "feat(pdp): shared YouTube/Facebook video-url validator"`.

### Task 3: Product + Review DTOs

**Files:**
- Modify: `apps/backend/src/products/dto/product.dto.ts`
- Modify: `apps/backend/src/reviews/dto/create-review.dto.ts`

- [ ] **Step 1: Product DTOs — add to BOTH `CreateProductDto` and `UpdateProductDto`**

```ts
// new class, top of file:
export class DetailRowDto {
  @IsString() @MinLength(1) label: string;
  @IsString() @MinLength(1) value: string;
}
// inside each DTO:
@IsOptional() @IsString() videoUrl?: string;
@IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DetailRowDto)
detailRows?: DetailRowDto[];
```

- [ ] **Step 2: Review DTO rewrite**

```ts
import { IsString, IsNumber, IsOptional, IsNotEmpty, Min, Max, MinLength, ValidateIf } from 'class-validator';

export class CreateReviewDto {
  @IsString() @IsNotEmpty() productId: string;
  @IsOptional() @ValidateIf((o) => o.customerName !== undefined)
  @IsString() @MinLength(2) customerName?: string;
  @IsOptional() @IsNumber() @Min(1) @Max(5) rating?: number;
  @IsOptional() @IsString() text?: string;
  @IsString() @IsNotEmpty() mobile: string;
}
```

- [ ] **Step 3: Build** — Run: `npx nest build` (workdir `apps/backend`). Expected: exit 0.
- [ ] **Step 4: Commit** — `git commit -m "feat(pdp): product videoUrl/detailRows + review mobile DTOs"`.

### Task 4: Services — persist fields, mobile guard, no public leak

**Files:**
- Modify: `apps/backend/src/products/products.service.ts` (create `scalars` ~722: add `videoUrl: dto.videoUrl, detailRows: dto.detailRows as any`; update path uses `data = {...dto}` spread — verify videoUrl/detailRows flow, no delete strips them)
- Modify: `apps/backend/src/reviews/reviews.service.ts`

- [ ] **Step 1: Spec — product scalars**

```ts
// in products.service.spec.ts create-describe: dto gains videoUrl + detailRows
// expect prisma.product.create called with data containing
// videoUrl: 'https://youtu.be/dQw4w9WgXcQ', detailRows: [{ label: 'Fabric', value: 'Popcorn' }]
```

- [ ] **Step 2: Spec — review mobile**

```ts
it('normalizes mobile and rejects invalid with BD message', async () => {
  await expect(svc.create({ productId: 'p1', mobile: 'abc' } as any))
    .rejects.toThrow('Please enter a valid Bangladeshi mobile number.');
});
it('public findByProductSlug never exposes mobile', async () => {
  // mock prisma.review.findMany; assert select arg has NO mobile key
});
it('duplicate mobile for same product throws already-reviewed', async () => {
  // findFirst mobile match → BadRequestException('You have already reviewed this product')
});
```

- [ ] **Step 3: Implement service changes**

```ts
// products.service create() scalars (~line 722) — add two lines:
videoUrl: dto.videoUrl,
detailRows: dto.detailRows as any,
// update() uses `data = { ...dto }` spread — videoUrl/detailRows flow
// automatically; verify no `delete` strips them (only variants/attributes/categoryIds are deleted).
```
// reviews.service create():
import { normalizePhone } from '../common/utils/phone-utils';
const mobile = normalizePhone(dto.mobile || '');
if (!mobile) throw new BadRequestException('Please enter a valid Bangladeshi mobile number.');
const existing = await this.prisma.review.findFirst({
  where: { productId: dto.productId, OR: [{ mobile }, ...(dto.customerName ? [{ customerName: dto.customerName }] : [])] },
});
if (existing) throw new BadRequestException('You have already reviewed this product');
return this.prisma.review.create({ data: { productId: dto.productId, customerName: dto.customerName || 'Verified Buyer', rating: dto.rating ?? 5, text: dto.text, mobile, approved: false } });
```

Public reads (`findByProductSlug`, `findLatest`) switch to explicit `select: { id, productId, customerName, rating, text, approved, createdAt }` (no `mobile`). Admin `findAll` keeps full rows (mobile included).

- [ ] **Step 4: Run** — `npx jest src/reviews src/products --silent` (workdir `apps/backend`). Expected: all pass.
- [ ] **Step 5: Build + commit** — `npx nest build`; `git commit -m "feat(pdp): review mobile validation + leak-proof public selects"`.

### Task 5: deliveryInfo settings keys

**Files:**
- Modify: `apps/backend/src/system-settings/system-settings.controller.ts` (storefront map + update path)

- [ ] **Step 1: Read exact blocks** — Run: `sed -n '270,300p;455,480p;725,745p;870,900p' apps/backend/src/system-settings/system-settings.controller.ts`. Confirm: map source shape, update/bulk key write, cache invalidation line (`storefront:config`).
- [ ] **Step 2: Spec** — new `system-settings/__tests__/delivery-info.spec.ts`: GET storefront returns `deliveryInfo: { enabled, title, rows }` with defaults (`enabled: true`, title `''`, rows = 3 defaults Inside/Outside/Payment); rows JSON invalid → defaults; disabled → `enabled: false`.
- [ ] **Step 3: Implement** — keys `delivery_info_enabled` (`'1'`/`'0'`), `delivery_info_title`, `delivery_info_rows` (JSON `[{label,value}]`, fail-closed to defaults on parse error). Ensure update path + cache invalidation cover the new keys.
- [ ] **Step 4: Run + build** — jest spec; `npx nest build`. Expected: pass, exit 0.
- [ ] **Step 5: Commit** — `git commit -m "feat(pdp): deliveryInfo CMS keys in storefront config"`.

### Task 6: Storefront types + transform + tokens

**Files:**
- Modify: `apps/storefront/lib/types.ts`, `apps/storefront/lib/api/products.ts`, `apps/storefront/app/globals.css`

- [ ] **Step 1: Types** — `Product` += `detailRows?: { label: string; value: string }[]`; `StorefrontConfig` += `deliveryInfo: { enabled: boolean; title: string; rows: { label: string; value: string }[] }`.
- [ ] **Step 2: Transform** — in `transformBackendProduct` return add `videoUrl: raw.videoUrl || undefined, detailRows: Array.isArray(raw.detailRows) ? raw.detailRows : undefined`. (videoPosition stays client default 4; reviews stay API-fetched — existing orchestrator effect.)
- [ ] **Step 3: Test** — extend storefront product-transform spec (find existing spec under `apps/storefront/lib/__tests__/`; if none, create `apps/storefront/lib/api/__tests__/pdp-transform.test.ts`): raw with videoUrl/detailRows maps through; raw without → undefined, no crash.
- [ ] **Step 4: Tokens** — `globals.css` `:root` add `--pdp-ink: #14202b; --pdp-accent: #0b6bbf; --pdp-success: #12683a; --pdp-success-bg: #e6f6ec; --pdp-danger: #b42318;` + `@theme inline` mappings. Font: check `app/layout.tsx` for Hind Siliguri — if absent, add via `next/font/google` with `display: 'swap'` (no render-blocking stylesheet). Do NOT change existing brand vars.
- [ ] **Step 5: Verify** — Run: `npx tsc --noEmit` (workdir `apps/storefront`). Expected: 0 errors.
- [ ] **Step 6: Commit** — `git commit -m "feat(pdp): storefront types, transform, mockup tokens"`.

### Task 7: SheetShell + PdpGallery

**Files:**
- Create: `apps/storefront/components/pdp/SheetShell.tsx` + `__tests__/sheet-shell.test.tsx`
- Create: `apps/storefront/components/pdp/PdpGallery.tsx` + test

- [ ] **Step 1: SheetShell test** — renders children, X button calls onClose, ESC key calls onClose, backdrop click calls onClose, content click does not; `role="dialog" aria-modal`.
- [ ] **Step 2: SheetShell impl** — fixed overlay `z-50`, `bg-[#14202bcc]`; mobile bottom-sheet (`items-end`, `rounded-t`), desktop centered `max-w-[560px]`; `useEffect` ESC listener + `document.body.style.overflow` lock/unlock; autofocus first focusable (focus trap-lite: keep simple + documented).
- [ ] **Step 3: PdpGallery** — first read `ProductImageGallery.tsx` props (exact import path); wrapper: desktop `flex gap-3` (76px vertical thumbs controlling gallery index via key/prop — if gallery owns index, lift by rendering gallery with `key={activeIndex}`? choose simplest truthful wiring after reading); main 4:5 + counter badge; mobile `flex-col` thumbs horizontal below. Reuse `mediaMeta` derivatives (no new image pipeline).
- [ ] **Step 4: Run** — `npm test -- pdp` (workdir `apps/storefront`). Expected: pass.
- [ ] **Step 5: Commit** — `git commit -m "feat(pdp): sheet shell + gallery layout"`.

### Task 8: sanitize fix (line-break bug)

**Files:**
- Modify: `apps/storefront/components/ProductDetailClient.tsx` `sanitizeHTML` (~69-106) — later moves with orchestrator; fix here first with test
- Test: extend `apps/storefront/components/__tests__/ProductDetailClient.test.tsx` or new `sanitize.test.ts` beside component

- [ ] **Step 1: Failing test** — plain text `'a\nb'` → contains `<br>`; `'a\n\n\nb'` → visible spacing preserved (two paragraph breaks, NOT collapsed); HTML input keeps `<br>` behavior, no empty-break injection after block tags.
- [ ] **Step 2: Implement** — plain branch: split on `\n{2,}` → `<p>` paragraphs, single `\n` → `<br>` (drop the `\n{3,}→\n\n` collapse). HTML branch unchanged.
- [ ] **Step 3: Run** — `npm test -- sanitize` (workdir `apps/storefront`). Expected: pass.
- [ ] **Step 4: Commit** — `git commit -m "fix(pdp): preserve consecutive line breaks in description"`.

### Task 9: BuyBox (15-step order)

**Files:**
- Create: `apps/storefront/components/pdp/BuyBox.tsx` + `__tests__/buy-box.test.tsx`
- Props (exact): `{ product, selectedVariant, selectedAttrs, allAttrNames, displayPrice, displayOriginalPrice, displayStock, isOutOfStock, qty, quantity, inCart, justAdded, sizeChartData, onSelectAttr, onQty, onAddToCart, onBuyNow, onWishlist, wishlisted, onSizeGuide, config }` — prune while implementing; single-responsibility: presentation only, zero cart writes.

Order: Code+heart → H1+tagline → price/Save/stock-one-line + COD dot → shortDesc → Color (+N more, All Colors) → Size+Guide → inline size hint + (toast stays in orchestrator handler) → Qty stepper → ORDER NOW then ADD TO CART (3-state classes verbatim from current lines 946-966) → addedText/checkout-pending → WA+CALL always → DeliveryInfo card → TrustBar(4) → Share → stylingTip.

- [ ] Steps per skill rhythm: test (renders order + thresholds `>10/1–10/0` + Save% math) → fail → impl → pass → commit `feat(pdp): buy box per mockup order`.

### Task 10: PdpSections (video + description + features + details + perfect-for)

**Files:**
- Create: `apps/storefront/components/pdp/PdpSections.tsx` + test

Rules: video (single position below top grid, full-width 16:9, `VideoEmbed` reuse, absent → render nothing); Description always visible H2 (fixed sanitize); Key Features 2-col ✓ grid or hidden; Details card = `detailRows` rows + Size Available variant sizes, else legacy `specifications` HTML, else hidden (no hardcode); Perfect For = tags chips or hidden.

- [ ] Test → fail → impl → pass → commit `feat(pdp): content sections with detailRows + legacy fallback`.

### Task 11: CartVariantSheet + StickyBar

**Files:**
- Create: `apps/storefront/components/pdp/CartVariantSheet.tsx`, `StickyBar.tsx` + tests

Sheet: header photo+title+price, selectors (reuse BuyBox selector fragments via shared `VariantFields.tsx` if duplication >30 lines — else duplicate deliberately, note it), inline validation hint, ADD TO CART / ORDER NOW inside (props `onAddToCart`, `onBuyNow`), success state (green circle + CONTINUE SHOPPING / VIEW CART). StickyBar: mobile `md:hidden`, ADD TO CART / ORDER NOW open sheet (no scroll), OOS → disabled Out of Stock.

- [ ] Test → fail → impl → pass → commit `feat(pdp): variant sheet + sticky bar`.

### Task 12: SizeGuideSheet (guardrail 2a)

**Files:**
- Create: `apps/storefront/components/pdp/SizeGuideSheet.tsx` + test; reuse `SizeChartData` from `SizeChartModal`.

Content: title = chart name ("Panjabi Size Guide"); tabs Size chart | How to measure; Inch/Cm toggle — `cm = in × 2.54` (1 decimal), applied to every numeric cell, source untouched; table Size/Chest/Length/Shoulder/Sleeve from `tableData`; note text verbatim; image; definitions (Chest/Length/Shoulder/Sleeve verbatim from spec). Row tap → `onPickSize(size)` → orchestrator applies + closes. Data flow `GET /size-charts/by-product/{slug}` untouched (existing effect stays).

- [ ] Test: convert 15in→38.1cm; tap row calls onPickSize + onClose; toggle does not mutate source. → impl → pass → commit `feat(pdp): size guide sheet with unit toggle + tap-to-apply`.

### Task 13: ReviewModal + ReviewsSection (guardrail 2b)

**Files:**
- Create: `apps/storefront/components/pdp/ReviewModal.tsx` (+ test); modify section (in orchestrator task or here — here: new `ReviewsSection2`? NO — modify existing `ReviewsSection` in place to header + WRITE A REVIEW + modal; keep file until orchestrator split).

Field order: product name read-only → rating optional (hover preview) → review optional → name optional → mobile* → error `Please enter a valid Bangladeshi mobile number.` (client check via `normalizePhone` from `lib/phone-utils.ts`) → privacy note verbatim → `Have an account? Log in instead` (→/account) or logged-in banner `✓ Reviewing as a logged-in customer. / Use mobile number instead` → SUBMIT REVIEW. Success: `✓ Thank you for your review — It will appear on this page after a quick check.` + DONE. POST `/reviews` `{productId, customerName?, rating?, text?, mobile}`; dup 400 surfaces inline. `showReviews` gating + list-vs-form config untouched.

- [ ] Test → fail → impl → pass → commit `feat(pdp): review modal with required mobile`.

### Task 14: Orchestrator slim-down + §3 matrix

**Files:**
- Modify: `apps/storefront/components/ProductDetailClient.tsx` (keep ALL logic ~286-674: auto-select, stock memo, handlers, effects, tracking; replace render with new units; keep breadcrumb, hidden SEO div, `showReviews` gate, `RelatedProducts`, OOS box, size-hint + Bengali toast duality)
- Modify: `apps/storefront/components/__tests__/ProductDetailClient.test.tsx` (keep green, add matrix rows)

Desktop video: below grid (drop videoPosition 1-5 branches — directive §6 explicit). Sticky buy box `md:sticky top-4`. Mobile bar replaced by StickyBar (Call/WA live in BuyBox).

- [ ] **Step 1: Refactor** in small edits, running `npx tsc --noEmit` after each.
- [ ] **Step 2: Matrix tests** — §3 rows 1-16 (spec §10): auto-select on/off, stock-0 disable, partial sum, qty sync, 3-state timers (fake timers), buy-now isolation (assert `startBuyNow` + no `addToCart`), tracking both CTAs, `?color=` preselect, `/colors` link intact, showReviews gate, sizeChart fetch URL unchanged, JSON-LD present, mobile absent from `GET /reviews/product/:slug` response (backend test already; here assert UI never renders `mobile`), detailRows + fallback, deliveryInfo off hidden, sheet focus/ESC.
- [ ] **Step 3: Full app checks** — `npx tsc --noEmit` 0; `npm test` green; `npx next build` 0 (workdir `apps/storefront`).
- [ ] **Step 4: Commit** — `git commit -m "feat(pdp): slim orchestrator + §3 regression matrix"`.

### Task 15: Header / Footer / ProductCard / Related

**Files:**
- Modify: `apps/storefront/components/Header.tsx` (announcement `Free delivery over ৳{freeDeliveryMin} · Cash on Delivery across Bangladesh` + logo/search/Track/SignIn/Cart + category nav from `config.menu.header.items` + mobile drawer via existing `open-mobile-menu` event; keep checkout-hide rule)
- Modify: `apps/storefront/components/Footer.tsx` (polish only — diff must show zero removed links; contact from config)
- Modify: `apps/storefront/components/ProductCard.tsx` (mockup card: 4:5, title, price + strike + Save N%, ADD TO CART; keep OOS logic, wishlist, VariantPickerModal, tracking, fly-to-cart)
- Verify: `app/(main)/products/[slug]/colors/page.tsx` + `ColorCatalogGrid` untouched behavior (visual only via card if shared)

- [ ] Test: header announcement text composes X from config; footer link-count snapshot unchanged; card renders Save% + CTA; colors page test green.
- [ ] `npx tsc --noEmit` + `npm test` green → commit `feat(pdp): header/footer/card consistency`.

### Task 16: Admin — product form fields

**Files:**
- Modify: `apps/admin/src/features/products/components/product-form.tsx`, `apps/admin/src/features/products/api.ts` (`ProductResponse` + payload types)

General tab: Video URL input (placeholder `YouTube / Facebook video link`, invalid → inline error via same host patterns, empty → omit). Details editor below shortDesc: rows add/remove, label+value inputs (e.g. Fabric=China Imported Popcorn), order preserved. Wire into `buildPayload` + autosave `hasContent` + draft create/update (verify `update()` spread keeps them — backend Task 4).

- [ ] Test (admin vitest): payload includes fields; invalid video URL blocks save; rows add/remove.
- [ ] `npx tsc --noEmit` (workdir `apps/admin`) 0 → commit `feat(pdp): admin video URL + detail rows`.

### Task 17: Admin — reviews mobile + deliveryInfo settings

**Files:**
- Modify: `apps/admin/src/features/reviews/index.tsx` (`ReviewItem` += `mobile: string | null`; table column Mobile)
- Create: `apps/admin/src/features/settings/storefront/components/sections/commerce-delivery-info.tsx`; register in sections registry (read `getAllSections` definition first — exact file under `lib/`)

DeliveryInfo editor: enable toggle + title + rows (label/value, add/remove/reorder) → persists via settings bulk/PUT (match existing section save pattern — read `commerce-order.tsx` first).

- [ ] Tests: reviews table renders mobile; delivery-info section saves rows.
- [ ] tsc 0 → commit `feat(pdp): admin review mobile + deliveryInfo settings`.

### Task 18: Final verification + push (branch only)

- [ ] **Step 1:** backend `npx jest --silent` all pass + `npx nest build` exit 0 + `prisma migrate status` up-to-date.
- [ ] **Step 2:** admin `npx tsc --noEmit` 0 + vitest green.
- [ ] **Step 3:** storefront `npx tsc --noEmit` 0 + `npm test` green + `npx next build` 0.
- [ ] **Step 4:** browser pass (dev servers): §13 checklist — section order desktop/mobile, video present/absent, 3 breaks visible, detailRows + fallback, deliveryInfo on/off, review validation/success/leak, size toggle + tap-apply, sticky→sheet no-scroll + 3-state + isolated buy-now, WA/Call both, header/footer/cards + `/colors` intact.
- [ ] **Step 5:** `git status --porcelain` (taste file absent) → `git push -u origin feat/pdp-redesign`. NEVER main.

---

## Open question for owner (single real ambiguity — everything else per directive)

`descriptionSections` (tagline/benefits/specifications/stylingTip) has **no backend source today**: backend never sends it, admin has no editor, so those blocks are dead paths on the live PDP. Directive §11 mandates only videoUrl/detailRows/mobile. **Recommendation:** proceed with pass-through rendering (works if backend ever sends it) + `detailRows` as the real Details source + legacy `specifications` fallback preserved in code; NO new column now. If you want tagline/benefits/tip editable, say so — follow-up adds a `descriptionSections` JSON column + admin editor (same pattern as detailRows). Reply `proceed` to accept, or `add-sections` to include it in this branch.
