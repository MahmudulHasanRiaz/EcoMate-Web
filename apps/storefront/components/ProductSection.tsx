import type { ProductCardData } from "@/lib/types";
import ProductCard from "./ProductCard";
import Link from "next/link";

interface ProductSectionProps {
  title: string;
  products: ProductCardData[];
  href?: string;
  /**
   * Grant image priority to this section's first cards. Only correct when
   * the section is the page's LCP zone (e.g. homepage with NO hero above
   * it). Default false: sections sit below the hero, whose image is the
   * LCP — priority cards there only compete with it.
   */
  prioritizeFirstCards?: boolean;
}

export default function ProductSection({
  title,
  products,
  href = "/products",
  prioritizeFirstCards = false,
}: ProductSectionProps) {
  return (
    <section className="py-10 md:py-14 bg-white border-b border-gray-50">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between mb-8 md:mb-10 relative">
          <div className="relative pb-3">
             <h3 className="text-xl md:text-2xl font-black text-gray-800 uppercase tracking-tight">{title}</h3>
             <div className="absolute bottom-0 left-0 w-20 h-[4px] bg-brand-blue rounded-full"></div>
          </div>
          <Link 
            href={href}
            className="text-brand-blue-text text-[13px] md:text-[14px] font-black hover:text-brand-blue/80 transition-colors uppercase tracking-widest pb-2"
          >
            Show More
          </Link>
          <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gray-100 -z-10"></div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {products.map((product, index) => (
            // Priority is budgeted by the page (see ProductCard): only a
            // section that IS the LCP zone prioritises its first row.
            <ProductCard
              key={product.id}
              product={product}
              index={index}
              priority={prioritizeFirstCards ? index < 2 : false}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
