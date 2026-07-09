import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ComboDetailClient from '@/components/ComboDetailClient';
import { getStorefrontConfigServer } from '@/lib/api/storefront-config-server';

const API = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

async function getCombo(id: string) {
  const res = await fetch(`${API}/combos/${id}`, { next: { revalidate: 300 } });
  if (!res.ok) return null;
  const data = await res.json();
  const basePrice = Number(data.basePrice);
  const salePrice = data.salePrice ? Number(data.salePrice) : undefined;
  return {
    ...data,
    price: salePrice ?? basePrice,
    originalPrice: salePrice != null && salePrice < basePrice ? basePrice : undefined,
    items: data.items?.map((item: any) => ({
      productId: item.productId,
      productName: item.product?.name,
      productType: item.product?.type,
      productImage: item.variant?.image || item.product?.images?.[0] || null,
      variantId: item.variantId,
      variantLabel: item.variant?.sku,
      quantity: item.quantity,
      price: item.price ? Number(item.price) : undefined,
      stock: item.variant ? item.variant.stock : item.product?.stock,
      variants: item.product?.variants,
    })) || [],
  };
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const combo = await getCombo(id);
  if (!combo) return { title: 'Combo Not Found' };
  return {
    title: `${combo.name} — Fixed Plus`,
    description: combo.shortDesc?.slice(0, 160) || `Check out our ${combo.name} combo deal`,
    openGraph: {
      title: combo.name,
      description: combo.shortDesc,
      images: combo.image ? [{ url: combo.image }] : [],
    },
  };
}

export default async function ComboDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const config = await getStorefrontConfigServer().catch(() => ({ licenseFeatures: [] as string[] }));
  if (!config.licenseFeatures?.includes('admin_combos')) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-gray-400">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-3">Not Available</h2>
        <p className="text-gray-500 max-w-md">Combo deals are not available on your current plan.</p>
      </div>
    );
  }

  const { id } = await params;
  const combo = await getCombo(id);
  if (!combo) notFound();
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-pulse bg-gray-200 h-64 w-full max-w-lg rounded-xl" /></div>}>
      <ComboDetailClient combo={combo} />
    </Suspense>
  );
}
