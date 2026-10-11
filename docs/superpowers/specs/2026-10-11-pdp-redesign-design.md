# PDP Redesign — Design Spec (Hybrid Approach)

**তারিখ:** 2026-10-11 | **Branch:** `feat/pdp-redesign` (clean `origin/main` থেকে, taste-profile ফাইল untouched — stash `keep-taste-profile-out-of-pdp-branch`-এ সুরক্ষিত)
**Source of truth:** `ecomate-pdp-redesign-directive.md` (§1–§13) + mockup `draft/Product Detail Page Ui/Main.dc.html` (desktop 1440px)
**Scope (owner decision = একবারে পুরোটা):** PDP + ৩টা sheet/modal + header/footer + shared ProductCard/catalog + admin form + backend fields — এক ব্রাঞ্চে। Checkout flow, cart page, admin-এর অন্য অংশ, backend-এর অন্য module, EcoMate-Landing — scope-এর বাইরে।

## 1. Architecture (Hybrid — approved)

`ProductDetailClient.tsx` (বর্তমানে ১১০৯ লাইন) slim orchestrator হবে: সব state/logic হুবহু থাকে, শুধু render নতুন subcomponent-এ যায়।

- **Orchestrator রাখে:** variant auto-select (`config.features.defaultVariantSelected` + user `autoVariantSelect`), stock-0 disable + partial-selection stock-sum, qty stepper↔cart sync, Add-to-Cart 3-state (ADD → ADDED 1.5s → REMOVE লাল), isolated buy-now (`startBuyNow`, shared cart untouched, multi-product auto-cart guard), `trackAddToCart` দুই CTA-তে, gallery autoplay/lightbox state, `?color=` param, review/sizeChart gating flags।
- **নতুন presentational units** (প্রতিটা একটাই কাজ, independently testable):
  - `PdpGallery.tsx` — vertical thumb strip (76px) + main 4:5 + counter badge; mobile-এ column (thumbs নিচে horizontal)। Autoplay + pause/play, lightbox (2.5x toggle, pinch 4x, swipe, keyboard) — logic reuse, শুধু style।
  - `BuyBox.tsx` — §4-এর ১৫-ধাপ order (§3 দেখো)।
  - `PdpSections.tsx` — video → description → key features → details → perfect-for (§4 দেখো)।
  - `CartVariantSheet.tsx` — §5 (§6 দেখো)।
  - `SizeGuideSheet.tsx` — §7 (guardrail 2a)।
  - `ReviewModal.tsx` + `ReviewsSection.tsx` — §8 (guardrail 2b)।
  - `StickyBar.tsx` — mobile bottom bar (ADD TO CART / ORDER NOW → sheet খোলে, scroll-up নয়)।
  - `SheetShell.tsx` — generic shell: focus trap + ESC/backdrop close + body scroll lock; mobile-এ bottom-sheet, desktop-এ centered max-width 560px।
- **Storefront-wide (একই ব্রাঞ্চে):** `Header.tsx` (+ mobile drawer) rebuild — announcement bar (config text, X=`config.delivery.freeDeliveryMin`) → logo + search + Track Order / Sign In / Cart(count) → category nav। `Footer.tsx` light polish only (কোনো link/text বাদ নয়, hardcoded contact config/CMS থেকে)। `ProductCard.tsx` নতুন style (4:5 image, title, price + কাটা-দাম + `Save N%`, ADD TO CART) — related + archive + search সব জায়গায়; `/colors` পেজ + `ColorCatalogGrid` অক্ষত। Related logic unchanged (same-category 20 → tag-match priority → shuffle → 8; desktop 4-col / mobile carousel)।
- **Tokens:** mockup variable (`#14202b` primary dark, `#0b6bbf` accent, `#12683a`/`#e6f6ec` success, `#b42318` danger, `Hind Siliguri`) Tailwind theme-এ; hardcode নয়; নতুন font/CSS-এ render-blocking বাড়ানো নিষেধ; gallery-তে existing `mediaMeta` derivative (`thumbnail/medium/small`) reuse।

## 2. `page.tsx` — অপরিবর্তনীয়

`dynamic='force-dynamic'` + 10s TTL backend cache, `trackViewContent`, JSON-LD Product+Offer (BDT, availability), `generateMetadata` (title/desc/canonical/OG/Twitter), hidden SEO tags div — সব হুবহু।

## 3. Buy box order (§4, mockup হুবহু)

1. `Code: {SKU}` (বাম) + wishlist heart (ডান, toggle + pop)। 2. H1 + tagline italic (`descriptionSections.tagline` থাকলে)। 3. Price (৳, pricePop) + কাটা-দাম + সবুজ `Save N%` + stock এক লাইনে (`>10` In Stock · Only 24 left style / `1–10` Only N left! / `0` Out of Stock) + COD pulse-dot badge। 4. Short description। 5. Color swatch row (hex map; >5 হলে `+N more` + `All Colors → /colors`)। 6. Size row (label বাম, Size Guide link ডান) + pill row। 7. Size ছাড়া CTA → inline লাল hint "Please select a size to continue." + বিদ্যমান বাংলা toast — দুটোই। 8. Quantity stepper (sync logic)। 9. CTA column: ORDER NOW (primary, bump) → ADD TO CART (secondary)। 10. `{{addedText}}` সবুজ লাইন + "Taking you to checkout…" (buy-now pending)। 11. ORDER VIA WHATSAPP + CALL — desktop সহ সব জায়গায় (pre-filled WA text + `tel:`)। 12. Delivery info card (§5)। 13. Trust bar 4 cards (Free Delivery over ৳X [config], COD, Easy Returns, Secure Payment)। 14. Share — subtle icon row (copy + FB + WA)। 15. Styling tip (`descriptionSections.stylingTip`, 💡 italic) — ডেটা থাকলে, না থাকলে render নয়।

## 4. Content sections (§6)

- **Video:** `videoUrl` থাকলে top grid-এর নিচে full-width 16:9 + "PRODUCT VIDEO" label; existing `VideoEmbed` reuse (YouTube nocookie / FB XFBML), chrome/noise কমানো; না থাকলে কোনো placeholder নয়।
- **Description:** H2 "Description", সবসময় visible (collapsible বাদ); **bug fix:** sanitize pipeline-এ `\n\n`→paragraph / `\n`→`<br>` — ৩টা consecutive break-ও visible spacing।
- **Key Features:** `descriptionSections.benefits[]` → 2-col ✓ grid; খালি হলে hidden।
- **Product Details:** H3 + card; **dynamic `detailRows [{label,value}]`** render (admin-defined order preserved); `Size Available` row-এ variant sizes; **legacy fallback:** rows খালি → বিদ্যমান `specifications` HTML; hardcode নিষেধ।
- **Perfect For:** `tags` → chips; খালি হলে hidden।

## 5. Delivery info card (§7, CMS-driven)

Rows = settings `deliveryInfo.rows[]` (`{label,value}`); default Inside Dhaka "1–2 business days" / Outside Dhaka "3–5 business days" / Payment "Cash on Delivery"। Title + প্রতিটা row-এর label/value + show/hide — সব settings থেকে changeable। খালি/off → card render নয়। Storefront `config`/settings API থেকে পড়বে।

## 6. Cart / Variant sheet (§5)

Sticky bar (§8 mbar) থেকে ADD TO CART / ORDER NOW → **scroll-up ছাড়া** sheet: header (photo+title+price) + Color/Size/Quantity selector + সবুজ success circle state। ভেতর থেকে ADD TO CART / ORDER NOW (Order Now → isolated flow, sheet বন্ধ করে `/checkout`)। Validation error sheet-এর ভেতরে inline। Desktop-এ Add to Cart-এর পর confirmation ("✓ Added to cart" + CONTINUE SHOPPING / VIEW CART) — buy box 3-state-এর **অতিরিক্ত**, প্রতিস্থাপন নয়।

## 7. Size Guide sheet (guardrail 2a — explicit)

- Trigger: size row-এর ডানে "Size Guide" link + simple product-এ "📏 Size Guide" (existing trigger intact)।
- Content (mockup হুবহু): "Panjabi Size Guide" title → tabs **[Size chart | How to measure]** → **Inch/Cm toggle** — API data যেই unit-এ আসুক, অন্য unit **client-side convert** (`cm = in × 2.54`, display rounding 1 decimal; toggle শুধু presentation, source data mutate নয়) → table (Size/Chest/Length/Shoulder/Sleeve, API data) → note "Tap a size to select it. Measurements are garment measurements." → size guide image (API `image` থাকলে) → measurement definitions (Chest: around the fullest part, under the arms. / Length: from the highest shoulder point to the hem. / Shoulder: seam to seam across the back. / Sleeve: from the shoulder seam to the cuff.)।
- **Tap-to-select:** যেকোনো size row-এ tap → PDP-র size selector-এ apply + sheet বন্ধ (single source of truth: orchestrator state; sheet শুধু callback ডাকে)।
- **Data flow অপরিবর্তিত:** `GET /size-charts/by-product/{slug}` request/response/mapping-এ হাত নয়; শুধু presentation। `config.features.sizeChart` gating হুবহু।

## 8. Reviews (guardrail 2b — explicit)

- Section header: H2 "Customer Reviews" + ডানে WRITE A REVIEW। Summary (avg + stars + count) + list (নাম, bn-BD তারিখ, stars, text) existing। Empty: "No reviews yet. Be the first to review this product."।
- **Modal form (mockup হুবহু, field order fixed):** product name (read-only) → Your rating (optional, hover preview) → Your review (optional) → Name (optional) → **Mobile number \* (required)** → BD error **"Please enter a valid Bangladeshi mobile number."** (শুধু app-এর **existing Bangladeshi phone validator** accept করা format-এ pass; শুধু mobile required, বাকি সব optional — existing form-এর required-name/required-rating বাধ্যতা এই modal-এ প্রযোজ্য নয়) → note "Used only to confirm your review. Never shown publicly." → "Have an account? **Log in instead**" (link → login) → logged-in হলে বিকল্প banner "✓ Reviewing as a logged-in customer. / Use mobile number instead"।
- **Submit/success:** SUBMIT REVIEW → success state "✓ Thank you for your review — It will appear on this page after a quick check." + **DONE** (close)।
- **Backend:** `POST /reviews` `mobile` accept + store (`Review.mobile`, API-level required validation existing BD validator reuse); **mobile কখনো public API/list response-এ expose নয়** (serializer/DTO থেকে বাদ, list query-তে select-exclude + regression test); moderation flow অপরিবর্তিত (approved না হওয়া পর্যন্ত hidden); admin review management-এ mobile visible (admin-only)।
- **Gating intact:** `config.features.showReviews` + "সব review দেখাবে নাকি শুধু form" admin configuration behavior হুবহু।

## 9. Backend + Admin + CMS (§11)

- **Prisma:** `Product.videoUrl String?`, `Product.detailRows Json?` (`[{label,value}]`), **`Product.descriptionSections Json?` (`{tagline?, benefits?[], specifications? (HTML), stylingTip?}` — সব optional, additive nullable)**, `Review.mobile String?` — প্রতিটার migration সহ; destructive flag নিষেধ।
- **NestJS:** DTO validation — videoUrl optional URL (YouTube/Facebook host allowlist), detailRows array of `{label,value}` non-empty strings (order preserved), **descriptionSections optional object (tagline/stylingTip optional string, benefits optional string[], specifications optional string/HTML)**, review mobile existing BD validator reuse; `GET product`-এ videoUrl + detailRows **+ descriptionSections** include; `POST /reviews` mobile accept+store।
- **React Admin product form:** Video URL field (optional, placeholder "YouTube / Facebook video link", invalid URL-এ inline error, খালি save-এ storefront-এ কিছু নয়); Product Details rows editor (row add/remove, label input + value input, order preserved); **Description Sections editor group (একই form-এ): tagline text input, benefits add/remove text list, specifications textarea/HTML, stylingTip text input — সব optional; খালি group store-এ undefined, storefront-এ সংশ্লিষ্ট সেকশন hidden**।
- **CMS settings:** `deliveryInfo` group — enable toggle + rows[] editor (label/value, add/remove/reorder) → settings API।

## 10. §3 must-keep checklist (প্রতিটার test/checklist বাধ্যতামূলক)

| # | Behavior | Test/checklist |
|---|----------|----------------|
| 1 | `force-dynamic` + 10s TTL cache | page.tsx diff-empty check + stock-change E2E |
| 2 | Variant auto-select + `defaultVariantSelected` + `autoVariantSelect` | unit: default select on/off, logged-in pref |
| 3 | Stock-0 disable; partial-selection stock-sum | unit: disabled flag + sum math |
| 4 | Qty stepper↔cart sync; OOS disabled + OOS box | unit + browser: sync both ways |
| 5 | 3-state Add to Cart (ADD→ADDED 1.5s→REMOVE লাল, click remove) | unit timers + browser click-through |
| 6 | Isolated buy-now + multi-product auto-cart guard | unit: shared cart untouched; E2E checkout |
| 7 | `trackAddToCart` দুই CTA | mock assert both paths |
| 8 | Gallery autoplay/pause, lightbox zoom/pinch/swipe/keyboard | browser checklist |
| 9 | `?color=` + `/colors` + ColorCatalogGrid | E2E: param preselect, catalog intact |
| 10 | Review moderation + `showReviews` gating + list-vs-form config | API test + browser gating matrix |
| 11 | `sizeChart` gating + `GET /size-charts/by-product/{slug}` flow | API contract test (response unchanged) |
| 12 | JSON-LD + metadata + hidden SEO div | snapshot/assert |
| 13 | Mobile leak-absence (public review API-তে `mobile` key নেই) | API negative test |
| 14 | detailRows render + legacy specifications fallback | render both branches |
| 15 | descriptionSections admin write → storefront read (tagline/benefits/specifications/stylingTip render-or-hide) | backend persist spec + transform passthrough + sections render tests + live probe |
| 16 | deliveryInfo off → hidden | config-off render test |
| 17 | Sheet trigger (sticky bar, no scroll-up) + focus trap/ESC | browser test |

## 11. Non-functional

Responsive ≤900px (stacked gallery, static buy box, bottom-sheet, sticky mbar; touch ≥44px) · a11y (focus trap/ESC, icon aria-labels, contrast) · perf (derivative reuse, no new render-blocking) · `tsc` 0 + `next build` (storefront) 0 + suite green।

## 12. Workflow invariants

`feat/pdp-redesign` থেকে কাজ; **main-এ direct push নিষেধ, push শুধু branch-এ** (owner merge করবেন); taste-profile ফাইল এই branch-এর কোনো commit-এ ঢুকবে না; acceptance checklist (§13 of directive) মিলিয়ে owner review।
