# EcoMate — Purchase Tracking + Sales Attribution + Checkout Data + Order UI

Implementation report (spec §33) — branch `claude/musing-mcclintock-7e0ef0`.

## 1. Files changed

**Backend — schema (migration `20260811180823_add_order_attribution_source_dimensions`, additive):**
- `prisma/schema.prisma` — Order +`sourcePlatform`, `sourceType`, `sourceEntity` (nullable String); SalesChannel enum +`OFFLINE`, `POS`.

**Backend — new files:**
- `src/delivery-areas/data/district-division.ts` — the one canonical 64→8 district→division resolver (project spellings + official aliases, case-insensitive). + spec.
- `src/tracking/meta-action-source.ts` — the one centralized Meta `action_source` resolver (`website`/`physical_store`/`phone_call`/`chat`/…) from sales/source context.
- Tests: `district-division.spec.ts`, `meta-action-source.spec.ts`, `customers/__tests__/customers.service.spec.ts`.

**Backend — modified:**
- `orders/dto/order.dto.ts` — CreateOrderDto +`sourcePlatform/sourceType/sourceEntity`.
- `orders/orders.service.ts` — create persists attribution + resolved division into `shippingAddress`; buildAndSendPurchaseEvent + fireRefundEvent use the resolver + lazy division resolve; verifyPayment passes the actually-reached status name to the canonical validated gate; findOne + PUBLIC_TOKEN_SELECT gain product.category + combo (F1 content metadata feeds the browser Purchase). + spec.
- `checkout-leads/dto/convert-order.dto.ts` + service — source dims + division on lead conversion; offline capture uses the resolver.
- `pos/pos-orders.service.ts` — POS creates carry `POS`/`POS`/`SHOWROOM`/showroom-name; offline capture uses the resolver. `pos.module.ts` imports TrackingModule (WIP).
- `system-settings/system-settings.controller.ts` — storefront checkout config +`emailEnabled` / `emailRequired` (`checkout_email_enabled` default true, `checkout_email_required` default false).
- `tracking/*` (tracking-settings currency config-sourcing, adapter/dispatcher actionSource pass-through) — WIP carried over.

**Storefront:**
- `checkout/page.tsx` — guest email field (enabled/required driven), `guestEmail` payload + lead email (synthetic-filtered), website attribution (storefront identity + fbclid→Facebook/Ad or Direct/Direct), `salesChannel: 'WEBSITE'` explicit.
- `checkout/thank-you/ThankYouContent.tsx` — browser Purchase geo fixed: `ct=district`, `st=division` (was `district` in `state`).
- `lib/api/orders.ts` +`guestEmail`; `lib/api/storefront-config.ts` checkout type +`emailEnabled/emailRequired`; `lib/tracking.ts` exports `isSyntheticEmail`.

**Admin:**
- `features/orders/api.ts` — OrderResponse + 3 source fields.
- `features/orders/order-source.ts` + `order-source-badge.tsx` — `resolveOrderAttribution` / `OrderSourceBadges`: compact channel + source badges (`Website`+`EcoMate Store`, `Facebook · Ad`, `Offline`+`WhatsApp · Chat`, `POS`+`Dhanmondi Showroom`).
- Order list (`index.tsx`), detail (`$id.tsx`) render the badge group.
- `create.tsx` — channel select + source platform/type/entity compact inputs.
- Checkout settings (`commerce-checkout.tsx`, `field-schemas.ts`, `categories.ts`) — Email Field + Email Required toggles.

**POS app:** `cart-store.ts` default `WALK_IN`→`POS`; `cart-panel.tsx` channel options +`POS`/`OFFLINE`.

## 2. Why each changed
Drives the four-dimension attribution model (§4-10), the canonical district→division + action_source resolvers (§11, §19-21), email collection (§13-18), browser content metadata (F1, §3), and correct Meta geo (§22).

## 3. Purchase behavior before/after
- **Before:** server `actionSource` = `salesChannel==='WEBSITE' ? 'website' : 'physical_store'` at every call site; no product.category/combo in the browser thank-you query (blank content metadata); browser user_data sent `district` as `state`; no division persisted.
- **After:** action_source from one resolver (WEBSITE→website, POS/WALK_IN/SHOWROOM→physical_store, CALL→phone_call, CHAT→chat, legacy social→chat); browser Purchase gets content_name/content_category from the order query; geo = `ct=district`,`st=division`,`country=BD`; division persisted at create and lazily resolved at capture for historical orders. Event ids, dedup, currency, validated gating unchanged.

## 4. Email behavior
New `checkout_email_enabled` (default on) + `checkout_email_required` (default off) surfaced to storefront + admin toggles; guest-only email input; optional/required/hidden honored; backend DTO already accepted `guestEmail`.

## 5. Customer identity behavior
Phone remains the identity. `findOrCreateCustomer` replaces a synthetic `cust_…` email with a real guest email and updates the existing profile on later same-phone orders — never creates a second customer. Synthetic emails never reach Meta (normalizer + browser filter) nor lead contact data.

## 6. District/division behavior
One canonical resolver (`district-division.ts`, 64 districts → 8 divisions, + aliases Chattogram/Cumilla/Barishal/Jhalokathi/Khagrachhari). New orders persist `division` inside `shippingAddress` JSON. Historical orders resolve lazily at capture. No backfill, no new order column, no postal code.

## 7. Sales channel/source behavior
`salesChannel` = where completed (WEBSITE / POS / OFFLINE / legacy values); `sourcePlatform` = originating platform; `sourceType` = DIRECT/AD/CHAT/CALL/SHOWROOM; `sourceEntity` = storefront/showroom identity. Storefront sets website default + fbclid-derived platform; POS sets showroom; admin create + lead conversion record the dimensions.

## 8. Order UI changes
Compact channel + source badge groups on order list + detail (existing design system, no new visual language). Admin create gains a compact Channel/Source Platform/Source Type/Source Entity block.

## 9. Payment flow impact
None. `verifyPayment` still performs its own direct order update (not routed through `updateStatus`); the validated Purchase capture now passes the actually-reached status name through the existing configuration-driven gate instead of the hardcoded `'Confirmed'` — event fires only when the configured validated status matches. COD UNPAID→PAID-on-delivered behavior carried from WIP, untouched.

## 10. POS impact
Default channel `WALK_IN`→`POS` (legacy value still accepted); orders record POS/POS/SHOWROOM/showroom-name; POS purchase action_source resolves to `physical_store`; POS tests updated.

## 11. Admin order impact
Admin-created orders persist the 4 attribution dimensions; badges render them; create form extended; existing customer lookup + phone identity + real-email update preserved.

## 12. Guest checkout impact
Email field added (guest-only, flag-driven); order payload + abandoned-checkout lead carry the real email; `guestEmail` reused via existing DTO/persistence path; no duplicate customers.

## 13. Test results
- Backend full suite: **127 suites / 1277 tests passed** (new: district 7, action_source 9, customers email 6, orders attribution/geo/action_source 6, refund chat 1).
- Admin: **35 files / 211 tests passed**.
- Storefront: **5 files / 43 tests passed**.
- Affected lead/POS/tracking suites all green.

## 14. Build/typecheck results
- `npm run build --workspace=backend` ✓ (nest build).
- `npm run build --workspace=storefront` ✓ (Next.js).
- `npm run build --workspace=admin` ✓ (Vite + PWA).
- `npm run build --workspace=pos` ✓ (Vite + PWA).
- Migration created + applied cleanly (no drift); `prisma generate` regenerated the client.

## 15. Remaining known gaps
- Meta `action_source` enum values are from the documented stable set; live official-doc re-verification was blocked from this environment (WebFetch/WebSearch to developers.facebook.com failed). The resolver is in one place and validates membership, so a spec update is a one-line change.
- Website ad-vs-direct is inferred from `_fbc`/fbclid presence (best available signal); a stronger utm/referrer pipeline is future work, not this spec.
- Lead-conversion default attribution is `OFFLINE`/`PHONE`/`CALL`; admin can override per order.
- History orders get division only at tracking/read time (by design, §21).