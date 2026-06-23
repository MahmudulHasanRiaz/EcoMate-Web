import ProductsPage from "../../page";

interface TagPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<any>;
}

export default async function TagPage({
  params,
  searchParams,
}: TagPageProps) {
  const { slug } = await params;
  const sp = await searchParams;

  const resolvedSearchParams = Promise.resolve({
    ...sp,
    tag: slug,
  });

  return <ProductsPage searchParams={resolvedSearchParams} />;
}
