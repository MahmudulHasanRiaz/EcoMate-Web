<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.


# NEXT.JS STOREFRONT RENDERING STRATEGY

The storefront architecture MUST follow modern Next.js rendering principles deeply and correctly.

The engineering team and AI agents MUST thoroughly understand:

* Static Generation (SSG)
* Incremental Static Regeneration (ISR)
* Partial prerendering concepts
* React Server Components
* Streaming
* Suspense boundaries
* Cache strategies
* Revalidation strategies
* Dynamic rendering boundaries

Reference:
https://nextjs.org/docs/pages/building-your-application/rendering/static-site-generation

IMPORTANT:

The storefront is expected to handle:

* heavy ad traffic
* SEO-sensitive landing pages
* high concurrent product views
* low-latency browsing
* high mobile traffic

Therefore rendering strategy is CRITICAL infrastructure.

---

# STOREFRONT PERFORMANCE PHILOSOPHY

The storefront MUST prefer:

1. Static rendering
2. Edge caching
3. Server Components
4. Streaming architecture
5. Minimal client JavaScript

The storefront MUST avoid:

* unnecessary client-side rendering
* excessive hydration
* large JS bundles
* runtime-heavy pages
* blocking data fetching
* excessive browser computation

Client Components MUST be minimized aggressively.

---

# RENDERING PRIORITY RULES

## STATIC FIRST STRATEGY

Prefer static rendering whenever possible.

Ideal SSG/ISR pages:

* Homepage
* Category pages
* Product pages
* Brand pages
* Marketing pages
* Campaign landing pages
* Blog pages
* SEO pages

Reason:

* Better SEO
* Faster TTFB
* Better Core Web Vitals
* Better scalability
* Lower server cost
* Better ad conversion performance

---

# ISR STRATEGY

Incremental Static Regeneration SHOULD be heavily utilized.

Preferred examples:

* Product pages
* Category pages
* Campaign pages

Revalidation SHOULD be event-driven when possible.

Examples:

* product update
* inventory update
* pricing update
* campaign changes

DO NOT rebuild entire storefront unnecessarily.

---

# SERVER COMPONENT STRATEGY

React Server Components MUST be the default approach.

Use Client Components ONLY when necessary.

Examples requiring Client Components:

* cart interactions
* live filters
* client state
* browser APIs
* animations
* interactive widgets

Everything else SHOULD remain Server Components.

Reason:

* smaller JS bundles
* faster rendering
* lower hydration cost
* better mobile performance

---

# DATA FETCHING RULES

Storefront data fetching MUST:

* prefer server-side fetching
* use caching intentionally
* use tagged revalidation
* avoid duplicate fetching
* avoid waterfall requests

DO NOT:

* fetch critical page data client-side unnecessarily
* use useEffect for primary page data
* overuse React Query in storefront rendering layer

React Query is acceptable mainly for:

* client interactivity
* live UI state
* non-critical dynamic updates

---

# CACHE STRATEGY RULES

Caching MUST be intentional.

Use:

* CDN cache
* fetch cache
* route cache
* image cache
* edge cache

The storefront MUST support:

* stale-while-revalidate behavior
* granular cache invalidation
* event-driven revalidation

---

# DYNAMIC RENDERING RULES

Dynamic rendering MUST be minimized.

ONLY use dynamic rendering for:

* authenticated pages
* user dashboards
* checkout flows
* highly personalized content
* live session-dependent data

DO NOT dynamically render:

* public catalog pages
* SEO pages
* product detail pages unnecessarily

---

# CHECKOUT ARCHITECTURE RULES

Checkout MUST remain highly optimized.

Checkout SHOULD:

* minimize third-party scripts
* minimize blocking requests
* avoid unnecessary rerenders
* isolate dynamic logic carefully

Critical checkout data MUST:

* remain server validated
* never trust client state fully

---

# THIRD-PARTY SCRIPT RULES

Third-party scripts MUST be controlled carefully.

Examples:

* Meta Pixel
* TikTok Pixel
* GTM
* Analytics scripts
* Chat widgets

Scripts MUST:

* load lazily where possible
* avoid blocking rendering
* avoid destroying Core Web Vitals

Marketing scripts MUST NOT compromise storefront speed.

---

# SEO RULES

The storefront MUST:

* generate metadata server-side
* support OpenGraph
* support Twitter cards
* support structured data
* support canonical URLs
* support sitemap generation
* support robots configuration

Product pages SHOULD include:

* Product schema
* Review schema
* Breadcrumb schema

---

# CORE WEB VITALS TARGETS

The storefront MUST aggressively optimize:

* LCP
* CLS
* INP
* TTFB

Target philosophy:

* Mobile-first optimization
* Slow-network optimization
* Low-end Android optimization

---

# STORE ARCHITECTURE RULES

The storefront MUST behave like:

* a CDN-first application
* a cache-first application
* an edge-optimized application

NOT:

* a traditional SSR-heavy monolith

---

# AI AGENT STOREFRONT RULES

AI agents MUST:

* analyze rendering impact before implementation
* analyze hydration cost
* analyze bundle size impact
* analyze caching behavior
* analyze SEO implications

Before creating ANY storefront feature:

1. Determine if it can remain static
2. Determine if it can remain a Server Component
3. Determine cache strategy
4. Determine revalidation strategy
5. Determine SEO implications
6. Determine mobile performance impact

If uncertain:

* prefer static generation
* prefer Server Components
* prefer caching
* prefer edge delivery
* prefer less JavaScript

END NEXT.JS STOREFRONT STRATEGY
<!-- END:nextjs-agent-rules -->
