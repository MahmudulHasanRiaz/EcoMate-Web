import type { Metadata } from "next";
import { fetchProductCardsServer, getBrandsServer, getCategoriesServer, getTagsServer } from "@/lib/api/products-server";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import { getMetaStoreName, metaBaseUrl, prettySlug } from "@/lib/archive-meta";
import ArchivePageClient from "./ArchivePageClient";

// Force dynamic rendering so storefront config (hideOosFromArchive) is always fresh
export const dynamic = 'force-dynamic';

type ProductsSearchParams = {
  search?: string;
  categoryId?: string;
  category?: string;
  tag?: string;
  brand?: string;
  minPrice?: string;
  maxPrice?: string;
  sort?: string;
  page?: string;
};

function withQuery(path: string, sp: ProductsSearchParams): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v) qs.set(k, v);
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<ProductsSearchParams>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const storeName = await getMetaStoreName();
  const base = await metaBaseUrl();

  const facetCount =
    (sp.category || sp.categoryId ? 1 : 0) +
    (sp.tag ? 1 : 0) +
    (sp.brand ? 1 : 0) +
    (sp.search ? 1 : 0);
  const hasModifier = !!(sp.sort || sp.minPrice || sp.maxPrice);

  // Multi-facet or filtered views are near-duplicate content — keep them
  // followable for crawlers but out of the index.
  if (facetCount !== 1 || hasModifier) {
    if (facetCount === 0 && !hasModifier) {
      return {
        title: 'Products',
        description: `Shop all products at ${storeName}`,
        alternates: { canonical: `${base}/products` },
      };
    }
    return { robots: { index: false, follow: true } };
  }

  if (sp.category || sp.categoryId) {
    // Slug form has a clean canonical (/category/slug); id form stays
    // self-canonical since /category/[slug] resolves slugs.
    if (sp.category) {
      const cats = await getCategoriesServer().catch(() => []);
      const name = cats.find((c: any) => c.slug === sp.category)?.name || prettySlug(sp.category);
      return {
        title: name,
        description: `Shop ${name} at ${storeName}`,
        alternates: { canonical: `${base}/category/${sp.category}` },
      };
    }
    return {
      title: 'Products',
      description: `Shop products at ${storeName}`,
      alternates: { canonical: `${base}${withQuery('/products', sp)}` },
    };
  }
  if (sp.tag) {
    const label = prettySlug(sp.tag);
    return {
      title: label,
      description: `Shop ${label} at ${storeName}`,
      alternates: { canonical: `${base}/products/tags/${sp.tag}` },
    };
  }
  if (sp.brand) {
    const brands = await getBrandsServer().catch(() => []);
    const name = brands.find((b: any) => b.slug === sp.brand)?.name || prettySlug(sp.brand);
    return {
      title: name,
      description: `Shop ${name} at ${storeName}`,
      alternates: { canonical: `${base}/brand/${sp.brand}` },
    };
  }
  // sp.search (single facet)
  return {
    title: `Search: ${sp.search}`,
    description: `Search results for "${sp.search}" at ${storeName}`,
    alternates: { canonical: `${base}${withQuery('/products', sp)}` },
  };
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<ProductsSearchParams>;
}) {
  const sp = await searchParams;
  const sort = sp.sort;
  const order =
    sort === "price-low" ? "asc"
    : (sort === "price-high" || sort === "newest" || sort === "popularity" || sort === "best-selling" || sort === "featured") ? "desc"
    : undefined;
  const sortField =
    sort === "price-low" || sort === "price-high" ? "basePrice"
    : sort === "newest" ? "createdAt"
    : sort === "popularity" || sort === "best-selling" ? "popularity"
    : sort === "featured" ? "isFeatured"
    : undefined;

  const [config, categories, brands, tags] = await Promise.all([
    getStorefrontConfigServer().catch(() => null),
    getCategoriesServer(),
    getBrandsServer().catch(() => []),
    getTagsServer().catch(() => []),
  ]);

  // PLP facet lists (PLP scale round): the filter sidebar's brand/tag
  // options come from these GLOBAL server lists, complete on first
  // render — previously the client derived them from whichever infinite-
  // scroll items happened to be loaded, so the lists were incomplete
  // until the visitor scrolled. Both fetchers never throw (they resolve
  // to [] on backend failure); an empty list makes the client fall back
  // to the old item-derived options, so a facet outage cannot break the
  // page. Only name + slug cross the wire — the client needs nothing else.
  const toFacetOptions = (list: any[]) =>
    (Array.isArray(list) ? list : [])
      .filter((x) => x && typeof x.name === 'string' && x.name)
      .map((x) => ({ name: x.name, slug: typeof x.slug === 'string' ? x.slug : '' }));
  const brandFacets = toFacetOptions(brands);
  const tagFacets = toFacetOptions(tags);

  const hideOos = config?.features?.hideOosFromArchive === true && !sp.search;

  const { data, meta } = await fetchProductCardsServer({
    perPage: 24,
    isActive: true,
    hasStock: hideOos || undefined,
    search: sp.search || undefined,
    categoryId: sp.categoryId || undefined,
    category: sp.category || undefined,
    tagSlug: sp.tag || undefined,
    brandSlug: sp.brand || undefined,
    minPrice: sp.minPrice ? parseFloat(sp.minPrice) : undefined,
    maxPrice: sp.maxPrice ? parseFloat(sp.maxPrice) : undefined,
    sort: sortField,
    order,
  });

  // No remount key: ArchivePageClient re-syncs its filter state, sort and
  // infinite-scroll list from new props in place (P6 refetch fix), and
  // filter navigation runs inside a React transition — remounting here
  // would throw away the visible grid (and scroll/focus) on every change.
  return (
    <ArchivePageClient
      initialItems={data}
      initialCursor={meta.nextCursor}
      initialHasMore={meta.hasMore}
      initialTotal={meta.total}
      categories={categories}
      brandFacets={brandFacets}
      tagFacets={tagFacets}
      filters={sp}
      hasStock={hideOos || undefined}
    />
  );
}
