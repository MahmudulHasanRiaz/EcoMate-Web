import type { Metadata } from "next";
import ProductsPage from "../../products/page";
import { getCategoriesServer } from "@/lib/api/products-server";
import { getMetaStoreName, metaBaseUrl, prettySlug } from "@/lib/archive-meta";

interface CategoryPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<any>;
}

// Canonical home of the category facet: /products?category=<slug> points
// here via alternates.canonical, so duplicate content collapses to this URL.
export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const storeName = await getMetaStoreName();
  const cats = await getCategoriesServer().catch(() => []);
  const name = cats.find((c: any) => c.slug === slug)?.name || prettySlug(slug);
  return {
    title: name,
    description: `Shop ${name} at ${storeName}`,
    alternates: { canonical: `${metaBaseUrl()}/category/${slug}` },
  };
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
