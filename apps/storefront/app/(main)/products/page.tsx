import type { Metadata } from "next";
import { fetchProductsServer, getBrandsServer, getCategoriesServer } from "@/lib/api/products-server";
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
  const base = metaBaseUrl();

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

  const [config, categories] = await Promise.all([
    getStorefrontConfigServer().catch(() => null),
    getCategoriesServer(),
  ]);

  const hideOos = config?.features?.hideOosFromArchive === true && !sp.search;

  const { data, meta } = await fetchProductsServer({
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

  const filterKey = JSON.stringify(sp);

  return (
    <ArchivePageClient
      key={filterKey}
      initialItems={data}
      initialCursor={meta.nextCursor}
      initialHasMore={meta.hasMore}
      initialTotal={meta.total}
      categories={categories}
      filters={sp}
      hasStock={hideOos || undefined}
    />
  );
}
