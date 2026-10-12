import type { Metadata } from "next";
import ProductsPage from "../../page";
import { getMetaStoreName, metaBaseUrl, prettySlug } from "@/lib/archive-meta";

interface TagPageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<any>;
}

// Canonical home of the tag facet: /products?tag=<slug> points here via
// alternates.canonical, so duplicate content collapses to this URL.
export async function generateMetadata({ params }: TagPageProps): Promise<Metadata> {
  const { slug } = await params;
  const storeName = await getMetaStoreName();
  const label = prettySlug(slug);
  return {
    title: label,
    description: `Shop ${label} at ${storeName}`,
    alternates: { canonical: `${metaBaseUrl()}/products/tags/${slug}` },
  };
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
