"use client";

import type { Product } from "@/lib/types";
import ProductCard from "./ProductCard";
import { motion } from "motion/react";
import Link from "next/link";

interface ProductSectionProps {
  title: string;
  products: Product[];
}

export default function ProductSection({
  title,
  products,
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
            href="/products"
            className="text-brand-blue text-[13px] md:text-[14px] font-black hover:text-brand-blue/80 transition-colors uppercase tracking-widest pb-2"
          >
            Show More
          </Link>
          <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gray-100 -z-10"></div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {products.map((product) => (
            <motion.div
              key={product.id}
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-50px" }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <ProductCard product={product} />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
