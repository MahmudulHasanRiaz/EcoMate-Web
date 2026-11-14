import type { MetadataRoute } from 'next';
import { canonicalSiteUrl, publicMediaUrl } from '@/lib/site-url';
import { serverFetch } from '@/lib/api-server';
import {
  preFormattedPages,
  templateHasRealContent,
} from '@/lib/templates/registry';
import {
  TEMPLATE_PAGE_ROUTES,
  hasRealShippingConfig,
} from '@/lib/template-content';

// Crawler hits must not regenerate on every request: cache for an hour.
// Product/stock freshness lives on the PDP (short TTL), not here.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = await canonicalSiteUrl();

  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: 'daily' as const, priority: 1 },
    { url: `${baseUrl}/products`, lastModified: new Date(), changeFrequency: 'daily' as const, priority: 0.9 },
    { url: `${baseUrl}/combos`, lastModified: new Date(), changeFrequency: 'daily' as const, priority: 0.8 },
  ];

  // Product images are served from the backend (/uploads/…) — resolve them
  // through the ONE public-media helper, never against the API origin:
  // in production API_URL is the internal http://backend:4000, which
  // leaked into every sitemap image URL (unfetchable by any crawler).
  // publicMediaUrl rebases internal hosts and relative /uploads paths
  // onto the public site origin (the PDP og:image path already uses it).
  // Sitemap entries must be absolute, so a still-relative result (site
  // URL unset) falls back to the sitemap base URL.
  const toAbsoluteUrl = (src: string | undefined): string | undefined => {
    const pub = publicMediaUrl(src);
    if (!pub) return undefined;
    if (/^https?:\/\//.test(pub)) return pub;
    return `${baseUrl}${pub.startsWith('/') ? '' : '/'}${pub}`;
  };

  // Outage guard (same class as the PR #180 PDP fix): if EVERY dynamic
  // fetch fails — e.g. the sitemap regenerates while the backend is
  // still booting after a redeploy — the result would be a degenerate
  // static-only sitemap, and `revalidate` would cache it for an hour.
  // Throw instead so nothing is cached and the next hit retries; a
  // successful-but-empty catalog response is NOT a failure.
  let dynamicOk = false;

  // Build-time prerender is exempt: `next build` generates /sitemap.xml
  // inside the Docker builder, where no backend exists by design — the
  // baked static-only result is only a placeholder until the first
  // runtime revalidation replaces it. Throwing there fails the build
  // (seen in Build #880). At runtime the throw stands.
  const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build';

  // D7 — search-engine indexing flag. ONE flag drives robots + sitemap +
  // layout meta in lockstep: OFF → an empty sitemap, no entries at all.
  // Only an explicit `false` turns it off; a missing key (pre-toggle
  // backend) keeps the historic ON behaviour. A failed config fetch at
  // runtime throws via the outage guard (same as any other dynamic
  // fetch); at build time there is no backend by design, so ON is the
  // placeholder until the first runtime revalidation.
  // The payload is kept: the delivery-areas inclusion rule below also
  // needs the live shipping config.
  // All dynamic fetches go through serverFetch: internal-secret header,
  // throw on !ok, retries on connection failure. A backend error therefore
  // surfaces as a thrown fetch (caught per block below) instead of a
  // non-JSON error body silently parsing to [] — the outage guard at the
  // bottom only throws (loud, nothing cached) when EVERY fetch fails.
  let storefrontCfg: any = null;
  try {
    // Tagged "config": POST /api/revalidate {tags:["config"]} (the
    // Purge-all button, and a canonical_domain save) purges this fetch
    // AND the sitemap route cache — without the tag, a domain change
    // would sit stale here until the hourly revalidate.
    const cfg = await serverFetch<any>('/system-settings/storefront', {
      tags: ['config'],
    });
    storefrontCfg = cfg;
    if (cfg?.searchIndexingEnabled === false) return [];
  } catch {
    if (!isBuildPhase) {
      throw new Error('sitemap: backend unreachable — refusing to cache a degenerate sitemap');
    }
  }

  // Fetch categories for dynamic category pages
  let categoryPages: MetadataRoute.Sitemap = [];
  try {
    const data = await serverFetch<any>('/categories?isActive=true');
    dynamicOk = true;
    const categories = data.data || data || [];
    if (Array.isArray(categories)) {
      categoryPages = categories.map((cat: any) => ({
        url: `${baseUrl}/category/${cat.slug || cat.id}`,
        lastModified: new Date(cat.updatedAt),
        changeFrequency: 'daily' as const,
        priority: 0.7,
      }));
    }
  } catch {}

  // Fetch products for product detail pages — follow cursor pagination so
  // catalogs larger than one page are fully covered.
  let productPages: MetadataRoute.Sitemap = [];
  try {
    let cursor: string | null = null;
    let prevCursor: string | undefined;
    for (;;) {
      const pageUrl: string = `/products?isActive=true&perPage=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const data: any = await serverFetch(pageUrl);
      dynamicOk = true;
      const products = data.data || [];
      if (Array.isArray(products)) {
        for (const p of products) {
          const img = toAbsoluteUrl(p.images?.[0] || p.image);
          productPages.push({
            url: `${baseUrl}/products/${p.slug}`,
            lastModified: new Date(p.updatedAt),
            changeFrequency: 'daily' as const,
            priority: 0.6,
            ...(img ? { images: [img] } : {}),
          });
        }
      }
      const next: string | null = data.meta?.nextCursor ?? null;
      if (!data.meta?.hasMore || !next || next === prevCursor) break;
      prevCursor = cursor ?? undefined;
      cursor = next;
    }
  } catch {}

  // Fetch combos for combo detail pages
  let comboPages: MetadataRoute.Sitemap = [];
  try {
    const data = await serverFetch<any>('/combos?isActive=true&perPage=1000');
    dynamicOk = true;
    const combos = data.data || [];
    if (Array.isArray(combos)) {
      comboPages = combos.map((c: any) => ({
        url: `${baseUrl}/combos/${c.id}`,
        lastModified: new Date(c.updatedAt),
        changeFrequency: 'daily' as const,
        priority: 0.6,
      }));
    }
  } catch {}

  // Template pages (about, company, download, policies, …) — D8: a page
  // enters the sitemap only when its stored CMS row is active AND carries
  // real configured content (Part A's `templateHasRealContent`, called
  // with the MERGED config per its contract). A slug fetch that fails
  // (or a content-less row) omits that page for this regen; it never
  // fails the whole sitemap, and the hourly revalidation retries it.
  // Delivery-areas is special: its content now comes from the live
  // shipping config, so it is also included when that config has zones /
  // charges even with an empty CMS row.
  let templatePages: MetadataRoute.Sitemap = [];
  try {
    const checks = await Promise.all(
      TEMPLATE_PAGE_ROUTES.map(
        async (t): Promise<MetadataRoute.Sitemap[number] | null> => {
          try {
            // serverFetch throws on !ok (a missing slug is a 404) — the
            // inner catch below turns that into "omit this page", same as
            // the old `if (!res.ok) return null`.
            const page = await serverFetch<any>(`/cms-pages/slug/${t.slug}`);
            dynamicOk = true;
            if (!page?.isActive) return null;
            const def = preFormattedPages[t.key];
            const merged = def
              ? { ...def.defaultConfig, ...(page?.config || {}) }
              : page?.config;
            const hasContent =
              templateHasRealContent(t.key, merged) ||
              (t.key === 'delivery-areas' && hasRealShippingConfig(storefrontCfg));
            if (!hasContent) return null;
            return {
              url: `${baseUrl}${t.path}`,
              lastModified: page.updatedAt ? new Date(page.updatedAt) : new Date(),
              changeFrequency: t.changeFrequency,
              priority: t.priority,
            };
          } catch {
            return null;
          }
        },
      ),
    );
    templatePages = checks.filter(
      (c): c is MetadataRoute.Sitemap[number] => c !== null,
    );
  } catch {}

  // Fetch CMS content pages. The old code fetched the role-guarded list
  // endpoint (`GET /cms-pages`) without auth and always got `[]` — no
  // `/pages/*` URL ever entered the sitemap. The public footer endpoint
  // (`GET /cms-pages/footer`, active + showInFooter) is the correct
  // source and needs no auth. Template-type rows live at /<slug> and
  // content rows at /pages/<slug> — the same split the footer renders
  // (CmsFooterLinks); mapping every row to /pages/<slug> 404s the
  // template ones.
  let cmsPages: MetadataRoute.Sitemap = [];
  try {
    const data = await serverFetch<any>('/cms-pages/footer');
    dynamicOk = true;
    const pages = Array.isArray(data) ? data : data.data || [];
    if (Array.isArray(pages)) {
      cmsPages = pages.map((p: any) => ({
        url: p.type === 'template' ? `${baseUrl}/${p.slug}` : `${baseUrl}/pages/${p.slug}`,
        lastModified: new Date(p.updatedAt),
        changeFrequency: 'monthly' as const,
        priority: 0.5,
      }));
    }
  } catch {}

  if (!dynamicOk && !isBuildPhase) {
    throw new Error('sitemap: backend unreachable — refusing to cache a degenerate sitemap');
  }

  return [...staticPages, ...templatePages, ...categoryPages, ...productPages, ...comboPages, ...cmsPages];
}
