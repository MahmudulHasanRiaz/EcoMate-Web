# Pre-Formatted Pages Management System

Date: 2026-08-02
Status: Approved (design decisions confirmed with user)

## Problem

The storefront has 13 specially-designed, fixed-layout pages (careers, about,
company, faq, support/contact, stores, delivery-areas, terms-conditions,
privacy-policy, refund-policy, exchange-policy, shipping-policy, download).
Today most of them are hardcoded static content; a few pull from
`SystemSetting` keys edited under Storefront Settings → Content. Admins cannot
edit them, some show wrong/hardcoded contact data, and page config lives in the
general settings section where it doesn't belong.

Goal: manage these pages from the Pages menu like CMS pages — toggle on/off, and
edit only their specific content fields (not a free-form text editor).

## Approach (user-approved)

- **Data model:** extend the existing `CmsPage` model with `type`
  (`'content' | 'template'`), `templateKey String?`, and `config Json?`.
  Reuses existing CRUD, slug handling, admin Pages UI, and storefront fetch.
- **URLs:** keep current storefront URLs (`/careers`, `/about`, …). Static route
  files become thin wrappers that read the matching `CmsPage` config. Toggled
  off → `notFound()`.
- **Scope:** all 13 pages wired in one pass.
- **TRN:** removed the fake hardcoded `TRN: 123456789` from the invoice.

## Data model

```
model CmsPage {
  ...
  type         String?   // 'content' | 'template'  (default 'content')
  templateKey  String?   // e.g. 'careers', 'about' (unique, template pages only)
  config       Json?     // template-specific field values
  @@unique([templateKey])
}
```

Migration via `npx prisma migrate dev --name add_cms_page_template_fields`.

## Template page registry

Each template page is defined by:
- `slug` (URL, e.g. `careers`)
- `title` (default title)
- `templateKey` (stable id)
- `defaultConfig` (mirrors today's hardcoded content so pages look the same)
- `schema` (admin edit form fields)
- `component` (storefront fixed-layout renderer)

Defaults/schemas are defined in three places that must stay in sync:
- Backend `apps/backend/src/cms-pages/template-pages.ts` — slug/title/key/defaultConfig, used by an idempotent `ensureTemplatePages()` backfill so the 13 rows exist in every environment (copies live `SystemSetting` values into config when present).
- Admin `apps/admin/src/features/settings/cms-pages/template-schemas.ts` — field schemas driving a generic settings form (text, textarea, image, number, boolean, array-of-objects, rich-text).
- Storefront `apps/storefront/lib/templates/registry.ts` — `templateKey → { component, defaultConfig }` used by `renderPreFormattedPage(key)`.

## Storefront rendering

`renderPreFormattedPage(templateKey, routeParams)`:
1. `getCmsPageBySlug(slug)` (existing fetch, `revalidate: 300`).
2. If page exists and `isActive === false` → `notFound()`.
3. Merge `page.config` over `defaultConfig` (admin partial edits still render).
4. Render the fixed-layout component with the merged config.

Each static route (`app/(main)/<slug>/page.tsx`) becomes a one-liner calling
`renderPreFormattedPage('<key>')` plus `generateMetadata`.

## Admin UI

Rewrite `CmsPagesSettings`:
- Two groups: **Content Pages** (type=content, existing rich-text editor) and
  **System Pages** (type=template).
- Template pages: active toggle + "Edit Settings" opens a schema-driven form.
  No create/delete for template pages (the 13 are fixed).
- `template-schemas.ts` defines each page's fields. A generic
  `TemplatePageForm` renders text/textarea/image/number/boolean/array inputs
  and saves `config` + `isActive` via the existing `PUT /cms-pages/:id`.
- Remove page-content sections from Storefront Settings (Content category:
  `content-about`, `content-faq`, `content-hours`) and the company/hours/faq
  keys — page config now lives in the Pages menu. Store-wide identity settings
  (`store_phone`, `store_email`, `store_address`, `social_*`) stay in Settings.

## Data migration / backfill

`CmsPagesService.onModuleInit` → `ensureTemplatePages()`:
- For each registry entry, upsert by `slug`: create if missing with
  `type='template'`, `templateKey`, `config = defaultConfig`, `isActive=true`.
- On first creation, copy matching `SystemSetting` values into config when
  present (about_us_text, faq_items, hours_*, company_*, shipping_info,
  payment_info) so live production content isn't lost.

## Testing / verification

- Backend: unit test for `ensureTemplatePages` + `findBySlug` active gating.
- Admin: build + Vitest for the pages settings grouping.
- Storefront: build + route-level test that an inactive template page 404s and
  an active one renders config.
- Run `npm run build` across backend/admin/storefront.

## Pages and their fields

| key | slug | editable fields |
|---|---|---|
| careers | careers | hero {title, subtitle, image}, jobs[] {title, department, location, type, salary, description}, benefits[], application {email, ctaText} |
| about | about | story (text), values[] {title, description}, image |
| company | company | name, registration, certifications, teamSize, ceoName, established, philosophy, vision, impact, image |
| faq | faq | items[] {question, answer} |
| contact | support | phone, email, address, whatsapp, hours[] {days, time} |
| stores | stores | stores[] {name, address, phone, hours, mapLink, comingSoon} |
| delivery-areas | delivery-areas | areas[] {zone, charge, deliveryTime, areas[]}, freeDeliveryMin |
| terms-conditions | terms-conditions | sections[] {heading, body} |
| privacy-policy | privacy-policy | sections[] {heading, body} |
| refund-policy | refund-policy | sections[] {heading, body}, contactEmail |
| exchange-policy | exchange-policy | sections[] {heading, body} |
| shipping-policy | shipping-policy | sections[] {heading, body}, deliveryCharge, freeDeliveryMin |
| download | download | androidUrl, iosUrl, heading, description, image, features[] |
