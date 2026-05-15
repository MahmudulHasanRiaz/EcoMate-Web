Storefront MUST:
- Optimize Core Web Vitals
- Optimize LCP
- Optimize CLS
- Optimize TTFB

---

# TESTING RULES

MANDATORY TEST TYPES:

Backend:
- Unit tests
- Integration tests
- E2E tests

Frontend:
- Component tests
- E2E flows

Critical flows MUST be tested:
- Checkout
- Payment
- Inventory updates
- Order lifecycle
- Authentication
- RBAC
- Refunds

---

# DEVOPS & DEPLOYMENT RULES

Primary deployment:
- VPS + Docker

Architecture MUST ALSO remain deployable to:
- Vercel (storefront)
- Vercel or Cloudflare Pages (admin)

System MUST:
- Work in unified VPS deployment
- Work in separated deployments
- Use environment-based configuration

MANDATORY:
- Dockerized services
- Health checks
- Graceful shutdown
- Reverse proxy support
- Zero-downtime deployment readiness

Preferred:
- Traefik or Nginx
- GitHub Actions CI/CD

---

# MONOREPO RULES

Monorepo MUST:
- Share types safely
- Share validation schemas carefully
- Avoid circular dependencies
- Maintain strict boundaries

Preferred structure:
- packages/ui
- packages/types
- packages/config
- packages/utils
- packages/sdk

---

# CODE QUALITY RULES

MANDATORY:
- Strict TypeScript
- ESLint
- Prettier
- Husky
- Lint-staged

NEVER:
- Use any recklessly
- Ignore TypeScript errors
- Disable lint rules without reason

---

# DOCUMENTATION RULES

ALL major systems MUST include:
- Architecture notes
- Flow explanations
- Sequence diagrams where helpful
- Environment documentation
- Failure scenarios
- Recovery procedures

---

# AI AGENT BEHAVIOR RULES

AI agents MUST:

- Think before implementing
- Analyze scalability impact
- Analyze security impact
- Analyze database impact
- Analyze operational impact
- Analyze failure scenarios

Before coding ANY feature:
1. Evaluate architecture impact
2. Evaluate DB impact
3. Evaluate scaling impact
4. Evaluate security impact
5. Evaluate observability impact

AI agents MUST:
- Prefer maintainability over shortcuts
- Prefer explicitness over magic
- Prefer reliability over cleverness
- Prefer modularity over speed of implementation

NEVER:
- Make assumptions silently
- Introduce breaking schema changes casually
- Generate incomplete business logic
- Skip validation
- Skip authorization
- Skip error handling
- Skip logging
- Skip edge cases

---

# PRODUCTION SAFETY RULES

NEVER:
- Run destructive migrations automatically
- Delete production data casually
- Disable security for convenience
- Expose admin APIs publicly
- Store sensitive logs insecurely

MANDATORY:
- Backups
- Rollback strategy
- Migration safety checks
- Queue failure recovery
- Disaster recovery awareness

---

# FINAL QUALITY STANDARD

EcoMate is NOT a demo project.

It MUST behave like:
- Shopify-grade operational software
- Enterprise commerce infrastructure
- High-scale production system

Every implementation decision MUST prioritize:
- Reliability
- Security
- Scalability
- Maintainability
- Performance
- Operational stability

If uncertain:
- Choose the safer architecture
- Choose the more maintainable implementation
- Choose the more observable system
- Choose the more scalable design

END OF PROTOCOL


______________________________________
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
