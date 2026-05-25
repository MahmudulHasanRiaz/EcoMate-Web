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

<!-- ==================== ADDENDUM: CONCRETE PATTERNS ==================== -->

# CONCRETE IMPLEMENTATION PATTERNS

## 1. SERVER COMPONENT DATA FETCHING (CORRECT)

```tsx
// ✅ CORRECT: Server Component — fetch data directly with native fetch
// app/products/page.tsx
import { Suspense } from "react";

// 1. Fetch server-side — no useEffect, no useState
async function getProducts() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/products?isActive=true`, {
    next: { revalidate: 300 },   // ISR: revalidate every 5 minutes
    // or: cache: "force-cache"  // SSG: static generation
    // or: cache: "no-store"     // SSR: always fresh
  });
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

// 2. Page is an async Server Component
export default async function ProductsPage() {
  const products = await getProducts();
  return (
    <div>
      {products.map(p => <ProductItem key={p.id} product={p} />)}
    </div>
  );
}

// 3. Client interactive parts stay only where needed
// "use client" -> ProductItem only if it needs onClick/state/etc.
```

## 2. SERVER-ONLY API CLIENT PATTERN

```ts
// ✅ CORRECT: lib/api-server.ts
// Pure fetch-based, works on both server and client
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";

export async function serverFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    next: { revalidate: 300 },
    ...options,
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// Usage in a Server Component:
// const products = await serverFetch<Product[]>("/products?isActive=true");

// For client-side mutations (cart, auth, etc.), keep using the axios api-client.ts
// For server-side reads (page data, SEO, config), use serverFetch
// This dual-client pattern is intentional and correct.
```

## 3. generateMetadata — SERVER-SIDE SEO (CORRECT)

```tsx
// ✅ CORRECT: app/products/[slug]/page.tsx
import type { Metadata } from "next";

// Fetch product data for metadata (server-only)
async function getProduct(slug: string) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/products?slug=${slug}`);
  const data = await res.json();
  return data.data?.[0] || null;
}

// generateMetadata runs on the server for every request
export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const product = await getProduct(params.slug);
  if (!product) return { title: "Product Not Found" };
  return {
    title: `${product.name} — Fixed Plus`,
    description: product.description?.slice(0, 160),
    openGraph: {
      title: product.name,
      images: product.image ? [{ url: product.image }] : [],
    },
  };
}

// The page component itself
export default async function ProductDetailPage({ params }: { params: { slug: string } }) {
  const product = await getProduct(params.slug);
  if (!product) return <NotFound />;
  return <ProductContent product={product} />; // wraps interactive parts in a client component
}
```

## 4. generateStaticParams — STATIC GENERATION (CORRECT)

```tsx
// ✅ CORRECT: Generate static pages at build time
export async function generateStaticParams() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/products?perPage=100`);
  const { data } = await res.json();
  return data.map((p: any) => ({ slug: p.slug }));
}
// Pages are built once, served from CDN, revalidated on demand
```

## 5. CLIENT/SERVER BOUNDARY SPLITTING PATTERN

```tsx
// ✅ CORRECT: Heavy page = Server Component shell, thin Client Component island

// Parent: Server Component (app/products/[slug]/page.tsx)
export default async function Page({ params }) {
  const product = await getProduct(params.slug);
  return <ProductClient product={product} />;  // thin client wrapper
}

// Child: "use client" ONLY for interactivity (components/ProductClient.tsx)
"use client";
export function ProductClient({ product }) {
  const { addToCart } = useCart();
  return (
    <div>
      <h1>{product.name}</h1>          {/* server-rendered in HTML */}
      <button onClick={() => addToCart(product)}>Add to Cart</button>  {/* interactive */}
    </div>
  );
}
```

## 6. STORE METADATA FOR STATIC PAGES (CORRECT)

```tsx
// ✅ CORRECT: Each static page exports its own metadata
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy — Fixed Plus",
  description: "Read our privacy policy...",
};
// Without "use client" directive — pure Server Component
```

## 7. FAQ WITH HTML DETAILS/SUMMARY (SERVER COMPONENT)

```tsx
// ✅ CORRECT: Use semantic HTML instead of JS accordion
{FAQS.map((faq, i) => (
  <details key={i} className="bg-white border rounded-xl">
    <summary className="font-bold p-5 cursor-pointer">{faq.question}</summary>
    <div className="px-5 pb-5 text-gray-600">{faq.answer}</div>
  </details>
))}
// Zero JavaScript required. Works with JS disabled. SEO-friendly.
```

## 8. IMAGE ERROR HANDLING WITHOUT STATE (SERVER COMPONENT SAFE)

```tsx
// ✅ CORRECT: No useState needed for image fallback
<img
  src={url}
  alt=""
  onError={(e) => { e.currentTarget.src = fallback; }}
/>
// The onError attribute is a native DOM event, not React state — works in Server Components
```

## 9. SPLIT ProductSection PATTERN (CORRECT)

```tsx
// ✅ CORRECT: Server-renderable section with optional animation wrapper

// ProductSection.tsx — Server Component (no "use client")
export default function ProductSection({ title, products }) {
  return (
    <section>
      <h3>{title}</h3>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {products.map(p => <ProductCard key={p.id} product={p} />)}
      </div>
    </section>
  );
}

// AnimatedWrapper.tsx — "use client" thin wrapper for motion
"use client";
import { motion } from "motion/react";
export function AnimatedWrapper({ children }) {
  return (
    <motion.div initial={{ opacity: 0, y: 15 }} whileInView={{ opacity: 1, y: 0 }}>
      {children}
    </motion.div>
  );
}

// Usage stays on server:
// <ProductCard><AnimatedWrapper>... but actually ProductCard is already "use client"
// Better: keep grid layout in server component, wrap each item individually:
// {products.map(p => <AnimatedWrapper key={p.id}><ProductCard product={p} /></AnimatedWrapper>)}
```

---

# ANTI-PATTERN CHECKLIST ❌

| # | Anti-Pattern | Why It's Wrong | Correct Alternative |
|---|--------------|----------------|-------------------|
| 1 | Adding `"use client"` to pages with only static content | Unnecessary JS bundle, blocks SSG, hydration overhead | Remove `"use client"`, add `export const metadata` directly |
| 2 | Using `useEffect` + `useState` for primary page data | No SSR for critical content, bad SEO, loading flash | Server Component with `async` data fetching |
| 3 | Same hardcoded `<title>` on every page | Zero SEO differentiation between pages | `generateMetadata()` per dynamic page, `export const metadata` per static page |
| 4 | `useState` for image error fallbacks | Forces Client Component for trivial DOM behavior | `onError={(e) => e.currentTarget.src = fallback}` |
| 5 | `useState` accordion for FAQ | Unnecessary JS for basic UI pattern | `<details><summary>` semantic HTML |
| 6 | `window.scrollTo()` in navigation handlers | Forces Client Component | `<a href="#">` or `<Link>` with `scroll={true}` |
| 7 | Axios-only API client used everywhere | Cannot run server-side (localStorage dependency) | Dual pattern: `serverFetch()` for reads, axios for client mutations |
| 8 | Wrapping entire app in a client context that fetches data on mount | All pages wait for client-side fetch before showing real content | Pre-fetch server-side, pass initial data to context |
| 9 | `onClick` on `<a>` tags instead of real `href` | Breaks right-click, keyboard nav, accessibility | Use real `href` with `<Link>` or `<a>` |
| 10 | No `revalidate` or `cache` strategy on fetches | Every request hits the origin server | Add `next: { revalidate }` or `cache: "force-cache"` to fetch |

---

# DECISION TREE

```
New page or component?
├── Has interactivity (state, effects, browser APIs)?
│   ├── YES → "use client" (MINIMAL wrapper)
│   └── NO  → Server Component (default choice)
│
├── Needs page-level metadata?
│   ├── Dynamic data → generateMetadata()
│   └── Static data  → export const metadata
│
├── Fetches data for display?
│   ├── YES → Use serverFetch() or direct fetch()
│   │   ├── Static content → cache: "force-cache"
│   │   ├── Semi-dynamic  → next: { revalidate: N }
│   │   └── Real-time     → cache: "no-store"
│   └── NO  → Hardcode or import
│
├── Has images that might fail?
│   ├── YES → onError with e.currentTarget.src (no state needed)
│
├── Has accordion/expandable?
│   ├── YES → <details>/<summary> (no JS, semantic)
│
└── Final check: Is "use client" absolutely necessary?
    ├── If REMOVING it still works → DO NOT add it
    └── If it breaks → keep it AS SMALL AS POSSIBLE
```

<!-- END:nextjs-agent-rules -->
