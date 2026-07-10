import { fetchProductsServer, getCategoriesServer } from "@/lib/api/products-server";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
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

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<ProductsSearchParams>;
}) {
  const sp = await searchParams;
  const sort = sp.sort;
  const order =
    sort === "price-low" ? "asc" : (sort === "price-high" || sort === "newest" || sort === "popularity") ? "desc" : undefined;
  const sortField = sort === "price-low" || sort === "price-high" ? "basePrice" : sort === "newest" ? "createdAt" : sort === "popularity" ? "popularity" : undefined;

  const [config, categories] = await Promise.all([
    getStorefrontConfigServer().catch(() => null),
    getCategoriesServer(),
  ]);

  const hideOos = config?.features?.hideOosFromArchive === true;

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
      categories={categories}
      filters={sp}
      hasStock={hideOos || undefined}
    />
  );
}
