import type { Metadata } from "next";
import Link from "next/link";
import { getProductBySlugServer } from "@/lib/api/products-server";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import ProductDetailClient from "@/components/ProductDetailClient";

export const revalidate = 300;
export const dynamicParams = true;

export async function generateStaticParams() {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/products?isActive=true&perPage=100`);
  const { data } = await res.json();
  return (data || []).map((p: any) => ({ slug: p.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await props.params;
  let storeName = "Store";
  try { const c = await getStorefrontConfigServer(); storeName = c.store.name; } catch {}
  try {
    const product = await getProductBySlugServer(slug);
    if (!product) return { title: `Product Not Found — ${storeName}` };
    return {
      title: `${product.name} — ${storeName}`,
      description: product.description?.slice(0, 160) || `${product.name} at ${storeName}`,
      openGraph: {
        title: product.name,
        description: product.description?.slice(0, 160),
        images: product.image ? [{ url: product.image }] : [],
      },
    };
  } catch {
    return { title: `Product Not Found — ${storeName}` };
  }
}

function ProductNotFound() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
      <h1 className="text-4xl font-bold text-gray-900 mb-4">Product Not Found</h1>
      <p className="text-gray-600 mb-8 max-w-md">
        This product may have been removed or is no longer available.
      </p>
      <Link
        href="/products"
        className="inline-flex items-center px-6 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors"
      >
        Browse Products
      </Link>
    </div>
  );
}

export default async function ProductPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  try {
    const product = await getProductBySlugServer(slug);
    if (!product) return <ProductNotFound />;
    const productJsonLd = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      description: product.description?.slice(0, 160),
      image: product.image || undefined,
      offers: {
        '@type': 'Offer',
        price: product.price,
        priceCurrency: 'BDT',
        availability: product.stock && product.stock > 0
          ? 'https://schema.org/InStock'
          : 'https://schema.org/OutOfStock',
      },
    };
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(productJsonLd) }}
        />
        <ProductDetailClient product={product} />
      </>
    );
  } catch {
    return <ProductNotFound />;
  }
}
