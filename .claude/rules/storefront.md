---
paths:
  - "apps/storefront/**/*.{ts,tsx,js,jsx}"
---

# Storefront Rules

- Treat React Server Components as the default. Add `use client` only for browser APIs or real interactivity.
- Prefer static rendering and ISR for public catalog, product, category, brand, campaign, marketing, and SEO pages.
- Keep authenticated, checkout, session-dependent, and highly personalized routes dynamic only where needed.
- Make caching explicit. Preserve tagged/event-driven revalidation for product, price, inventory, category, and campaign changes.
- Avoid critical client-side data waterfalls, unnecessary hydration, duplicate requests, and large client bundles.
- Server-validate price, discount, stock, shipping, identity, and payment data. Never trust checkout totals supplied by the browser.
- Preserve metadata, canonical URLs, structured data, image optimization, accessibility, and Core Web Vitals.
- Read relevant Next.js 16 documentation from `node_modules/next/dist/docs/` before changing rendering, caching, routing, or request APIs.
- Add or update targeted tests and run `npm run build --workspace=storefront` before completion.
