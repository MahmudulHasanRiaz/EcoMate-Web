import ProductsPage from "../../products/page";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<any>;
}

export default async function CategoryPage({
  params,
  searchParams,
}: CategoryPageProps) {
  const { slug } = await params;
  const sp = await searchParams;

  const resolvedSearchParams = Promise.resolve({
    ...sp,
    category: slug,
  });

  return <ProductsPage searchParams={resolvedSearchParams} />;
}
