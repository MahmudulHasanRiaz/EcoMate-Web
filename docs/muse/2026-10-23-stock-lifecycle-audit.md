# স্টক লাইফসাইকল অডিট — ২৩ অক্টোবর ২০২৬

**স্কোপ:** অর্ডার তৈরির মুহূর্ত থেকে ডেলিভারি, বাতিল, রিটার্ন ও ড্যামেজ পর্যন্ত স্টকের প্রতিটি নড়াচড়া — কোথায় কে ট্রিগার করে, দুই স্তরের (managed/physical) হিসাব মেলে কি না, দ্বিগুণ ডিডাকশন/রিস্টোর হচ্ছে কি না, এবং স্টক ঠিক করার আলাদা স্ক্রিপ্টগুলো কতটা নিরাপদ।

**সংক্ষেপে:** ৪টি নির্দেশনার মধ্যে **B1 (ট্রিগার ম্যাপ) সম্পন্ন**, **B2-তে ১টি প্রমাণিত কনফ্লিক্ট ঠিক করা হয়েছে (ট্র্যাশ করলে বিক্রি হওয়া পণ্য আবার স্টকে ফিরে আসত)**, **B3 (স্ক্রিপ্ট ইনভেন্টরি) সম্পন্ন**, **B4 প্রমাণিত ও ঠিক করা হয়েছে** (MANAGED_STOCK পণ্যের Physical Inventory রেকর্ড না থাকলে অর্ডার Confirm করা যেত না)। বাকি ১২টি ঝুঁকি মালিকের সিদ্ধান্তের জন্য আলাদা করে দেওয়া হয়েছে — সেগুলো এই কাজে বদলানো হয়নি, কারণ নির্দেশনা ছিল “শুধু ফেল করা টেস্টে প্রমাণিত কনফ্লিক্ট ঠিক করো”।

---

## ০. আগে পরিভাষা বুঝে নিন

| শব্দ | সহজ অর্থ |
|---|---|
| **Managed stock** | সিস্টেমের নিজের হিসাব — “আমরা কত পিস বিক্রি করতে পারি”। এটি বিক্রয়ের একমাত্র নিয়ন্ত্রক। |
| **Physical stock** | গুদামে বাস্তবে কত পিস আছে তার হিসাব (Physical Inventory)। |
| **Reserve** | অর্ডার এলেই পিসটি “আটকে” রাখা — কেউ যেন একই পিস দুইবার না কিনতে পারে। |
| **Release** | অর্ডার বাতিল হলে আটকে রাখা পিস ছেড়ে দেওয়া — স্টকে ফেরত, কিন্তু পণ্য গুদামে আগেই ছিল। |
| **Deduct** | পণ্য সত্যিই গুদাম ছাড়লে স্টক থেকে কমিয়ে ফেলা। |
| **Restore** | রিটার্নে পণ্য ফেরত এলে স্টকে ফেরত যোগ করা। |

**দুই স্তরের চুক্তি:** বিক্রি নিয়ন্ত্রণ করে managed স্তর; গুদামের সত্যতা রাখে physical স্তর। অর্ডার তৈরিতে managed reserve হয়, আর অর্ডার Confirm হলে physical reserve হয়। এই দুই স্তর একসাথে চলার কথা `StockRouterService`-এর মাধ্যমে।

---

## B1. স্টক কখন, কোথা থেকে, কোন স্তরে বদলায় (ট্রিগার ম্যাপ)

| # | ঘটনা (trigger) | কোথা থেকে শুরু (entry point) | মূল কোড | Managed | Physical |
|---|---|---|---|---|---|
| ১ | নতুন অর্ডার তৈরি → **RESERVE** | `OrdersService.create` | `apps/backend/src/orders/orders.service.ts:480` (managed), `:2580` → `:431` → `:579` (line-level physical), `:2562` (combo physical) | ✅ | ✅ |
| ২ | অর্ডার এডিটে নতুন আইটেম → **RESERVE** | `OrdersService.updateOrder` | `orders.service.ts:3006`, `:3187` (combo), `:3256` (physical) | ✅ | ✅ |
| ৩ | Exchange (পুরনো পণ্য ফেরত নিয়ে নতুন বিক্রি) → **RESERVE** | `ExchangeService` → `OrdersService.applyStockForLine` | `apps/backend/src/exchange/exchange.service.ts:554`; `orders.service.ts:409` | ✅ | ✅ |
| ৪ | অর্ডার Confirm → **RE-VERIFY + RESERVE** | `OrdersService.updateStatus` → `verifyStockForOrder` | `orders.service.ts:3942`, `:3953`; `verifyStockForOrder` `:6055`; managed reserve `:6127`; physical `:6198`, `:6307`, `:6364` | ✅ | ✅ |
| ৫ | Cancelled → Hold (পুনরুজ্জীবন) → **RE-RESERVE** | `executeTransitionSideEffects` | `orders.service.ts:5735` | ✅ | ✅ |
| ৬ | ডিসপ্যাচ HANDED_OVER (কুরিয়ার পণ্য নিল) → **DEDUCT** | `DispatchService.updateStatus` | `apps/backend/src/dispatch/dispatch.service.ts:580` (`strict: true`) | ✅ | ✅ |
| ৭ | IN_TRANSIT-এ ডিডাকশন মিসিং থাকলে **RETRY DEDUCT** | `DispatchService.updateStatus` | `dispatch.service.ts:593` (`strict: false`) | ✅ | ✅ |
| ৮ | Delivered → **FINAL DEDUCT** | `OrdersService.handleDeliveredSideEffects` | `orders.service.ts:5985` (idempotent, `strict: false`) | ✅ | ✅ |
| ৯ | POS-এ বিক্রি → **DEDUCT** | `PosOrdersService` | `apps/backend/src/pos/pos-orders.service.ts:723`, `:776` | ✅ | ✅ |
| ১০ | বাতিল (অ্যাডমিন/কাস্টমার/বাল্ক/ট্র্যাশ/কুরিয়ার) → **RELEASE** | `updateStatus` / `cancelByCustomer` / `bulkStatusChange` / `trash` / `syncOrderStatus` | `orders.service.ts:3957`, `:5450`, `:4991`, `:5563`; `dispatch.service.ts:712` → `cancel-return-stock.service.ts:262` → `:273` | ✅ | ✅ |
| ১১ | Return Pending (কুরিয়ার পণ্য ফেরত পাঠাচ্ছে) → **HOLD** | `syncOrderStatus` / `updateStatus` | `dispatch.service.ts:772`; `orders.service.ts:3981` | ✅ | ✅ |
| ১২ | স্টাফ রিটার্ন গ্রহণ করল → **RESTORE** | `ReturnsService.markReceived` → `restockReturn` → `restoreStockForReturnTx` | `apps/backend/src/returns/returns.service.ts:571`, `:581`, `:617`; `return-guard.ts:452`; `cancel-return-stock.service.ts:374` | ✅ | ✅ |
| ১৩ | অর্ডার সরাসরি “Returned” করা → **RESTORE (guarded)** | `OrdersService.handleReturnedSideEffects` | `orders.service.ts:5771`, `:5828` | ✅ | ✅ |
| ১৪ | রিটার্নের পণ্য নষ্ট (staff mark damaged) → **WRITE-OFF** | `ReturnsService.markDamaged` → `damageWriteOff` | `returns.service.ts:695`, `:748`; `cancel-return-stock.service.ts:524` | ✅ | ✅ |
| ১৫ | রিকনসিলিয়েশন (ম্যানুয়াল/বুট) → **HEAL** | `StockReconciliationService.healAll` / `healOrder` | `apps/backend/src/stock/stock-reconciliation.service.ts:173`, `:240` | ✅ | ✅ |
| ১৬ | কুরিয়ার ওয়েবহুক (Returned/Received) → **কোনো স্টক লেখা নেই** | `CourierWebhookService` | `apps/backend/src/courier-manager/courier-webhook.service.ts:799`, `:824-843`; `returns.service.ts:829` (`recordCourierParcelBack`) | ❌ | ❌ |

**মোট এন্ট্রি পয়েন্ট (স্টক লেখে এমন):** ৭টি পরিবার — (১) অর্ডার তৈরি, (২) অর্ডার এডিট, (৩) Exchange, (৪) স্ট্যাটাস ট্রানজিশন (Confirm/Cancel/Returned/Delivered), (৫) ডিসপ্যাচ স্ট্যাটাস, (৬) রিটার্ন গ্রহণ/ড্যামেজ, (৭) POS বিক্রি। এর বাইরে শুধু রিকনসিলিয়েশন।

**গুরুত্বপূর্ণ:** কুরিয়ার “পণ্য ফেরত এসেছে” জানালে স্টক **ফেরত আসে না**। শুধু রিটার্ন রেকর্ড ও অর্ডার স্ট্যাটাস বদলায়। স্টাফ যখন হাতে পণ্য বুঝে “Mark received” করে, তখনই স্টক ফেরত যায় — এটি নির্দেশনার সাথে মিলেছে (প্রমাণ: `courier-webhook.service.ts:836-843`, `returns.service.ts:829-835`)।

---

## B2. দ্বিগুণ ডিডাকশন / দ্বিগুণ রিস্টোর / মিসিং অপারেশন — কী পাওয়া গেল

### ২.১ প্রমাণিত কনফ্লিক্ট: ট্র্যাশ করলে বিক্রি হওয়া পণ্য আবার স্টকে ফিরে আসত — **ঠিক করা হয়েছে**

**সমস্যা:** অর্ডার “ট্র্যাশ” করা মানে শুধু তালিকা থেকে লুকানো, বাতিল নয়। কিন্তু পুরনো কোডে ট্র্যাশ করলেই বাতিলের স্টক-রিলিজ চলত। ফলে Delivered/Shipping/Returned অর্ডার ট্র্যাশ করলে যে পণ্য ইতিমধ্যে গুদাম ছেড়ে গেছে, সেটিও আবার বিক্রয়যোগ্য স্টকে যোগ হয়ে যেত — সিস্টেমে ভুয়া স্টক তৈরি হত।

**ঠিক করার কোড:** `orders.service.ts:5540` — `goodsAlreadyLeft = ITEM_EDIT_BLOCKED_STATUSES.has(order.status.name)`; `:5562` — শুধু `goodsAlreadyLeft` মিথ্যা হলে (অর্থাৎ পণ্য এখনো গুদামে থাকলে) রিলিজ চলে।

**কোন ৬টি স্ট্যাটাসে আর বাতিল-রিলিজ (স্টক ফেরত) চলবে না:** Shipping, Delivered, Partial, Return Pending, Returned, Damaged (`order-transitions.ts:61-68`)।

**টেস্ট:** `orders.service.spec.ts:5599` — ৬টি স্ট্যাটাসের জন্য আলাদা টেস্ট (release ডাকা হয়নি) + Confirmed-এর জন্য কন্ট্রোল টেস্ট (release ডাকা হয়েছে)। মোট ৭টি টেস্ট, সব পাস।

**সীমাবদ্ধতা (মালিকের সিদ্ধান্ত):** ট্র্যাশ করার সময় যদি অর্ডার “Shipping” হয় কিন্তু কুরিয়ার এখনো ডিডাক্ট না করে থাকে, তাহলে সেই hold আটকে থাকবে। আবার ট্র্যাশ থেকে ফেরত আনলে (`restore`, `orders.service.ts:5576`) স্টক পুনরায় reserve হয় না। নিচে মালিকের সিদ্ধান্তের তালিকায় আছে।

### ২.২ যেসব কনফ্লিক্ট খুঁজে পাওয়া যায়নি (যাচাই করা হয়েছে)

| সন্দেহ | ফলাফল | প্রমাণ |
|---|---|---|
| একই অর্ডারে দুইবার deduct | **হয় না** — `managedStockDeducted` ফ্ল্যাগ ও physical reservation-এর `ACTIVE` স্ট্যাটাস গার্ড করে; দ্বিতীয় কল no-op | `apps/backend/src/stock/order-stock-deduct.service.ts:21-22`, `:117`, `:196`, `:220` |
| একই রিটার্নে দুইবার restore | **হয় না** — `stockReconciled` / `RESTOCKED` হলে সাথে সাথে return; item-level claim disarm করা হয় | `return-guard.ts:463-465`, `:558`; `cancel-return-stock.service.ts:674`, `:1291-1364` |
| বাতিলে দুইবার release | **হয় না** — managed flag ও reservation status গার্ড; flag cleared হয় | `cancel-return-stock.service.ts:1304-1330` |
| Partial রিটার্নে পুরো অর্ডার restore | **হয় না** — শুধু `Return.items`-এর quantity restore হয়, রাখা অংশ ছোঁয়া হয় না | `cancel-return-stock.service.ts:358-374`; `stock/__tests__/return-items-restore.spec.ts:15`, `:174-186` |
| কুরিয়ার ইভেন্টে স্টক restore | **হয় না** — শুধু রেকর্ড/স্ট্যাটাস | `courier-webhook.service.ts:836-843`; `returns.service.ts:829-835` |
| Confirm-এ স্টক না থাকলেও কনফার্ম | **হয় না** — stock যাচাই আগে চলে, কম থাকলে 400 | `orders.service.ts:3942`, `:6055` |
| zero/negative stock-এ বিক্রি | **হয় না** — managed gate ও physical check দুটোই আছে | `orders.service.ts:6127`, `:6307` |

### ২.৩ নির্দেশনা বনাম কোড: রিটার্নে physical স্তর

নির্দেশনায় বলা ছিল “রিটার্নে শুধু managed স্টক ফেরত যাবে, physical অপরিবর্তিত থাকবে”। কিন্তু কোড ও বিদ্যমান টেস্ট **দুই স্তরই** ফেরত দেয় — `restoreForReturnItems` managed `add` করে এবং CONSUMED reservation-এর ক্ষেত্রে physical on-hand-ও বাড়ায় (`cancel-return-stock.service.ts:374`; pinned by `return-items-restore.spec.ts:174-186`)।

এটি **বদলানো হয়নি**, কারণ এটি একটি ব্যবসায়িক সিদ্ধান্ত: বাস্তবে পণ্য গুদামে ফিরে এলে physical হিসাব না বাড়ালে গুদামের হিসাব মিথ্যা হবে। মালিককে সিদ্ধান্ত নিতে হবে — নির্দেশনা অনুযায়ী managed-only করতে হবে, নাকি বাস্তবতা অনুযায়ী দুই স্তরই রাখতে হবে। **সুপারিশ:** দুই স্তরই রাখুন; শুধু managed-only করলে physical গুদামের হিসাব ও রিটার্ন write-off ভেঙে যাবে।

---

## B3. স্টক ঠিক করার আলাদা স্ক্রিপ্টগুলোর ইনভেন্টরি

| ফাইল | কী করে | কী ধরে নেয় | সমস্যা | সুপারিশ |
|---|---|---|---|---|
| `apps/backend/prisma/scripts/reconcile-stock.ts` | Nest app context-এ `healAll()` বা `healOrder()` চালায় | অর্ডার স্ট্যাটাস ও ফ্ল্যাগ সত্য; কোনো dry-run নেই | ভুল ডেটা হলে সরাসরি স্টক বদলে দেয়; “Damaged” অর্ডারকেও restore করে (মালিকের সিদ্ধান্ত #৩) | একে একমাত্র সমর্থিত টুল রাখুন; `--dry-run` যোগ করুন; Damaged বাদ দিন |
| `apps/backend/prisma/scripts/e2e-inventory-test.ts` | ৬টি ইনভেন্টরি সিনারিও চালায় | ডেভেলপমেন্ট DB; hardcoded admin login; সব blocked IP মুছে ফেলা ও block settings ওভাররাইট করা ঠিক | **ধ্বংসাত্মক** — `blockedIp.deleteMany()` (`:887`), block settings ওভাররাইট (`:888`), PhysicalInventory মুছে ফেলা (`:134-150`), সরাসরি stock রিসেট (`:652`), লাইভ অর্ডার বাতিল; IM টগল `finally`-তে ফেরানো হয় না (`:125`, `:930-942`) | প্রোডাকশনে কখনো নয়; আলাদা টেস্ট DB + `finally` + IM restore; অথবা ডিলিট করুন |
| `apps/backend/prisma/scripts/seed-e2e-test-data.ts` | নির্দিষ্ট slug-এর E2E পণ্য/গুদাম তৈরি ও পরিষ্কার করে | `main-showroom` গুদাম আছে | নির্দিষ্ট slug-এ সীমাবদ্ধ, তাই কম ঝুঁকি; তবু লাইভ DB-তে চালালে ওই পণ্যগুলো মুছে যাবে | রাখুন; শুধু টেস্ট DB-তে চালানোর নিয়ম লিখুন |
| `apps/backend/prisma/scripts/fix-physical-ledger-before-after.ts` | Physical ledger-এর `before/after` নতুন করে লেখে | প্রতিটি গ্রুপ ০ থেকে শুরু; bin location নেই | `binLocationId: null` (`:73`); একবারের মাইগ্রেশন, বারবার চালানোর জন্য নয়; ভুল হলে স্টক ইতিহাস নষ্ট | প্রয়োগ হয়ে গেছে — আর্কাইভ/ডিলিট করুন; ভবিষ্যতে চালাবেন না |
| `apps/backend/src/smoke/return-lifecycle-smoke.ts` | রিটার্ন লাইফসাইকল স্মোক | নিজের তৈরি অর্ডার/পণ্য | শেষে পরিষ্কার করে (`finally`, `:278-287`) | রাখুন (ডেভেলপমেন্ট) |
| `apps/backend/src/smoke/return-lifecycle-physical-smoke.ts` | Physical রিটার্ন স্মোক | IM সেটিং আগের অবস্থায় ফেরে | আগের `inventory_enabled` সংরক্ষণ ও পুনরুদ্ধার করে (`:392-396`) | রাখুন |
| `apps/backend/src/smoke/blocking-smoke.ts` | ব্লকিং স্মোক | শুধু `203.0.113.*` ও নিজের ইউজার মুছে | scoped cleanup (`:52-63`, `:207-211`) | রাখুন |
| `STOCK_RECONCILE_ON_BOOT=true` | অ্যাপ চালু হলেই `healAll()` | প্রোডাকশনে ডেটা ঠিক আছে; ব্যাকআপ আছে | ডিফল্ট **false** (`docker-compose.yml:121`, `.env.example:88`); চালু করলে dry-run ছাড়াই স্টক বদলাবে | ডিফল্ট false রাখুন; দরকার হলে ম্যানুয়াল dry-run আগে |

**পরিষ্কার সুপারিশ:** প্রোডাকশনে শুধু `reconcile-stock.ts` (dry-run যোগ করে) ব্যবহার করুন। বাকি স্ক্রিপ্টগুলো টেস্ট/ডেভ DB-তে সীমাবদ্ধ রাখুন। `e2e-inventory-test.ts` সবচেয়ে বিপজ্জনক — এটি লাইভ ব্লক সেটিংস ও স্টক দুটোই বদলায়।

---

## B4. MANAGED_STOCK পণ্যের Physical Inventory রেকর্ড না থাকলে অর্ডার করা যেত? — **হ্যাঁ, অর্ডার হতো; Confirm হতো না। প্রমাণিত ও ঠিক করা হয়েছে**

### ৪.১ আগের আচরণ (প্রমাণ)

- অর্ডার তৈরিতে শুধু managed reserve হয় (`orders.service.ts:480`)। physical reserve হয় Confirm-এ।
- Confirm-এ `verifyStockForOrder` physical রেকর্ড খোঁজে; না পেলে বাংলা এরর দেয়:
  `"পণ্যের নাম" এর Physical Inventory-তে কোনো Stock রেকর্ড নেই। Inventory Management চালু থাকলে Physical Stock ছাড়া Order Confirm করা যাবে না।`
  — `orders.service.ts:6271-6275` এবং দ্বিতীয় চেক `:6293-6297`।
- তাই পণ্য তৈরি/প্রকাশ করা যেত, অর্ডারও বসত, কিন্তু **Confirm বা ডিসপ্যাচ ডিডাকশন ব্যর্থ** হতো (`dispatch.service.ts:580-586`-এ `strict: true`)। ক্রেতা অর্ডার দিতে পারত, কিন্তু অর্ডার কখনো পূরণ হতো না — এটি নীরব ফাঁদ।
- কারণ: পণ্য তৈরিতে `managedStockQuantity` লেখা হতো, কিন্তু কোনো `PhysicalInventory` row বা `warehouseId` তৈরি হতো না। অ্যাডমিন ফর্ম `warehouseId` পাঠায় না।

### ৪.২ ঠিক করার নিয়ম

পণ্য তৈরি বা ড্রাফট প্রকাশের সময়, যদি **Inventory Management চালু** থাকে এবং পণ্যটি **MANAGED_STOCK** হয় এবং **initial stock > ০** হয়:

1. গুদাম নির্ধারণ: `dto.warehouseId` → প্রথম সক্রিয় `main` গুদাম → প্রথম সক্রিয় গুদাম।
2. কোনো সক্রিয় গুদাম না থাকলে **পণ্য তৈরির আগেই** পরিষ্কার ৪০০ এরর — অর্ধেক-তৈরি পণ্য রেখে যাবে না।
3. পণ্য তৈরি হলে `StockService.operatePhysical('add', { ledgerType: 'INITIAL' })` দিয়ে physical রেকর্ড তৈরি হয়; পণ্যের `warehouseId`-ও সেট হয়।
4. Variant পণ্যে প্রতিটি variant-এর স্টক আলাদাভাবে mirror হয় (parent counter নয়)।

**কোড:** `apps/backend/src/products/products.service.ts:84-181` (তিনটি হেল্পার), `create`-এ `:829` ও `:1007`, `publishDraft`-এ `:1553` ও `:1619`।

### ৪.৩ টেস্ট

| টেস্ট | কী প্রমাণ করে |
|---|---|
| `products.service.spec.ts:793` | simple পণ্যের initial stock physical-এ mirror হয়, `ledgerType: 'INITIAL'` |
| `products.service.spec.ts:833` | সক্রিয় গুদাম না থাকলে পণ্য তৈরির **আগেই** এরর |
| `products.service.spec.ts:851` | IM বন্ধ থাকলে physical স্তর ছোঁয়া হয় না |
| `products.service.spec.ts:868` | variable পণ্যে প্রতিটি variant আলাদাভাবে mirror হয় |
| `products.service.spec.ts:1444` | stocked ড্রাফট প্রকাশ করলেও physical mirror হয় |
| `orders.service.spec.ts:2761` | physical রেকর্ড ছাড়া Confirm করলে ঠিক বাংলা এররটিই আসে (আগের আচরণ pin) |

**সীমাবদ্ধতা:** আগে থেকে তৈরি (legacy) যে পণ্যগুলোর physical রেকর্ড নেই, তারা এখনো Confirm-এ এরর দেবে — এটা ইচ্ছাকৃত (নীরবে ভুল স্টক বানানোর চেয়ে জোরে ব্যর্থ হওয়া ভালো)। এদের একবার backfill করা দরকার; এটি মালিকের সিদ্ধান্ত (নিচে)।

---

## B5. কী বদলানো হয়েছে

| ফাইল | পরিবর্তন | কেন |
|---|---|---|
| `apps/backend/src/orders/orders.service.ts` | `trash()`-এ `goodsAlreadyLeft` গার্ড | বিক্রি/রিটার্ন হওয়া পণ্য ট্র্যাশে ফিরে স্টকে যোগ হতো না |
| `apps/backend/src/orders/orders.service.spec.ts` | ৭টি ট্র্যাশ টেস্ট (৬ স্ট্যাটাস + ১ কন্ট্রোল) + ১টি B4 এরর-টেস্ট | আচরণ pin করা |
| `apps/backend/src/products/products.service.ts` | `StockService` ইনজেকশন + ৩টি হেল্পার + create/publishDraft wiring | MANAGED_STOCK পণ্যের physical রেকর্ড নিশ্চিত করা |
| `apps/backend/src/products/products.service.spec.ts` | ৫টি নতুন টেস্ট | mirror, fail-loud, IM-off, variant, draft publish |
| `docs/muse/2026-10-23-stock-lifecycle-audit.md` | এই রিপোর্ট | ডেলিভারেবল |

**B5 মেনে চলা হয়েছে:** শুধু দুটি প্রমাণিত কনফ্লিক্ট (ট্র্যাশ-রিলিজ ও B4-এর physical রেকর্ড) ঠিক করা হয়েছে; কোনো সমান্তরাল (parallel) নতুন স্টক-পথ তৈরি করা হয়নি — বিদ্যমান `CancelReturnStockService`, `StockService` ও `OrderStockDeductService`-ই ব্যবহার করা হয়েছে।

**স্কিমা বদলানো হয়নি**, কোনো মাইগ্রেশন লাগেনি।

---

## টেস্ট ও বিল্ড প্রমাণ

```
cd apps/backend
npx jest src/orders/orders.service.spec.ts src/products/products.service.spec.ts --runInBand
→ Test Suites: 2 passed, 2 total
→ Tests: 338 passed, 338 total
```

```
cd apps/backend
npx jest src/stock src/returns src/dispatch src/inventory --runInBand
→ Test Suites: 27 passed, 27 total
→ Tests: 290 passed, 290 total
```

```
cd apps/backend
npx nest build
→ exit 0
```

---

## মালিকের সিদ্ধান্ত প্রয়োজন (এই কাজে বদলানো হয়নি)

| # | বিষয় | ঝুঁকি | সুপারিশ |
|---|---|---|---|
| ১ | Delivered-এ স্টক ডিডাকশন ব্যর্থ হলে error গিলে ফেলা হয় (`orders.service.ts:5985-6001`) | অর্ডার Delivered দেখাবে কিন্তু স্টক কমবে না — নীরব ভুল | `strict: true` করুন বা Delivered সেভ করার আগে ব্যর্থতা জানান |
| ২ | ট্র্যাশ → restore-এ স্টক আবার reserve হয় না (`orders.service.ts:5576`) | pre-dispatch অর্ডার restore করলে stock ধরা থাকে না | restore-এ `verifyStockForOrder` চালান, বা restore নিষিদ্ধ করুন |
| ৩ | রিকনসিলিয়েশন “Damaged” অর্ডারকে `restoreForOrder` দিয়ে স্টকে ফেরত দেয় (`stock-reconciliation.service.ts:264-278`) | নষ্ট পণ্য আবার বিক্রয়যোগ্য হয়ে যায় | Damaged বাদ দিন বা `damageWriteOff` ব্যবহার করুন |
| ৪ | সরাসরি স্ট্যাটাস → Damaged করলে কোনো স্টক অপারেশন চলে না (`order-transitions.ts:40-41`; `executeTransitionSideEffects`-এ Damaged case নেই) | Return Pending-এ hold আটকে থাকে; Returned-এ নষ্ট পণ্য বিক্রয়যোগ্য থাকে | Damaged ট্রানজিশনে `markDamaged`/write-off বাধ্যতামূলক করুন |
| ৫ | `InventoryService.adjust` শুধু managed বদলায়, physical নয় (`inventory/inventory.service.ts:615`) | IM চালু থাকলে দুই স্তরে ব্যবধান | physical mirror করুন বা IM চালু থাকলে ব্লক করুন |
| ৬ | ম্যানুয়াল `DELETE /physical-inventory/reservations/:id` (`physical-inventory.controller.ts:399`) রাউটার এড়িয়ে যায় | managed `reservedStock`-এর সাথে অমিল | শুধু সুপারঅ্যাডমিন/অডিট লগ, বা এন্ডপয়েন্ট সরান |
| ৭ | POS-এ cancel/void-এর কোনো স্টক-রিস্টোর পথ নেই (`pos-orders.service.ts:723`, `:776`-এ শুধু deduct) | POS বিক্রি বাতিল করলেও কাটা স্টক ফেরত আসে না | POS cancel/void যোগ করুন বা বাতিল নিষিদ্ধ করুন |
| ৮ | ম্যানুয়াল “Returned” করলে সিস্টেম নিজে FULL return বানিয়ে **পুরো অর্ডার** restock করে (`orders.service.ts:5803-5827`) | আংশিক ফেরত হলে বেশি স্টক ফিরে আসতে পারে | স্টাফের কাছে exact quantity চান |
| ৯ | রিটার্নে managed-only বনাম দুই স্তর (উপরে ২.৩) | নির্দেশনা ও কোড বিপরীত | দুই স্তরই রাখার সুপারিশ |
| ১০ | পুরনো পণ্যের physical রেকর্ড backfill | legacy পণ্য Confirm-এ ব্যর্থ হবে | একবারের scoped backfill স্ক্রিপ্ট (dry-run সহ) |
| ১১ | `InventoryService.restockOrderItems` মৃত কোড (`inventory.service.ts:940`) | ভবিষ্যতে কেউ ভুল করে ব্যবহার করতে পারে | মুছে ফেলুন |
| ১২ | `e2e-inventory-test.ts` ধ্বংসাত্মক | লাইভ ব্লক/স্টক নষ্ট | টেস্ট DB-তে সীমাবদ্ধ করুন বা ডিলিট করুন |

---

## Verification addendum (2026-10-23, acceptance pass)

স্বাধীন যাচাইয়ে (কোড বনাম এই রিপোর্ট) নিচের ফাঁকগুলো পাওয়া গেছে। যা প্রমাণিত ও এই pass-এ ঠিক করা হয়েছে, তা নিচে "ফিক্স" হিসেবে; বাকিটা মালিকের সিদ্ধান্তের তালিকায়।

### ১. Trigger map — অসম্পূর্ণ (সংশোধন)

- **Row 10-এর cancel-release কলার ৫টি নয়, ৭টি:** `RefundsService.create`-এর refund-থেকে-cancel পথ দুটোও একই unified entry-তে যায় (`refunds.service.ts:376`, `:430`)। map-এ যোগ করুন।
- **`RtnService` (return-order মডিউল) আলাদা RESTORE/RELEASE entry:** `rtn.service.ts:837` `restoreForReturnItems`, `:854` `restoreForOrder`, `:1215` `operate('release')` — row 12/13-এ নেই।
- **"এর বাইরে শুধু রিকনসিলিয়েশন" বাক্যটা ভুল:** `import/import.service.ts:603` ও `:912` এবং `purchases.service.ts:729`/`:745` (GRN goods-in) — দুটোই স্টক লেখে।

### ২. Reconciliation script inventory — অসম্পূর্ণ (সংশোধন)

- **Admin heal trigger বাদ পড়েছিল:** `POST /inventory/reconcile` → `StockReconciliationService.healAll()` / `healOrder()` (`inventory/inventory.controller.ts:242-260`)। `STOCK_RECONCILE_ON_BOOT` gate-এর সাথে এটাও ইনভেন্টরিতে থাকা দরকার।
- **"ad-hoc ENV script production inventory নষ্ট করতে পারবে না" — এটা এখনো নিশ্চিত নয়, শুধু সুপারিশ।** `reconcile-stock.ts` ও `e2e-inventory-test.ts` এখনো যে-কোনো live `DATABASE_URL`-এ চালানো যায়; কোনো env guard/dry-run-default/removal এখনো যোগ হয়নি। ⇒ মালিকের সিদ্ধান্ত (উপরের টেবিলে #১২-এর সঙ্গে একসাথে)।

### ৩. নতুন প্রমাণিত কনফ্লিক্ট — B4-b: CSV import physical layer এড়িয়ে যেত ⇒ **ফিক্স করা হয়েছে**

- **কনফ্লিক্ট:** product import (`POST /import/products`, admin-এ `/op/import-products`) সরাসরি `prisma.product.create` / `prisma.productVariant.create` করে `managedStockQuantity` + `manageStock` সেট করে, কিন্তু `warehouseId` নেই এবং **কোনো PhysicalInventory রেকর্ড নেই** ⇒ ঠিক B4-এর সেই নীরব ফাঁদ (managed আছে, physical নেই ⇒ Confirm ব্যর্থ), শুধু অন্য entry point দিয়ে। import সাপোর্ট করা live feature, তাই এটা থাকলে "silent unorderable state থাকবে না" শর্ত ভাঙত।
- **ফিক্স (single entry point):** নতুন `InitialPhysicalStockService` (`apps/backend/src/stock/initial-physical-stock.service.ts`) — warehouse resolve + physical seed একটাই জায়গা। ProductsService (product form + draft publish) এবং ImportService দুটোই এখন এটাই ব্যবহার করে। import এখন **কোনো row লেখার আগেই** warehouse resolve করে (`resolveImportWarehouse`) — active warehouse না থাকলে পুরো import স্পষ্ট 400 নিয়ে থামে, আধা-ইমপোর্ট হয় না। টেস্ট: `import/__tests__/import.service.spec.ts` (৫টি নতুন: simple mirror, variant-wise mirror, warehouse না থাকলে no-op, শুধু stock থাকলে resolve, fail-loud)।

### ৪. মালিকের সিদ্ধান্তে থাকা অবশিষ্ট ঝুঁকি (এই pass-এ ফিক্স করা হয়নি)

- **import-এর UPDATE মোড:** বিদ্যমান product/variant-এর `managedStockQuantity` আপডেট করে (`import.service.ts:738`, `:856`) কিন্তু physical layer ছোঁয় না ⇒ একই ধরনের divergence। এটা আসলে decision #5-এরই (`managed-only adjust`) অংশ — নিয়ম ঠিক করে তারপর ফিক্স হবে।
- **zero-stock product + পরে managed-only adjust:** creation-এ physical ensure শুধু `initialStock > 0` হলে চলে; পরে managed-এ স্টক যোগ করলে আবার physical-হীন অবস্থা ফিরতে পারে — decision #5 দেখুন।

## সীমাবদ্ধতা

- পুরো backend স্যুট এই কাজে চালানো হয়নি (কোঅর্ডিনেটরের কাজ); শুধু সম্পর্কিত স্পেক + বিল্ড চালানো হয়েছে।
- কোনো লাইভ কুরিয়ার API কল করা হয়নি; সব কুরিয়ার টেস্ট মক।
- `batch2-repaired.spec.ts`-এর pre-existing tsc এরর এই কাজের সাথে সম্পর্কিত নয়।
