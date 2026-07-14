import { PLACEHOLDER_IMAGE } from "@/lib/constants";
import Link from 'next/link';
import { BrandLogoImage } from './BrandLogoImage';

interface Brand {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
}

export default function BrandSection({ brands = [] }: { brands?: Brand[] }) {
  if (brands.length === 0) return null;

  return (
    <section className="py-8 bg-[#fcfcfc]">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between mb-8 border-b border-gray-100 pb-2">
          <h3 className="text-[18px] font-bold text-gray-800">Our Brands</h3>
          <Link href="/products" className="text-brand-blue text-[12px] font-bold uppercase tracking-wider hover:underline flex items-center gap-1">
            SEE ALL 
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14"></path>
              <path d="m12 5 7 7-7 7"></path>
            </svg>
          </Link>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {brands.map((brand) => {
            const baseUrl = process.env.NEXT_PUBLIC_MEDIA_URL || '';
            let logoUrl = brand.logo ? (brand.logo.startsWith('http') ? brand.logo : `${baseUrl}/${brand.logo}`.replace(/(?<!:)\/+/g, '/')) : PLACEHOLDER_IMAGE;
            if (logoUrl.startsWith('//')) logoUrl = logoUrl.substring(1);
            return (
              <div key={brand.id} className="bg-white border border-gray-100 rounded-lg p-6 flex items-center justify-center h-[100px] shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                <BrandLogoImage src={logoUrl} alt={brand.name} fallback={PLACEHOLDER_IMAGE} />
              </div>
            )
          })}
        </div>

        {/* Indicators */}
        {brands.length > 4 && (
          <div className="flex justify-center gap-1.5 mt-8">
             <div className="w-2.5 h-2.5 rounded-full bg-brand-blue"></div>
             <div className="w-2.5 h-2.5 rounded-full bg-gray-200"></div>
          </div>
        )}
      </div>
    </section>
  );
}
