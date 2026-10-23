# কুরিয়ার লেটেস্ট-ডকস অডিট — Pathao · Steadfast · RedX · Carrybee

**তারিখ:** ২০২৬-১০-২৩
**রিপো:** EcoMate-Web (worktree `f-courier-docs`, branch `burndown/f-courier-docs`, base `e30bdf21`)
**ধরন:** রিপোর্ট-ওনলি। কোনো কোড, ম্যাপিং শিট, মাইগ্রেশন বা কনফিগারেশন পরিবর্তন করা হয়নি।
**নিয়ম:** কোনো credentialed কুরিয়ার operation (order/parcel/payment) করা হয়নি; শুধু ডক-হোস্ট শনাক্ত করতে Carrybee-র unauthenticated পাবলিক `/api/v2/cities` GET একবার চালানো হয়েছে (কোনো key বা user data নেই)। কোনো API key/token/secret কোথাও কপি করা হয়নি। শিট (`01-Mapping.tsv`, `03-Rules.tsv`) কে source of truth ধরা হয়েছে; ডক ও শিটের মধ্যে অমিল থাকলে শুধু রিপোর্ট করা হয়েছে।

---

## ০. এক্সিকিউটিভ সারসংক্ষেপ

চার কুরিয়ারের মধ্যে **RedX-এর সর্বশেষ পাবলিক ডক সরাসরি পাওয়া গেছে** (লাইভ সাইটের JS bundle থেকে, ২০২৬-১০-২৩)। বাকি তিনটির অফিসিয়াল ডক সাইট লগইন-গেটেড/ব্লকড, তাই স্থানীয় ডক-কপি (যা অফিসিয়াল ডকের সেকেন্ডারি কপি) + পাবলিক SDK/মিরর দিয়ে ক্রস-চেক করা হয়েছে; প্রতিটি কুরিয়ারের “source freshness” আলাদাভাবে লেখা আছে।

**মোট ১৮টি বাস্তব ফাইন্ডিং** পাওয়া গেছে (C-5 একটি ইতিবাচক মিল — গণনায় নেই) — এর মধ্যে **৫টি উচ্চ-ঝুঁকি**, তিনটি থিমে:

1. **Return-status owner rule — ৩টি কুরিয়ার, ৩টি উচ্চ ফাইন্ডিং (P-2, S-1, C-1):** courier-এর “ফেরত এসেছে” সিগন্যালে dispatch status `RETURNED` সেট হচ্ছে, কিন্তু শিটের owner rule 25 (২০২৬-১০-১৫) বলছে courier back-signal-এ **সর্বোচ্চ `RETURN_PENDING`**; `RETURNED` শুধু staff-confirmed receive-এ। Pathao (`courier-webhook.service.ts:120`), Carrybee (`:173`), Steadfast return-reconcile (`courier-status-mapper.ts:315`, `courier-webhook.service.ts:793`) — তিনটিই এই নিয়ম ভাঙছে।
2. **RedX dispatch safety — উচ্চ (R-1):** `delivery_area_id` না থাকলে কোড চুপচাপ **area 1** ধরে নিচ্ছে (`courier-manager.service.ts:1597,1641`) — ভুল এরিয়ায় বুকিং হওয়ার ঝুঁকি।
3. **Pathao field limit — উচ্চ (P-1):** ডকে `recipient_address` সর্বোচ্চ **২২০** অক্ষর, কোড **৪৯০** পাঠায় (`courier-manager.service.ts:951-954` + `courier-settle-guard.ts:26`) — ২২১–৪৯০ অক্ষরের ঠিকানা Pathao reject করতে পারে।

এছাড়া যেগুলো দ্রুত দেখা দরকার: **RedX-এর hard-coded ৫০০ গ্রাম parcel weight (R-2, মাঝারি-উচ্চ)**, **Pathao-র hard-coded ০.৫ কেজি `item_weight` (P-6, মাঝারি)** এবং **Steadfast bulk-এ per-order optional field হারানো (S-2, মাঝারি)** — শেষোক্তটিতে কোড পুরোনো `/create_order/bulk-order` ব্যবহার করে (`courier-manager.service.ts:2584-2600,2638`), যদিও ডক নতুন ইন্টিগ্রেশনের জন্য `/create_order/bulk-order/extended` সুপারিশ করে।

**নতুন capability-র মধ্যে সবচেয়ে গুরুত্বপূর্ণ:** Steadfast-এর `/fraud_check/score/{phone}` (পুরোনো `/fraud_check/{phone}` ২০২৬-০৯-২৭-এ sunset) — EcoMate-তে এখনো নেই; COD-ঝুঁকি স্ক্রিনিংয়ের জন্য সরাসরি ব্যবহারযোগ্য।

---

## ১. মেথড, অথরিটি লেভেল ও সীমাবদ্ধতা

### ১.১ অথরিটি লেভেল

| লেভেল | মানে | এই রিপোর্টে ব্যবহার |
|---|---|---|
| **A** | লাইভ অফিসিয়াল ডক (পাবলিকভাবে সরাসরি পড়া গেছে) | RedX |
| **B** | অফিসিয়াল ডকের স্থানীয় কপি (সেকেন্ডারি; তারিখ/স্যাম্পল দিয়ে ফ্রেশনেস যাচাই) | Pathao, Steadfast, Carrybee |
| **C** | পাবলিক SDK/মিরর/কমিউনিটি ডক (শুধু ক্রস-চেক, primary নয়) | Pathao-র কিছু দাবি |

### ১.২ যা করা হয়নি

- কোনো credentialed কুরিয়ার API request (order/parcel/payment) পাঠানো হয়নি (hard rule); শুধু unauthenticated `/api/v2/cities` reachability probe (৬.১)।
- কোনো key/token/secret রিপোর্টে নেই; সব জায়গায় placeholder ধরা হয়েছে।
- শিট বা কোড এডিট করা হয়নি; শুধু `file:line` প্রমাণ ও সুপারিশ।

### ১.৩ “মিল / অমিল” এর সংজ্ঞা

- **মিল:** ডকের আচরণ ও কোডের আচরণ একই; কোড রেফারেন্স দেওয়া আছে।
- **অমিল:** ডক (বা শিটের TARGET) এবং কোডের আচরণ আলাদা; impact + সুপারিশ দেওয়া আছে।
- **নতুন capability:** ডকে আছে, কোডে নেই — বাগ নয়, সুযোগ/ব্যাকলগ।

---

## ২. সামগ্রিক স্কোরবোর্ড

| কুরিয়ার | অফিসিয়াল ডক অ্যাক্সেস | মিল | অমিল | নতুন capability | Source freshness | সামগ্রিক |
|---|---|---|---|---|---|---|
| **Pathao** | **BLOCKED** — লগইন-গেটেড SPA | ১২টি যাচাইকৃত পয়েন্ট | ৬টি (২ উচ্চ, ৩ মাঝারি, ১ নিম্ন) | ৫টি | **মাঝারি-নিম্ন** (কপি ২০২৬-০৯-১০; স্যাম্পল ২০২৪-১২-২৭) | **শর্তসাপেক্ষ মিল** |
| **Steadfast** | **BLOCKED** — portal ব্লক/404 | ১০টি যাচাইকৃত পয়েন্ট | ৪টি (১ উচ্চ, ২ মাঝারি, ১ নিম্ন) | ৮টি | **উচ্চ** (কপি ২০২৬-১০-১১; স্যাম্পল ২০২৬-০৯-২০) | **প্রায়-মিল, ১টি owner-rule লঙ্ঘন** |
| **RedX** | **AVAILABLE** — লাইভ পাবলিক ডক | ৮টি যাচাইকৃত পয়েন্ট | ৪টি (১ উচ্চ, ১ মাঝারি-উচ্চ, ১ মাঝারি, ১ নিম্ন) | ৪টি | **উচ্চ** (লাইভ ২০২৬-১০-২৩; লোকাল কপি হুবহু মিলে) | **মিল, তবে dispatch-safety গ্যাপ** |
| **Carrybee** | **BLOCKED** — পাবলিক ডক URL নেই | ১০টি যাচাইকৃত পয়েন্ট | ৪টি (১ উচ্চ, ২ মাঝারি, ১ নিম্ন-মাঝারি) | ৫টি | **উচ্চ** (কপি ২০২৬-১০-১১; v2) | **প্রায়-মিল, ২টি ডক-দ্বন্দ্ব** |

---

## ৩. Pathao

### ৩.১ ডক-সোর্স ও ফ্রেশনেস

**যে URL-গুলো চেষ্টা করা হয়েছে (২০২৬-১০-২৩):**

| URL | ফলাফল |
|---|---|
| `https://merchant.pathao.com/docs` | HTTP 200, কিন্তু ৬,৪০০ বাইটের SPA shell — লগইন ছাড়া কোনো ডক টেক্সট নেই |
| `https://merchant.pathao.com/docs/api` | HTTP 200, একই shell |
| `https://merchant.pathao.com/api-docs` | HTTP 200, একই shell |
| `https://api-hermes.pathao.com/docs` | HTTP 404 |
| `https://api-hermes.pathao.com/openapi.json` | HTTP 404 |
| `https://courier-api-sandbox.pathao.com/docs` | connection failure (HTTP 000) |

**স্ট্যাটাস: BLOCKED (অফিসিয়াল ডক সরাসরি পড়া যায়নি)।**
**ব্যবহৃত সোর্স:** `Pathao Courier API Documenttation.md` (মtime ২০২৬-০৯-১০) + `Webhook Documentation Pathao.md` (মtime ২০২৬-০৯-১০) — লেভেল **B**।
**ক্রস-চেক:** কমিউনিটি SDK `pathao-merchant-sdk@2.2.0` README (লেভেল **C**) — bulk 202 এবং `order.return-id-created` / `order.return-in-transit` / `order.returned-to-merchant` — তিনটি return event-এর অস্তিত্ব নিশ্চিত করে।

**ফ্রেশনেস নোট:** লোকাল কপির স্যাম্পল পেলোডের তারিখ **২০২৪-১২-২৭**; অর্থাৎ কপিটি ২০২৪-পরবর্তী। ২০২৬-এ Pathao-র নতুন কিছু (যেমন `order.accepted`) থাকলে তা এই কপিতে নেই। অফিসিয়াল সাইট ব্লকড থাকায় **Pathao-র জন্য “সর্বশেষ” দাবি করা যাচ্ছে না** — এটাই এই রিপোর্টের সবচেয়ে বড় সোর্স-ঝুঁকি।

### ৩.২ মিল (ডক ↔ কোড)

| # | ডক যা বলে | কোড | প্রমাণ |
|---|---|---|---|
| P-M1 | OAuth token: `POST /aladdin/api/v1/issue-token`, password + refresh grant | token issue + refresh + cache | `apps/backend/src/courier-manager/courier-token.service.ts:45-104` |
| P-M2 | Create order: `store_id`, `merchant_order_id`, `recipient_name/phone/address`, `delivery_type=48`, `item_type=2`, `item_quantity`, `item_weight`, `amount_to_collect` | field set একই; `item_weight` hard-coded (P-6) | `apps/backend/src/courier-manager/courier-manager.service.ts:941-981` |
| P-M3 | Bulk create: `POST /aladdin/api/v1/orders/bulk`, সফল হলে **HTTP 202 + `data:true`**, “accepted, processing” | 202 + `data:true` দুটোই চেক করে; না হলে throw | `courier-manager.service.ts:1336,1391-1399` |
| P-M4 | Order info: `GET /orders/{consignment_id}/info` | primary info; 404 হলে legacy `/tracking` fallback | `courier-manager.service.ts:1520-1521`; `courier-tracking.service.ts:510-535` |
| P-M5 | Webhook event vocabulary: ২৪টি order/store event | ২২টি order event + `store.*` no-op — মোট ২৪টি কভার | `courier-webhook.service.ts:93-121,1226-1228` |
| P-M6 | Inbound `X-PATHAO-Signature` = merchant-এর দেওয়া secret **verbatim** (HMAC নয়) | constant-time verbatim compare | `courier-webhook.controller.ts:184-207` |
| P-M7 | Response-এ `X-Pathao-Merchant-Webhook-Integration-Secret` echo করতে হবে; URL ১০ সেকেন্ডের মধ্যে respond করা উচিত | auth pass হলে header + HTTP 202 | `courier-webhook.controller.ts:548-557` |
| P-M8 | `order.return-id-created` → return consignment তৈরি | unified Return entity create/link + return type map | `courier-webhook.service.ts:1337-1350` |
| P-M9 | `order.paid` = payout/invoice; COD টাকা | DELIVERED + `invoice_id` timeline/attempt-meta-তে | `courier-webhook.service.ts:115,1321-1326` |
| P-M10 | `order.updated`, `order.delivery-failed` ইত্যাদি status পরিবর্তন করে না | skip path: raw courierStatus + timeline, workflow অপরিবর্তিত | `courier-webhook.service.ts:1247-1291` |
| P-M11 | `order.pickup-cancelled` — পিকআপ না হলে cancel, পিকআপ হয়ে গেলে return | conditional `resolveCancelledStatus` | `courier-webhook.service.ts:1293-1295,940-951` |
| P-M12 | Tracking API-র plain status (`Pickup Requested`, `In Transit`, `Delivered`, `Partial Delivery`, …) | exact map + keyword fallback | `courier-status-mapper.ts:91-158` |

**নোট (P-M7):** ১০ সেকেন্ডের response-time requirement কোডে আলাদা করে enforce করা নেই — handler synchronous, তাই echo + 202 সাথে সাথে ফেরে; কিন্তু explicit timeout/watchdog নেই। লাইভ আচরণ যাচাই করা যায়নি (B-4)।

### ৩.৩ অমিল (ডক/শিট ↔ কোড)

#### P-1 · উচ্চ · `recipient_address` limit ২২০ vs ৪৯০

- **ডক:** `recipient_address` — “Address length should be between **10 to 220** characters.” (`Pathao Courier API Documenttation.md`, Create Order table)।
- **কোড:** Pathao payload-এ `COURIER_FIELD_LIMITS.address` = **৪৯০** ব্যবহার হচ্ছে — যা Steadfast-এর limit, Pathao-র নয়।
- **প্রমাণ:** `apps/backend/src/courier-manager/courier-manager.service.ts:951-954`; limit:`courier-settle-guard.ts:22-28` (address: 490)।
- **Impact:** ২২১–৪৯০ অক্ষরের ঠিকানা Pathao 422 দিয়ে reject করতে পারে; dispatch fail হবে, অথচ UI-তে আগে থেকে সতর্কতা নেই। কমেন্টেও ভুল ধারণা লেখা আছে (“address caps unstated”) — ডকে স্পষ্ট ২২০ আছে।
- **সুপারিশ:** per-courier limit — Pathao 220, Steadfast 490, RedX/Carrybee আলাদা; truncate নয়, বরং dispatch-এর আগে shaped validation error।

#### P-2 · উচ্চ · `order.returned-to-merchant` → dispatch `RETURNED` (শিটের TARGET `RETURN_PENDING`)

- **ডক:** `order.returned-to-merchant` = “Parcel back with merchant”।
- **শিট TARGET:** `RETURN_PENDING` — “courier back-signal is NOT our receipt — dispatch max RETURN_PENDING (never RETURNED on any courier event); RETURNED only when staff marks received” (`03-Rules.tsv` rule 25, owner ২০২৬-১০-১৫; `01-Mapping.tsv` row 23)।
- **কোড:** `'order.returned-to-merchant': 'RETURNED'` — webhook ও tracking mapper দুটোতেই।
- **প্রমাণ:** `courier-webhook.service.ts:120`; `courier-status-mapper.ts:114`।
- **Impact:** dispatch-এ `RETURNED` (staff-confirmation state) আর courier-claim-এর মধ্যে পার্থক্য থাকে না; settlement/stock-এর মতো downstream logic যদি `RETURNED`-কে “received” ধরে, তাহলে ভুল সিদ্ধান্তের ঝুঁকি। Order status অবশ্য `Return Pending`-ই থাকে (`PATHAO_DISPATCH_TO_ORDER[RETURNED]`), তাই ইউজার-ভিউ ঠিক দেখায় — সমস্যাটা dispatch/state level-এ।
- **সুপারিশ:** `RETURN_PENDING`-এ clamp; staff receive আলাদা action।

#### P-3 · মাঝারি · Cancel endpoint ডকে নেই

- **ডক:** লোকাল Pathao ডকে cancel endpoint নেই (শুধু create/bulk/info/locations/stores/price-plan)।
- **কোড:** `POST /aladdin/api/v1/orders/{consignment_id}/cancel` ব্যবহার করে; কোড-কমেন্ট নিজেই স্বীকার করে এটি third-party integration থেকে নেওয়া।
- **প্রমাণ:** `courier-manager.service.ts:1526-1580` (endpoint `:1562-1563`)।
- **Impact:** Pathao এই endpoint বদলালে/বন্ধ করলে cancel ভাঙবে; অফিসিয়াল কনট্রাক্ট নেই।
- **সুপারিশ:** রাখা যেতে পারে (বাস্তবে কাজ করে), কিন্তু contract test + feature flag + Pathao account manager-এর সাথে নিশ্চিতকরণ দরকার।

#### P-4 · মাঝারি · Echo header-এ per-merchant override

- **ডক:** response header-এ **ফিক্সড, merchant-independent integration constant** থাকতে হবে (সব merchant-এর জন্য একই); এটা merchant secret নয়।
- **কোড:** stored `pathaoIntegrationSecret` থাকলে সেটাই echo করে, নাহলে ডকের constant।
- **প্রমাণ:** `courier-webhook.controller.ts:548-555`; constant `:30-37`।
- **Impact:** কেউ ভুল/পুরোনো `pathaoIntegrationSecret` সেট করলে Pathao-র webhook verification fail করবে — অথচ ইনবাউন্ড auth ঠিকই থাকবে। বিভ্রান্তিকর failure।
- **সুপারিশ:** সবসময় ডকের fixed constant echo করা; override অপশন সরানো বা constant-এর সাথে মিলিয়ে validate করা।

#### P-5 · নিম্ন · `item_quantity` = line count, item-এর মোট quantity নয়

- **ডক:** `item_quantity` — “Quantity of your parcels”।
- **কোড:** `order.items?.length || 1` — প্রতি line-এ ১ ধরে; একটি line-এ quantity ৫ থাকলেও ১ পাঠায়।
- **প্রমাণ:** `courier-manager.service.ts:957`।
- **Impact:** multi-quantity line-এ parcel count কম দেখাতে পারে; normalmente ১টি parcel-ই হয়, তাই ঝুঁকি নিম্ন — তবে ডক-অর্থের সাথে অসঙ্গতি।
- **সুপারিশ:** owner decision — “parcel count = line count” নাকি “sum of quantities”।

#### P-6 · মাঝারি · `item_weight` সবসময় ০.৫ কেজি

- **ডক:** `item_weight` — “Minimum 0.5 KG to Maximum 10 kg. Weight of your parcel in kg.” (Create Order ও Bulk Create দুটোতেই required)।
- **কোড:** `item_weight: 0.5` — literal hard-code; order/product weight কোথাও পড়া হয় না।
- **প্রমাণ:** `courier-manager.service.ts:958`; Pathao bulk একই builder reuse করে (`:1318`)।
- **Impact:** ০.৫ কেজির বেশি parcel-ও ০.৫ কেজি হিসেবে book হবে (single ও bulk দুটোতেই) → Pathao-র weight-based delivery charge ও settlement-এ পার্থক্য; COD reconciliation-এ mismatch। Carrybee-তে `resolveCarrybeeWeightGrams` আছে, Pathao-তে সমতুল্য নেই।
- **সুপারিশ:** Carrybee-র মতো order/product weight থেকে derive; না থাকলে explicit weight বাধ্যতামূলক বা documented default + dispatch warning।

### ৩.৪ নতুন capability (ডকে আছে, কোডে নেই)

| # | ডক capability | কোডে অবস্থা | প্রমাণ/নোট |
|---|---|---|---|
| P-N1 | `POST /aladdin/api/v1/stores` (store create), `GET /stores` (list) | নেই — শুধু configured `storeId` | `courier-manager.service.ts:941-981`-এ শুধু store_id ব্যবহৃত |
| P-N2 | `GET /aladdin/api/v1/merchant/price-plan` | নেই | কোনো method/route নেই |
| P-N3 | `GET /aladdin/api/v1/zones/{zone_id}/area-list` | নেই — শুধু city/zone lookup | `courier-manager.service.ts:3046-3099` |
| P-N4 | `order.accepted` event (পাবলিক SDK-তে আছে, লোকাল ডকে নেই) | ম্যাপ নেই, কিন্তু unknown event হিসেবে record হয় — workflow বদলায় না | `courier-webhook.service.ts:1247-1291` (safe skip) |
| P-N5 | `Payment Invoice` event (ডকের UI-লিস্টে আছে, sample/event-name নেই) | ম্যাপ নেই; unknown হিসেবে record | একই skip path — নিরাপদ, তবে event নাম যাচাই দরকার |

### ৩.৫ Pathao ভার্ডিক্ট

**শর্তসাপেক্ষ মিল।** মূল create/bulk/info/webhook/signature/return-link সবই ডকের সাথে মেলে। কিন্তু **address limit ভুল**, **item_weight hard-code**, **returned-to-merchant-এ owner rule লঙ্ঘন**, **cancel endpoint অপ্রমাণিত**, এবং **echo header override** — এই পাঁচটি ঠিক করা দরকার। অফিসিয়াল ডক ব্লকড থাকায় নতুন event/endpoint (যেমন `order.accepted`, `Payment Invoice`) যাচাই করা যায়নি।

---

## ৪. Steadfast

### ৪.১ ডক-সোর্স ও ফ্রেশনেস

**যে URL-গুলো চেষ্টা করা হয়েছে (২০২৬-১০-২৩):**

| URL | ফলাফল |
|---|---|
| `https://portal.packzy.com/` | HTTP 200, কিন্তু ৪,৮৮৪ বাইটের block page |
| `https://portal.packzy.com/api/v1` | HTTP 404 |
| `https://portal.packzy.com/api/v1/docs` | HTTP 404 |
| `https://portal.packzy.com/docs` | HTTP 404 |
| `https://packzy.com/api/v1` | HTTP 404 (JSON) |
| `https://packzy.com/docs` | HTTP 404 |
| `https://steadfast.com.bd/api-docs` | HTTP 404 |
| `https://docs.steadfast.com.bd` | DNS/connection failure |
| `https://developer.steadfast.com.bd` | DNS/connection failure |

**স্ট্যাটাস: BLOCKED (অফিসিয়াল ডক সরাসরি পড়া যায়নি)।**
**ব্যবহৃত সোর্স:** `Steadfast API Docs.md` (মtime ২০২৬-১০-১১; স্যাম্পল তারিখ **২০২৬-০৯-২০**) + `SteadFast Webhooks Docs.md` (মtime ২০২৬-১০-১১) — লেভেল **B**।
**ফ্রেশনেস নোট:** এই দুটি কপি এই রিপোর্টের **সবচেয়ে তাজা** সোর্স — ১৮টি endpoint, HMAC + `Idempotency-Key`, retry policy, multi-profile keys, fraud-score endpoint — সবই ২০২৬-সেপ্টেম্বরের ডক-ভাষা। তবু অফিসিয়াল সাইট ব্লকড, তাই “লাইভ ডক” হিসেবে দাবি করা হচ্ছে না।

### ৪.২ মিল (ডক ↔ কোড)

| # | ডক যা বলে | কোড | প্রমাণ |
|---|---|---|---|
| S-M1 | `POST /create_order` + field limits: invoice 100, name 100, phone 11 (01…), address 490, note 480, COD ≤ 1,000,000, `delivery_type` 0/1 | হুবহু limit + `delivery_type` home/hub map | `courier-manager.service.ts:616-655`; limits `courier-settle-guard.ts:22-28` |
| S-M2 | `GET /status_by_cid/{id}` (legacy `/status_by_consignment` 404) | `status_by_cid` ব্যবহার | `courier-tracking.service.ts:419-430` |
| S-M3 | Status vocabulary: `in_review`, `pending`, `hold`, `*_approval_pending`, `delivered`, `partial_delivered`, `cancelled`, `exceptional`, `unknown` | সবগুলো ম্যাপ করা; approval_pending settle করে না | `courier-status-mapper.ts:38-86`; webhook `:40-58` |
| S-M4 | Return vocabulary (৬টি) শুধু `status_with_return_status_by_cid`-তে | return map + reconcile endpoint | `courier-status-mapper.ts:308-329`; `courier-webhook.service.ts:764-793` |
| S-M5 | Conditional cancel: পিকআপ হয়ে থাকলে return, না হলে cancel | `resolveCancelledStatus` | `courier-webhook.service.ts:326-328,940-951` |
| S-M6 | Webhook: `Authorization: Bearer` + `X-Signature` HMAC-SHA256(raw body, token); `Idempotency-Key`; 3 attempts (30s, 2min); 4xx retry নয় | HMAC যাচাই, Idempotency-Key claim (P2002 → replay ignore), 4xx অপরিবর্তিত | `courier-webhook.controller.ts:131-177,375-411,445-476` |
| S-M7 | Returns: `POST /create_return_request`, `GET /get_return_requests`, `GET /get_return_request/{id}` | তিনটিই আছে | `courier-manager.service.ts:2355,2377,2413` |
| S-M8 | `GET /get_balance`, `GET /payments`, `GET /payments/{id}`, `GET /police_stations` | সবগুলো আছে | `courier-manager.service.ts:2280,2477,2512,2532` |
| S-M9 | Bulk: `POST /create_order/bulk-order`, সর্বোচ্চ ৫০০ | ৫০০ limit + per-entry error parse | `courier-manager.service.ts:2542-2565,2638` |
| S-M10 | Record-only notifications: `return_list_accepted`, `payment_request`, `cancel_request`, `return_request`, `pickup_request`, `user_update`; `tracking_update`/`consignment_update` status বদলায় না | record-only branch + timeline | `courier-webhook.service.ts:63-70,267-307` |

### ৪.৩ অমিল (ডক/শিট ↔ কোড)

#### S-1 · উচ্চ · `cancelled_return_received` → dispatch `RETURNED` (শিটের TARGET `RETURN_PENDING`)

- **ডক:** `cancelled_return_received` = “Cancelled; you have it back” — courier বলছে parcel merchant-এর কাছে ফিরেছে।
- **শিট TARGET:** `RETURN_PENDING` — “courier claims parcel back → dispatch max RETURN_PENDING (never RETURNED on courier event); RETURNED + stock reconcile only on staff-confirmed received” (`03-Rules.tsv` rule 25, owner ২০২৬-১০-১৫; `01-Mapping.tsv` row 44)।
- **কোড:** `STEADFAST_RETURN_MAP['cancelled_return_received'].dispatchStatus = 'RETURNED'`; reconcile path এই status-ই dispatch-এ লেখে।
- **প্রমাণ:** `courier-status-mapper.ts:312-315`; `courier-webhook.service.ts:793`।
- **Impact:** Return entity নিজে `PARCEL_BACK`-এ থাকে এবং stock restore হয় না (ভালো — `courier-webhook.service.ts:830-862`), কিন্তু **dispatch `RETURNED`** হয়ে যায়। অর্থাৎ dispatch-level state বলে “staff receive হয়ে গেছে”, অথচ হয়নি। এই অসঙ্গতি রিপোর্ট/সেটেলমেন্ট/ড্যাশবোর্ডে ভুল পড়া দিতে পারে।
- **সুপারিশ:** `_received`-এ dispatch `RETURN_PENDING`; staff “Mark received” করলে `RETURNED`। (Order status `Return Pending`-ই থাকবে।)

#### S-2 · মাঝারি · Bulk-এ per-order optional field হারায় + non-extended endpoint

- **ডক:** `/create_order/bulk-order/extended` “Prefer this one for a new integration”; এটি per-order `recipient_email`, `alternative_phone`, `item_description`, `total_lot` নেয়; পুরোনো bulk endpoint এগুলো top-level থেকে পড়ে।
- **কোড:** bulk body-তে শুধু `invoice`, `recipient_name`, `recipient_phone`, `recipient_address`, `cod_amount`, `note`; endpoint `/create_order/bulk-order` (non-extended)।
- **প্রমাণ:** `courier-manager.service.ts:2584-2600,2638`।
- **Impact:** bulk dispatch-এ email/alternative phone/item description যায় না (single dispatch-এ যায় — `:635-660`); `total_lot` কোথাও পাঠানো হয় না, তাই ডিফল্ট ১ ধরে হয় — multi-item order-এ under-declare। অর্থাৎ একই অর্ডার single বনাম bulk-এ ভিন্নভাবে book হবে; customer communication/attempt-success-এ প্রভাব।
- **সুপারিশ:** extended endpoint-এ switch + per-order optional field পাঠানো; error-code translation (`STEADFAST_BULK_ERROR_RULES`) অপরিবর্তিত রাখা যায়।

#### S-3 · মাঝারি · Tracking status map-এ পুরোনো label; current vocabulary-র message fallback raw

- **ডক:** current vocabulary `in_review`, `delivered_approval_pending`, `partial_delivered_approval_pending`, `cancelled_approval_pending`, `unknown_approval_pending`, `exceptional`, `unknown`।
- **কোড:** `STEADFAST_STATUS_MAP`-এ পুরোনো `picked`, `transit`, `delivered_customer`, `return_process` আছে; current label map-এ নেই, তাই raw pass-through হয়। Dispatch mapping ঠিকই কাজ করে (status-mapper exact map ধরে), কিন্তু `msgMap`-এ current label নেই → timeline message-এ raw `in_review`/`delivered_approval_pending` দেখায়।
- **প্রমাণ:** `courier-tracking.service.ts:407-417` (map), `:458-473` (msgMap)।
- **Impact:** staff-facing timeline-এ অপরিচ্ছন্ন/অনুবাদহীন label; ভুল status নয়, কিন্তু UX ও audit readability খারাপ।
- **সুপারিশ:** current vocabulary + বাংলা/ইংরেজি human message যোগ করা; পুরোনো label backward-compat-এর জন্য রাখা।

#### S-4 · নিম্ন · Webhook-এ `*return*` label নীরবে skip

- **ডক:** webhook `delivery_status` vocabulary-তে return label নেই (শুধু pending/delivered/partial_delivered/cancelled/unknown); return শুধু `status_with_return_status_by_cid`।
- **কোড:** `rawStatus.includes('return')` হলে log + success, কোনো timeline/alert নেই।
- **প্রমাণ:** `courier-webhook.service.ts:312-322`।
- **Impact:** ডকের সাথে মিল আছে; কিন্তু Steadfast ভবিষ্যতে webhook-এ return label পাঠালে সেটি নীরবে হারাবে — vocabulary-change detector নেই।
- **সুপারিশ:** skip রাখা, কিন্তু `logger.warn` + timeline “out-of-vocabulary return label” alert যোগ করা।

### ৪.৪ Steadfast রিব্র্যান্ডিং ও মাল্টি-মার্চেন্ট (আলাদা চেক)

**রিব্র্যান্ডিং:**

- ডকে ব্র্যান্ড **“SteadFast Courier”**-ই আছে; API host **`portal.packzy.com`**। “Packzy” হলো API/portal hostname, আলাদা ব্র্যান্ড-রিনেমের কোনো প্রমাণ ডকে নেই।
- কোডের `BASE_URLS.steadfast` = `https://portal.packzy.com/api/v1` — ডকের সাথে মিল। প্রমাণ: `courier-manager.service.ts:17-21`।
- **সিদ্ধান্ত:** রিব্র্যান্ডিং-সংক্রান্ত কোনো কোড-পরিবর্তন দরকার নেই; তবে ভবিষ্যতে host বদলালে `BASE_URLS`-ই single point of change।

**মাল্টি-মার্চেন্ট / একাধিক প্রোফাইল:**

- **ডক (২০২৬-০৯-২০):** “Keys belong to one profile” — প্রতিটি business-এর নিজস্ব key; এক business-এর key অন্য business-এর parcel/payout দেখতে পারে না। এটাই এক shop-এর developer-কে key দেওয়া নিরাপদ করে।
- **কোড:** একাধিক named credential set, per-set API key/secret/webhook secret, default set, per-order override, booking-set থেকে tracking resolve, webhook-এ booking set আগে তারপর বাকি set — সবই আছে।
- **প্রমাণ:** `courier-manager.controller.ts:217-254` (CRUD sets), `:329-350` (bulk override); `courier-manager.service.ts:301-317` (resolve one profile, no cross-profile retry); `courier-tracking.service.ts:379-390` (booking set); `courier-webhook.controller.ts:136-159` (preferred set → all sets).
- **মিল:** **হ্যাঁ** — ডকের per-profile isolation-এর সাথে কোডের “resolve exactly one profile, 401-এ fail fast, অন্য profile-এ fall through নয়” মিলে।
- **সীমা:** bulk-এ per-order account picker নেই; batch default account-এ book হয় (কোড-কমেন্ট `courier-manager.service.ts:2546-2552`, admin-এ সতর্কবার্তা)। ডক এটি নিষিদ্ধ করে না, কিন্তু multi-shop operation-এ owner-কে জানানো দরকার।

### ৪.৫ নতুন capability (ডকে আছে, কোডে নেই)

| # | ডক capability | কোডে অবস্থা | নোট |
|---|---|---|---|
| S-N1 | `GET /fraud_check/score/{phone}` — delivery/cancellation ratio, volume band, fraud categories; `score`/`level` এখন **সবসময় null** (`scoring_disabled: true`) | নেই | **সর্বোচ্চ অগ্রাধিকার**; পুরোনো `/fraud_check/{phone}` **২০২৬-০৯-২৭**-এ counts দেওয়া বন্ধ করেছে (Deprecation/Sunset header) |
| S-N2 | `GET /ping` — credential ছাড়া health check | নেই | deployment/health-monitor-এ উপযোগী |
| S-N3 | `GET /status_by_invoice/{invoice}` | নেই — শুধু by cid | invoice দিয়ে track করলে useful |
| S-N4 | `GET /status_by_trackingcode/{tracking_code}` | নেই | tracking code দিয়ে track |
| S-N5 | `GET /trackings_by_invoice/{invoice}` — সব step | নেই | full history |
| S-N6 | `POST /create_pickup_request` | নেই | pickup scheduling |
| S-N7 | `POST /create_order/bulk-order/extended` | নেই (non-extended ব্যবহৃত) | S-2 দেখুন |
| S-N8 | Rate limits: 1,000 req/min; booking 6,000/min; 401 lockout 10/5min → 429 60min | code 401 retry করে না (ভালো), কিন্তু client-side limiter নেই | low; bulk-এ চাপে 429 এড়াতে limiter সুপারিশ |

**Fraud-score নোট:** ডকে স্পষ্ট — `delivery_ratio`/`cancellation_ratio` finished parcel-এর শতাংশ; কিছুই finished না হলে **null**, 0 নয়; `delivered_count`/`cancelled_count` শুধু নিয়মিত booking করলে; `volume_band` none/low/medium/high/very_high। এই semantics ভুল করে 0 ধরে UI দেখালে ভুল সিদ্ধান্ত হবে — adapter বানালে এগুলো হুবহু রাখতে হবে।

### ৪.৬ Steadfast ভার্ডিক্ট

**প্রায়-মিল, কিন্তু ১টি owner-rule লঙ্ঘন।** create/track/returns/payments/webhook-auth/idempotency/multi-profile — সবই ডকের সাথে ভালোভাবে মেলে। মূল সমস্যা **S-1** (courier `_received`-এ dispatch `RETURNED`) এবং **S-2** (bulk optional field loss)। নতুন ডকের মধ্যে **fraud-score** সর্বোচ্চ ব্যবসায়িক সুযোগ।

---

## ৫. RedX

### ৫.১ ডক-সোর্স ও ফ্রেশনেস

**যে URL ব্যবহার করা হয়েছে (২০২৬-১০-২৩):**

| URL | ফলাফল |
|---|---|
| `https://redx.com.bd/developer-api/` | HTTP 200 (SPA; trailing slash canonical) |
| `https://redx.com.bd/_next/static/chunks/pages/developer-api-fb24bbe4344e870c.js` | HTTP 200, ৫৮,১২৪ বাইট — সম্পূর্ণ ডক-কনটেন্ট (statuses, delivery types, endpoints) |

**স্ট্যাটাস: AVAILABLE (লাইভ পাবলিক ডক পড়া গেছে)।** লেভেল **A**।
**লোকাল কপি:** `REDx API and Webhook Documentation.md` (মtime ২০২৬-০৯-১০) — লাইভ ডকের সাথে ৮টি status, ৬টি delivery type, একই parcel endpoint মিলে যায়।
**ফ্রেশনেস নোট:** **উচ্চ** — লাইভ ডক ২০২৬-১০-২৩-এ retrieved; লোকাল কপি হুবহু মেলে। তবে লাইভ ডকে `pickup-pending` status নেই (৮টির তালিকায়), অথচ কোড সেটি ম্যাপ করে — এটি ডকের ঘাটতি, কোডের বাগ নয়।

### ৫.২ মিল (ডক ↔ কোড)

| # | ডক যা বলে | কোড | প্রমাণ |
|---|---|---|---|
| R-M1 | `POST /parcel` — `merchant_invoice_id`, `customer_name/phone/address`, `delivery_area`, `delivery_area_id`, `cash_collection_amount`, `parcel_weight`, `value`, `parcel_details_json` | হুবহু field set | `courier-manager.service.ts:1616-1665` |
| R-M2 | Cancel: `PATCH /parcels` + `property_name=status`, `new_value=cancelled` | একই PATCH | `courier-manager.service.ts:2976-2999`; route `courier-manager.controller.ts:382-389` |
| R-M3 | `GET /parcel/track/{id}`, `GET /parcel/info/{id}` | দুটোই আছে | `courier-tracking.service.ts:593-598`; `courier-manager.service.ts:2883,2892` |
| R-M4 | `GET /charge/charge_calculator?delivery_area_id=&pickup_area_id=&cash_collection_amount=&weight=` | হুবহু | `courier-manager.service.ts:2916-2951` |
| R-M5 | Webhook status ৮টি: `ready-for-delivery`, `delivery-in-progress`, `delivered`, `agent-hold`, `agent-returning`, `returned`, `agent-area-change`, `paid` | ৮টিই ম্যাপে আছে | `courier-webhook.service.ts:194-218` |
| R-M6 | `delivery_type=partial-delivery` হলে delivered-কে partial ধরতে হবে | `delivered` + `partial-delivery` → `PARTIAL` | `courier-webhook.service.ts:1454-1456` |
| R-M7 | `paid` = delivery + money | DELIVERED + invoice/timeline + definite amount | `courier-webhook.service.ts:1463-1464,1513-1551` |
| R-M8 | Webhook auth: callback URL-এ `?token=` | query token constant-time compare; optional HMAC | `courier-webhook.controller.ts:248-281`; query token `:91-95`; path sanitize `:69-71` |

### ৫.৩ অমিল (ডক/শিট ↔ কোড)

#### R-1 · উচ্চ · `delivery_area_id` না থাকলে চুপচাপ area 1

- **ডক:** `delivery_area_id` — “The unique identifier of the area where the parcel will be delivered” (Create Parcel-এ required)।
- **কোড:** `const deliveryAreaId = address?.deliveryAreaId || address?.areaId || 1;` এবং payload-এ `Number(deliveryAreaId) || 1`।
- **প্রমাণ:** `courier-manager.service.ts:1597,1641`।
- **Impact:** area config না থাকলে **সব parcel area 1-এ** book হবে — ভুল delivery charge, ভুল হাব/রুট, সম্ভবত ভুল ঠিকানায় delivery। Silent fallback, তাই staff বুঝবে না।
- **সুপারিশ:** area missing/invalid হলে shaped field error দিয়ে dispatch আটকানো; area 1 fallback কখনো নয়।

#### R-2 · মাঝারি-উচ্চ · `parcel_weight` সবসময় ৫০০ গ্রাম

- **ডক:** `parcel_weight` — Create Parcel টেবিলে “Weight of the parcel in appropriate units (e.g., kg, g)”, track-response টেবিলে “Weight of the parcel in grams” — ডকে unit নিয়ে অসঙ্গতি; যেভাবে হোক এটি charge calculation-এর input।
- **কোড:** `parcel_weight: String(500)` — hard-coded (unit ডকে অস্পষ্ট হওয়ায় ৫০০-এর অর্থই অনির্দিষ্ট)।
- **প্রমাণ:** `courier-manager.service.ts:1647`।
- **Impact:** ২ কেজি parcel-ও ৫০০ গ্রাম হিসেবে book হবে → under-charge/over-charge, reconciliation-এ mismatch; RedX weight-based charge ভুল।
- **সুপারিশ:** order/product weight থেকে derive; না থাকলে explicit weight বাধ্যতামূলক বা documented default + warning। (Carrybee-তে `resolveCarrybeeWeightGrams` আছে — RedX-এ সমতুল্য নেই।)

#### R-3 · মাঝারি · Skip status (বিশেষত `agent-area-change`) একেবারেই record হয় না

- **ডক:** `agent-area-change` = “Area change requested & in progress” — merchant-এর জানা দরকার।
- **শিট:** “KEEP — record; no status change”।
- **কোড:** `REDX_DISPATCH_MAP['agent-area-change'] = null`; handler-এ `if (!dispatchStatus) { log; return }` — **raw courierStatus/timeline কিছুই persist হয় না**।
- **প্রমাণ:** `courier-webhook.service.ts:217,1467-1470`।
- **Impact:** area-change বা অপরিচিত RedX status নীরবে হারায়; Pathao-র skip path (`:1247-1291`) raw + timeline রাখে, RedX রাখে না — অসঙ্গত audit trail।
- **সুপারিশ:** Pathao-র মতো record-only path — `order.courierStatus` + timeline, workflow অপরিবর্তিত।

#### R-4 · নিম্ন · Exchange/partial-return delivery type আলাদা করা হয় না

- **ডক:** delivery types: `regular`, `reverse`, `exchange-delivery`, `exchange-return`, `partial-delivery`, `partial-return`।
- **কোড:** শুধু `partial-delivery` special-case; `exchange-delivery`/`exchange-return`/`partial-return`-এ status-ভিত্তিক map-ই চলে, আলাদা handling/link নেই।
- **প্রমাণ:** `courier-webhook.service.ts:1454-1456`; map `:194-218`।
- **Impact:** exchange order ও original order-এর সম্পর্ক (শিটের exchange-flow rule) RedX-এ যাচাই করা যায় না; future-এ ভুল order-advance হতে পারে।
- **সুপারিশ:** owner decision — RedX exchange flow দরকার হলে delivery_type ধরে আলাদা link/guard।

### ৫.৪ নতুন capability (ডকে আছে, কোডে নেই)

| # | ডক capability | কোডে অবস্থা | নোট |
|---|---|---|---|
| R-N1 | Pickup Store: `POST /pickup-store`, `GET /pickup-store`, `GET /pickup-store/{id}` | নেই — শুধু optional `pickup_store_id` config | store management admin-এ লাগতে পারে |
| R-N2 | Area lookup: `GET /areas`, by postal code, by district name | নেই — RedX-এর জন্য area API নেই | R-1-এর মূল কারণ; admin-এ area picker দরকার |
| R-N3 | `PATCH /parcels` দিয়ে `delivery_address` update | নেই — শুধু status cancel | address correction capability |
| R-N4 | Reverse/exchange booking (`delivery_type` = `reverse`, `exchange-return`, `partial-return`) | নেই — শুধু forward | returns module-এর সাথে সমন্বয় দরকার |

### ৫.৫ RedX ভার্ডিক্ট

**মিল, তবে dispatch-safety গ্যাপ।** create/track/charge/cancel/webhook/paid — সবই ডকের সাথে মেলে। কিন্তু **area 1 fallback** ও **hard-coded 500g** বাস্তব অপারেশনাল ঝুঁকি; `agent-area-change` record না করা audit-gap। লাইভ ডক পাওয়া গেছে বলে RedX-এর তথ্য সবচেয়ে নির্ভরযোগ্য।

---

## ৬. Carrybee

### ৬.১ ডক-সোর্স ও ফ্রেশনেস

**যে URL-গুলো চেষ্টা করা হয়েছে (২০২৬-১০-২৩):**

| URL | ফলাফল |
|---|---|
| `https://developers.carrybee.com` | HTTP 400, ১২ বাইট (API host; browser GET ব্লক) |
| `https://developers.carrybee.com/api/v2/cities` | HTTP 200 JSON — unauthenticated reachability probe (API host, ডক নয়) |
| `https://carrybee.com/developer-api` | HTTP 404 |
| `https://carrybee.com/api-docs` | HTTP 404 |
| `https://carrybee.com/developers` | HTTP 404 |
| `https://docs.carrybee.com` | DNS/connection failure |
| `https://developer.carrybee.com` | DNS/connection failure |
| `https://merchant.carrybee.com/docs` | HTTP 404 |

**স্ট্যাটাস: BLOCKED (কোনো পাবলিক ডক URL পাওয়া যায়নি)।**
**ব্যবহৃত সোর্স:** `CarryBee API Docs.md` (মtime ২০২৬-১০-১১) + `Carrybee Webhooks Docs.md` (মtime ২০২৬-১০-১১) — লেভেল **B**।
**ফ্রেশনেস নোট:** **উচ্চ** — v2 API, field limits, webhook events (২৫টি), reverse pickup/exchange — সব ২০২৬-১০ কপিতে। তবে **দুটি ডক নিজেদের মধ্যে signature header নিয়ে দ্বিমত পোষণ করে** (C-2) — এটাই প্রধান সোর্স-সমস্যা।

### ৬.২ মিল (ডক ↔ কোড)

| # | ডক যা বলে | কোড | প্রমাণ |
|---|---|---|---|
| C-M1 | `POST /api/v2/orders` — `store_id`, `merchant_order_id`, `delivery_type=1`, `product_type=1`, `recipient_*`, `item_weight`, `item_quantity`, `collectable_amount`, city/zone/area | হুবহু payload | `courier-manager.service.ts:1925-1964` |
| C-M2 | Limits: name 2–99, address 10–200, weight 1–25,000g, qty 1–200, collectable 0–100,000 | name/address/qty/collectable → shaped error (silent clamp নয়); weight derive + clamp | `courier-manager.service.ts:1868-1917`; `:2162-2195` |
| C-M3 | `GET /api/v2/orders/{id}/details` | `transfer_status` + reason/remarks/attempt | `courier-tracking.service.ts:642-690`; `courier-manager.service.ts:2220-2221` |
| C-M4 | `POST /api/v2/orders/{id}/cancel` + `cancellation_reason` (<200) → 202 | একই | `courier-manager.service.ts:2237-2263`; DTO `cancel-carrybee-order.dto.ts` |
| C-M5 | Webhook events ২৫টি (`order.created` … `order.returned-to-merchant`) | ২৫টিই ম্যাপে | `courier-webhook.service.ts:143-174` |
| C-M6 | `order.create-failed` — consignment নেই; শুধু optimistic record থাকলে CANCELLED | create-failed branch; dispatch তৈরি করে না, থাকলে CANCELLED | `courier-webhook.service.ts:1583-1589,1688-1745` |
| C-M7 | `order.delivery-failed` — status change নয় | record-only path (attempt/reason/remarks) | `courier-webhook.service.ts:1619-1621,1755-1790` |
| C-M8 | `order.paid` = delivery + money identifiers | DELIVERED + invoice/payment_status timeline | `courier-webhook.service.ts:1645-1656` |
| C-M9 | Webhook: 202 + `X-CB-Webhook-Integration-Header` echo | auth pass হলে 202 + echo | `courier-webhook.controller.ts:636-642` |
| C-M10 | দুই ডকে দুই header নাম: `X-CB-Webhook-Integration-Header` (API doc) ও `X-Carrybee-Webhook-Signature` (webhooks doc) | দুটোই গ্রহণ; দুটোই এলে দুটোই match করতে হবে | `courier-webhook.controller.ts:209-239` |

### ৬.৩ অমিল (ডক/শিট ↔ কোড)

#### C-1 · উচ্চ · `order.returned-to-merchant` → dispatch `RETURNED` (শিটের TARGET `RETURN_PENDING`)

- **ডক:** `order.returned-to-merchant` = parcel merchant-এর কাছে ফিরেছে।
- **শিট TARGET:** `RETURN_PENDING` (owner ২০২৬-১০-১৫; `03-Rules.tsv` rule 25, `01-Mapping.tsv` row 91) — courier back-signal কখনো `RETURNED` নয়; staff receive-এ `RETURNED`।
- **কোড:** `'order.returned-to-merchant': 'RETURNED'` — webhook ও tracking mapper দুটোতেই।
- **প্রমাণ:** `courier-webhook.service.ts:173`; `courier-status-mapper.ts:208`।
- **Impact:** Pathao-র মতোই — dispatch-level state staff-confirmation-কে আগেই ধরে নিচ্ছে। Order status `Return Pending` থাকায় UI-তে ধরা পড়বে না।
- **সুপারিশ:** `RETURN_PENDING`-এ clamp; staff receive আলাদা।

#### C-2 · মাঝারি · Signature header নিয়ে ডকের নিজেদের দ্বন্দ্ব

- **ডক A (API):** “Carrybee includes a secret in the **`X-CB-Webhook-Integration-Header`** header so you can verify requests… Echo back the `X-CB-Webhook-Integration-Header` with the exact secret value.”
- **ডক B (Webhooks):** “Every webhook request… includes the **`X-Carrybee-Webhook-Signature`** header carrying your webhook signature.”
- **কোড:** দুটো header-ই candidate; একটাও না থাকলে MISSING; দুটো থাকলে **দুটোই** stored secret-এর সাথে match হতে হবে।
- **প্রমাণ:** `courier-webhook.controller.ts:209-239`।
- **Impact:** যদি Carrybee দুটো header-এ **দুটো ভিন্ন মান** পাঠায় (integration secret বনাম signature), কোড সব request reject করবে (401)। আবার একটি header পাঠালে কাজ করবে — কিন্তু কোনটি পাঠাবে তা ডক থেকে নিশ্চিত নয়।
- **সুপারিশ:** owner decision — (ক) যেকোনো একটি header match হলেই accept (OR), অথবা (খ) দুটোর জন্য আলাদা secret সংরক্ষণ; live integration test-এ যাচাই।

#### C-3 · মাঝারি · Integration probe body `{content: …}` হলে 400

- **ডক:** integration verification example-এ `X-Carrybee-Webhook-Signature` header + body `{"content": "your webhook event data"}`; API doc বলে integration event-এ **202** ফেরত দিতে হবে এবং header echo করতে হবে।
- **কোড:** `handleCarrybee` শুধু `event === 'webhook_integration'` হলে short-circuit; নাহলে `consignment_id` না থাকায় `BadRequestException` → 400।
- **প্রমাণ:** `courier-webhook.service.ts:1575-1595`; controller-এ header/202 সেট হয় আগে (`:636-642`), কিন্তু exception filter 400-ই দেবে।
- **Impact:** Carrybee-র “Test” বাটন যদি `{content}` পাঠায়, integration verification fail দেখাবে (202-এর বদলে 400) — যদিও header ঠিক।
- **সুপারিশ:** integration header থাকলে এবং `consignment_id`/`event` না থাকলে 202 + echo দিয়ে return; live test-এ নিশ্চিত করা।

#### C-4 · নিম্ন-মাঝারি · `transfer_status`-এর unlisted value keyword-fallback-এ status বদলাতে পারে

- **শিট (row 92):** “transfer_status values not enumerated in docs — unlisted value → loud log + keep previous”।
- **কোড:** details-এর raw `transfer_status` → `mapCourierStatusToDispatchStatus`; exact map না মিললে keyword fallback (`/deliver/`, `/return/`, `/cancel/`, `/hold/`, `/transit|hub|warehouse/`, …) status বদলাতে পারে।
- **প্রমাণ:** `courier-status-mapper.ts:237-278`; `courier-tracking.service.ts:667-690`।
- **Impact:** ডকে না-থাকা কোনো label (যেমন “delivery on hold”) ভিন্ন status-এ map হতে পারে — শিটের “keep previous” নিয়মের বিপরীত।
- **সুপারিশ:** Carrybee details-এর জন্য exact-map only; unknown → warn + keep previous।

#### C-5 · তথ্য · `order.create-failed` আচরণ শিটের সাথে মিলে

- **শিট:** “consignment never created; don’t create a dispatch; optimistic record থাকলে CANCELLED; position + causes record”।
- **কোড:** হুবহু — dispatch তৈরি করে না, থাকলে CANCELLED, timeline-এ reason/causes। প্রমাণ: `courier-webhook.service.ts:1688-1745`।
- **সিদ্ধান্ত:** কোনো পরিবর্তন দরকার নেই; ইতিবাচক মিল হিসেবে রাখা হলো।

### ৬.৪ নতুন capability (ডকে আছে, কোডে নেই)

| # | ডক capability | কোডে অবস্থা | নোট |
|---|---|---|---|
| C-N1 | Reverse pickup: `POST /api/v2/orders/reverse-pickup` | নেই | return pickup flow |
| C-N2 | Reverse pickup (single): `POST /api/v2/orders/{id}/reverse-pickup` — delivered/partially delivered হতে হবে | নেই | return pickup per order |
| C-N3 | Exchange: `POST /api/v2/orders/{id}/exchange` — `EX-` prefixed consignment | নেই | exchange flow |
| C-N4 | Bulk: `POST /api/v2/orders-bulk` | নেই — শুধু single dispatch | bulk booking parity |
| C-N5 | `GET /api/v2/cities/{city}/zones/{zone}/areas`, `/area-suggestion`, `/address-details` | নেই — শুধু cities/zones | area_id manual input; address validation নেই |

### ৬.৫ Carrybee ভার্ডিক্ট

**প্রায়-মিল, ২টি ডক-দ্বন্দ্ব।** v2 create/details/cancel/webhook/create-failed/paid — সবই ডকের সাথে মেলে; field limits ও 202/echo ভালোভাবে 구현되어 있다। মূল সমস্যা **C-1** (returned-to-merchant owner-rule), **C-2** (header দ্বন্দ্ব), **C-3** (integration probe)। নতুন capability-র মধ্যে reverse pickup/exchange সবচেয়ে বড় ফিচার-গ্যাপ।

---

## ৭. ক্রস-কুরিয়ার প্যাটার্ন ও শিট-ক্রসচেক

### ৭.১ `returned-to-merchant` / courier “parcel back” → dispatch status

| কুরিয়ার | ডক ইভেন্ট | শিট TARGET | কোড | রেফ |
|---|---|---|---|---|
| Pathao | `order.returned-to-merchant` | `RETURN_PENDING` | **`RETURNED`** | `courier-webhook.service.ts:120`; `courier-status-mapper.ts:114` |
| Carrybee | `order.returned-to-merchant` | `RETURN_PENDING` | **`RETURNED`** | `courier-webhook.service.ts:173`; `courier-status-mapper.ts:208` |
| Steadfast | `cancelled_return_received` (return endpoint) | `RETURN_PENDING` | **`RETURNED`** | `courier-status-mapper.ts:315`; `courier-webhook.service.ts:793` |
| RedX | `returned` | `RETURN_PENDING` | `RETURN_PENDING` ✅ | `courier-webhook.service.ts:211`; `courier-status-mapper.ts:178` |

**ব্যাখ্যা:** তিনটি কুরিয়ারে dispatch `RETURNED` হয়ে যায়, যদিও order status `Return Pending`-ই থাকে। শিটের owner rule 25 (২০২৬-১০-১৫, `03-Rules.tsv`) অনুযায়ী `RETURNED` শুধু staff-confirmed receive-এর জন্য সংরক্ষিত। এটি **cross-courier consistency bug** — একটি ফিক্স তিন জায়গায় দরকার (webhook map + tracking map + Steadfast return map), সাথে টেস্ট আপডেট (`courier-status-mapper.spec.ts:9,42,164,210` এবং `courier-return-task6.spec.ts:55-69` বর্তমানে `RETURNED` pin করে আছে)।

### ৭.২ “Unknown / exceptional” discipline

| কুরিয়ার | আচরণ | কোড | শিট মিল? |
|---|---|---|---|
| Steadfast `unknown` | raw + timeline + loud alert, workflow অপরিবর্তিত | `courier-webhook.service.ts:330-335,449-500` | ✅ |
| Steadfast `exceptional` | raw + alert, workflow অপরিবর্তিত | `:337-347,397-448` | ✅ |
| Pathao unknown event | raw courierStatus + timeline, workflow অপরিবর্তিত | `:1247-1291` | ✅ |
| Carrybee unknown event | log + success, **raw/timeline নেই** | `:1623-1626` | ⚠️ (শিটে explicit নেই) |
| RedX unknown/`agent-area-change` | log + success, **raw/timeline নেই** | `:1467-1470` | ❌ (শিট বলে record) |

**সুপারিশ:** RedX ও Carrybee-তেও Pathao-র “record-only skip” প্যাটার্ন প্রয়োগ করা — unknown status কখনো হারাবে না।

### ৭.৩ “Paid” semantics

| কুরিয়ার | ডক | কোড | শিট |
|---|---|---|---|
| Pathao | `order.paid` = payment invoice | DELIVERED + invoice_id | ✅ |
| Carrybee | `order.paid` = paid | DELIVERED + invoice_id/payment_status | ✅ |
| RedX | `paid` = parcel amount paid | DELIVERED + invoice/amount | ✅ |
| Steadfast | per-parcel paid event **নেই**; delivered + cod_amount-ই payment confirmation | delivered → DELIVERED; `payment_request` record-only | ✅ |

**নোট:** Steadfast-এ staff যদি “paid event”-এর অপেক্ষা করে, ভুল হবে — শিট ইতিমধ্যে এটা বলেছে; UI/help-এ আরও স্পষ্ট করা যায়।

### ৭.৪ Parcel weight handling

| কুরিয়ার | ডকের requirement | কোড | অবস্থা |
|---|---|---|---|
| Pathao | `item_weight` ০.৫–১০ কেজি, required | literal `0.5` | ❌ P-6 |
| RedX | `parcel_weight` required (unit ডকে অসঙ্গত) | literal `String(500)` | ❌ R-2 |
| Carrybee | `item_weight` integer ১–২৫,০০০ গ্রাম | `resolveCarrybeeWeightGrams(order)` + clamp | ✅ |
| Steadfast | ডকে weight field নেই | পাঠায় না | ✅ (প্রযোজ্য নয়) |

**প্যাটার্ন:** যেখানে কুরিয়ার weight-ভিত্তিক charge করে, সেখানে hard-coded default (Pathao/RedX) settlement-এ mismatch তৈরি করে; Carrybee-র derive+clamp প্যাটার্নটাই বাকি দুটোতে প্রয়োগ করা উচিত।

---

## ৮. OWNER DECISION তালিকা (অগ্রাধিকারসহ)

> নিচের কোনোটিই এই রিপোর্টে বাস্তবায়ন করা হয়নি। প্রতিটিতে সুপারিশ দেওয়া আছে; owner অনুমোদন দিলে আলাদা Part/PR-এ করতে হবে।

### P0 — অপারেশনাল/আর্থিক ঝুঁকি, দ্রুত সিদ্ধান্ত দরকার

**OD-1 · Courier “parcel back” signal-এ dispatch `RETURNED` বন্ধ করা**
- বর্তমান: Pathao/Carrybee `returned-to-merchant` → `RETURNED`; Steadfast `cancelled_return_received` → `RETURNED`।
- শিট TARGET: `RETURN_PENDING` (`03-Rules.tsv` rule 25; `01-Mapping.tsv` rows 23, 44, 91); `RETURNED` শুধু staff-confirmed receive।
- রেফ: `courier-webhook.service.ts:120,173,793`; `courier-status-mapper.ts:114,208,315`।
- সুপারিশ: তিন জায়গায় `RETURN_PENDING`-এ clamp; staff receive-এ `RETURNED`; `courier-status-mapper.spec.ts:9,42,164,210` + `courier-return-task6.spec.ts:55-69` আপডেট।
- **শিট-নোট (রিপোর্ট-ওনলি):** `01-Mapping.tsv` row 63-এর note-এ ২০২৬-১০-১৪-এর পুরোনো বাক্য “RETURNED the correct reading” এখনো আছে, অথচ একই row-এর TARGET column ও rule 25 (২০২৬-১০-১৫) `RETURN_PENDING` বলে — owner note-টি ঠিক করার অনুরোধ।

**OD-2 · RedX `delivery_area_id` fallback 1 সরানো**
- বর্তমান: missing হলে area 1।
- রেফ: `courier-manager.service.ts:1597,1641`।
- সুপারিশ: missing/invalid → shaped 400; কোনো silent fallback নয়।

**OD-3 · RedX `parcel_weight` hard-coded 500g সরানো**
- রেফ: `courier-manager.service.ts:1647`।
- সুপারিশ: order/product weight থেকে derive; না থাকলে explicit weight চাওয়া বা documented default + warning।

### P1 — ডক-অমিল, উচ্চ ব্যবসায়িক প্রভাব

**OD-4 · Pathao field limits — `recipient_address` 220 ও `item_weight` hard-code**
- রেফ: `courier-manager.service.ts:951-954,958`; `courier-settle-guard.ts:22-28`।
- সুপারিশ: per-courier limit (Pathao 220); `item_weight` order/product weight থেকে derive (Carrybee-র `resolveCarrybeeWeightGrams` প্যাটার্ন), না থাকলে explicit weight বা documented default + warning।

**OD-5 · Steadfast bulk: extended endpoint + per-order optional fields**
- রেফ: `courier-manager.service.ts:2584-2600,2638`।
- সুপারিশ: `/create_order/bulk-order/extended`; `recipient_email`, `alternative_phone`, `item_description`, `total_lot` per order।

**OD-6 · Pathao echo header সবসময় fixed integration constant**
- রেফ: `courier-webhook.controller.ts:548-555`।
- সুপারিশ: `pathaoIntegrationSecret` override সরানো/validate; fixed constant echo।

**OD-7 · Carrybee signature header নীতি চূড়ান্ত করা**
- রেফ: `courier-webhook.controller.ts:215-239`।
- সুপারিশ: either-header (OR) accept অথবা দুটো আলাদা secret; live test দিয়ে যাচাই।

**OD-8 · Steadfast fraud-score adapter (`/fraud_check/score/{phone}`)**
- রেফ: নতুন; বর্তমানে কিছু নেই।
- সুপারিশ: read-only adapter + admin/COD-risk surface; `score`/`level` null, ratio/volume band ব্যবহার; পুরোনো `/fraud_check/{phone}` ২০২৬-০৯-২৭-এ sunset — সেটি ব্যবহার করা যাবে না।

### P2 — Consistency/robustness

**OD-9 · RedX skip status record-only করা**
- রেফ: `courier-webhook.service.ts:1467-1470`।
- সুপারিশ: Pathao-র মতো raw + timeline; `agent-area-change` অন্তর্ভুক্ত।

**OD-10 · Carrybee unknown event record-only করা**
- রেফ: `courier-webhook.service.ts:1623-1626`।
- সুপারিশ: raw + timeline; workflow অপরিবর্তিত।

**OD-11 · Steadfast tracking message map-এ current vocabulary**
- রেফ: `courier-tracking.service.ts:407-417,458-473`।
- সুপারিশ: `in_review`, `*_approval_pending`, `exceptional`, `unknown` human message।

**OD-12 · Carrybee `transfer_status` unlisted value-এ keyword fallback বন্ধ**
- রেফ: `courier-status-mapper.ts:237-278`; শিট row 92।
- সুপারিশ: exact-map only; unknown → warn + keep previous।

**OD-13 · Carrybee integration probe 202 নিশ্চিত করা**
- রেফ: `courier-webhook.service.ts:1575-1595`; `courier-webhook.controller.ts:636-642`।
- সুপারিশ: integration header থাকলে body-তে consignment না থাকলেও 202 + echo; live test।

**OD-14 · Pathao cancel endpoint-এর contract নিশ্চিত করা**
- রেফ: `courier-manager.service.ts:1526-1580`।
- সুপারিশ: contract test + feature flag; Pathao account manager-এর সাথে endpoint confirm।

### P3 — নতুন capability ব্যাকলগ (ব্যবসায়িক অগ্রাধিকার অনুযায়ী)

**OD-15 · Pathao:** stores create/list, `merchant/price-plan`, `zones/{id}/area-list`; `order.accepted` / `Payment Invoice` event নাম যাচাই।

**OD-16 · Steadfast:** `/ping`, `status_by_invoice`, `status_by_trackingcode`, `trackings_by_invoice`, `create_pickup_request`, bulk-extended; client-side rate limiter (1,000/min; booking 6,000/min; 401 lockout 10/5min → 429 60min)।

**OD-17 · RedX:** pickup-store create/list/details, area lookup (district/postal), `PATCH` delivery-address update, reverse/exchange delivery types.

**OD-18 · Carrybee:** reverse pickup (bulk + single), exchange, `orders-bulk`, areas/area-suggestion/address-details.

**OD-19 · Steadfast webhook `*return*` label-এ warn/alert:** বর্তমানে নীরবে skip; ভবিষ্যৎ vocabulary change ধরার জন্য warn + timeline alert।

---

## ৯. BLOCKED

| # | আইটেম | কারণ | চেষ্টা করা URL |
|---|---|---|---|
| B-1 | Pathao অফিসিয়াল ডক | লগইন-গেটেড SPA; পাবলিক টেক্সট নেই | `https://merchant.pathao.com/docs`, `/docs/api`, `/api-docs`; `https://api-hermes.pathao.com/docs` (404); `https://courier-api-sandbox.pathao.com/docs` (000) |
| B-2 | Steadfast অফিসিয়াল ডক | portal block page / 404; docs subdomain নেই | `https://portal.packzy.com/`, `/api/v1`, `/api/v1/docs`, `/docs`; `https://packzy.com/api/v1`, `/docs`; `https://steadfast.com.bd/api-docs`; `https://docs.steadfast.com.bd`; `https://developer.steadfast.com.bd` |
| B-3 | Carrybee অফিসিয়াল ডক | কোনো পাবলিক ডক URL নেই; `developers.carrybee.com` শুধু API host | `https://developers.carrybee.com` (400), `/api/v2/cities` (200 JSON); `https://carrybee.com/developer-api`, `/api-docs`, `/developers` (404); `https://docs.carrybee.com` (DNS fail); `https://developer.carrybee.com` (DNS fail); `https://merchant.carrybee.com/docs` (404) |
| B-4 | লাইভ কুরিয়ার আচরণ যাচাই | Hard rule: credentialed API কল নয় (শুধু unauthenticated reachability probe); credential ছাড়া header/retry আচরণ প্রমাণ করা যায় না | — |
| B-5 | Steadfast রিব্র্যান্ডিং-এর বাইরের প্রমাণ | ডকে শুধু “SteadFast Courier”; কোনো পাবলিক রিনেম ঘোষণা পাওয়া যায়নি | — |
| B-6 | Pathao নতুন event (`order.accepted`, `Payment Invoice`) | অফিসিয়াল ডক ব্লকড; শুধু কমিউনিটি SDK (লেভেল C) | — |

---

## ১০. অ্যাপেন্ডিক্স — প্রমাণ-ফাইল ও দায়িত্ব

### ১০.১ কোড-ফাইল

| ফাইল | ভূমিকা |
|---|---|
| `apps/backend/src/courier-manager/courier-manager.service.ts` | BASE_URLS, dispatch payload, cancel/track/charge, returns/payments/balance, bulk |
| `apps/backend/src/courier-manager/courier-webhook.service.ts` | webhook status maps, handlers, order advancement, return reconcile |
| `apps/backend/src/courier-manager/courier-webhook.controller.ts` | signature verification, idempotency, echo headers, HTTP codes |
| `apps/backend/src/courier-manager/courier-tracking.service.ts` | poll/sync fallback, per-courier status fetch |
| `apps/backend/src/courier-manager/courier-status-mapper.ts` | tracking status → DispatchStatus, Steadfast return map |
| `apps/backend/src/courier-manager/courier-settle-guard.ts` | field limits + unsettled status guard |
| `apps/backend/src/courier-manager/courier-manager.controller.ts` | route surface (dispatch/cancel/return/webhook diagnostics) |
| `apps/backend/src/courier-manager/courier-token.service.ts` | Pathao token cache/refresh |

### ১০.২ ডক-ফাইল

| ফাইল | মtime | লেভেল |
|---|---|---|
| `/Volumes/Netac SSD 512GB/dev/Courier Documentations TXT/Pathao Courier API Documenttation.md` | ২০২৬-০৯-১০ | B |
| `/Volumes/Netac SSD 512GB/dev/Courier Documentations TXT/Webhook Documentation Pathao.md` | ২০২৬-০৯-১০ | B |
| `/Volumes/Netac SSD 512GB/dev/Courier Documentations TXT/Steadfast API Docs.md` | ২০২৬-১০-১১ | B |
| `/Volumes/Netac SSD 512GB/dev/Courier Documentations TXT/SteadFast Webhooks Docs.md` | ২০২৬-১০-১১ | B |
| `/Volumes/Netac SSD 512GB/dev/Courier Documentations TXT/REDx API and Webhook Documentation.md` | ২০২৬-০৯-১০ | B (লাইভ A-এর সাথে মিলে) |
| `/Volumes/Netac SSD 512GB/dev/Courier Documentations TXT/CarryBee API Docs.md` | ২০২৬-১০-১১ | B |
| `/Volumes/Netac SSD 512GB/dev/Courier Documentations TXT/Carrybee Webhooks Docs.md` | ২০২৬-১০-১১ | B |

### ১০.৩ শিট-রেফারেন্স

- `01-Mapping.tsv` — Pathao rows 1–26, Steadfast 27–57, RedX 58–66, Carrybee 67–92।
- `03-Rules.tsv` — ২৮টি owner rule; বিশেষত approval_pending never settles, courier “received” max RETURN_PENDING, conditional cancel, multi-merchant Steadfast।

---

**শেষ কথা:** এই রিপোর্টে কোনো কোড/শিট পরিবর্তন নেই। P0 তিনটি (OD-1…OD-3) owner অনুমোদন পেলে আলাদা implementation Part-এ যাওয়া উচিত; P1-এর মধ্যে Steadfast fraud-score (OD-8) সর্বোচ্চ ব্যবসায়িক সুযোগ। তার আগে বর্তমান আচরণই উৎপাদনে আছে।
