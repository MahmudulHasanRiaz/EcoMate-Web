import type { Metadata } from "next";
import { getProductBySlugServer } from "@/lib/api/products-server";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import ColorCatalogGrid from "@/components/ColorCatalogGrid";
import ProductDetailClient from "@/components/ProductDetailClient";
import Link from "next/link";

export const revalidate = 300;

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ color?: string }>;
}): Promise<Metadata> {
  const [{ slug }, sp] = await Promise.all([props.params, props.searchParams]);
  let storeName = "Store";
  try { const c = await getStorefrontConfigServer(); storeName = c.store.name; } catch {}
  try {
    const product = await getProductBySlugServer(slug);
    if (!product) return { title: `Product Not Found — ${storeName}` };
    const title = sp.color
      ? `${product.name} (${sp.color}) — ${storeName}`
      : `${product.name} — Colors — ${storeName}`;
    return {
      title,
      description: sp.color
        ? `Buy ${product.name} in ${sp.color} color — ${storeName}`
        : `Available colors for ${product.name} — ${storeName}`,
    };
  } catch {
    return { title: `Product Not Found — ${storeName}` };
  }
}

function ProductNotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <h1 className="text-4xl font-bold text-gray-900 mb-4">Product Not Found</h1>
      <p className="text-gray-600 mb-8 max-w-md">This product may have been removed or is no longer available.</p>
      <Link href="/products" className="inline-flex items-center px-6 py-3 bg-brand-blue text-white rounded-xl hover:bg-brand-blue-dark transition-colors">
        Browse Products
      </Link>
    </div>
  );
}

export default async function ColorsPage(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ color?: string }>;
}) {
  const [{ slug }, sp] = await Promise.all([props.params, props.searchParams]);
  try {
    const product = await getProductBySlugServer(slug);
    if (!product) return <ProductNotFound />;

    // Color pre-selected → render PDP with pre-selected color
    if (sp.color) {
      return <ProductDetailClient product={product} defaultColor={sp.color} />;
    }

    // No color param → render color grid catalog
    return <ColorCatalogGrid product={product} />;
  } catch {
    return <ProductNotFound />;
  }
}
