import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import ComboDetailClient from '@/components/ComboDetailClient';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

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
  const { id } = await params;
  const combo = await getCombo(id);
  if (!combo) notFound();
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="animate-pulse bg-gray-200 h-64 w-full max-w-lg rounded-xl" /></div>}>
      <ComboDetailClient combo={combo} />
    </Suspense>
  );
}
