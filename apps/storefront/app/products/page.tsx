import { fetchProductsServer, getCategoriesServer } from "@/lib/api/products-server";
import ArchivePageClient from "./ArchivePageClient";

export const dynamic = "force-dynamic";

type ProductsSearchParams = {
  search?: string;
  category?: string;
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
    sort === "price-low" ? "asc" : sort === "price-high" ? "desc" : undefined;
  const sortField = sort === "price-low" || sort === "price-high" ? "basePrice" : undefined;

  const [{ data, meta }, categories] = await Promise.all([
    fetchProductsServer({
      perPage: 24,
      isActive: true,
      search: sp.search || undefined,
      categoryId: sp.category || undefined,
      sort: sortField,
      order,
    }),
    getCategoriesServer(),
  ]);

  return (
    <ArchivePageClient
      initialItems={data}
      initialCursor={meta.nextCursor}
      initialHasMore={meta.hasMore}
      categories={categories}
      filters={sp}
    />
  );
}
