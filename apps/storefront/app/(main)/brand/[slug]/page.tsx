import type { Metadata } from "next";
import ProductsPage from "../../products/page";
import { getBrandsServer } from "@/lib/api/products-server";
import { getMetaStoreName, metaBaseUrl, prettySlug } from "@/lib/archive-meta";

interface BrandPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<any>;
}

// Canonical home of the brand facet: /products?brand=<slug> points here via
// alternates.canonical, so duplicate content collapses to this URL.
export async function generateMetadata({ params }: BrandPageProps): Promise<Metadata> {
  const { slug } = await params;
  const storeName = await getMetaStoreName();
  const brands = await getBrandsServer().catch(() => []);
  const name = brands.find((b: any) => b.slug === slug)?.name || prettySlug(slug);
  return {
    title: name,
    description: `Shop ${name} at ${storeName}`,
    alternates: { canonical: `${metaBaseUrl()}/brand/${slug}` },
  };
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
