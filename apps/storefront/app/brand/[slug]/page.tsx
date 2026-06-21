import ProductsPage from "../../products/page";

interface BrandPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<any>;
}

export default async function BrandPage({
  params,
  searchParams,
}: BrandPageProps) {
  const { slug } = await params;
  const sp = await searchParams;

  const resolvedSearchParams = Promise.resolve({
    ...sp,
    brand: slug,
  });

  return <ProductsPage searchParams={resolvedSearchParams} />;
}
