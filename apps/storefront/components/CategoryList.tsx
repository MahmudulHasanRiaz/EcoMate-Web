"use client";

import React, { useRef, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { PLACEHOLDER_IMAGE } from "@/lib/constants";
import { getMenuCategories } from "@/lib/api/products";
import type { Category } from "@/lib/types";

export default function CategoryList() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [imgErrors, setImgErrors] = useState<{ [key: string]: boolean }>({});

  useEffect(() => {
    getMenuCategories().then(setCategories).catch(() => {});
  }, []);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 240;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  // Cache layout dimensions — recalculate only on resize
  const dimsRef = useRef({ scrollWidth: 0, clientWidth: 0 });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    dimsRef.current = { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
    const ro = new ResizeObserver(() => {
      if (scrollRef.current) {
        dimsRef.current = { scrollWidth: scrollRef.current.scrollWidth, clientWidth: scrollRef.current.clientWidth };
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [categories]);

  useEffect(() => {
    if (isPaused || categories.length === 0) return;
    const interval = setInterval(() => {
      const el = scrollRef.current;
      if (!el) return;
      const { scrollWidth, clientWidth } = dimsRef.current;
      const scrollLeft = el.scrollLeft;
      if (scrollLeft + clientWidth >= scrollWidth - 10) {
        el.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        el.scrollBy({ left: 200, behavior: 'smooth' });
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [isPaused, categories.length]);

  return (
    <section className="py-6 md:py-10 bg-[#f8f9fa] min-h-[100px] md:min-h-[140px]">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between mb-6 md:mb-8">
          <h3 className="text-xl md:text-2xl font-black text-gray-900 uppercase tracking-tighter">
            Featured Categories
          </h3>
          {categories.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => scroll('left')}
                aria-label="Scroll categories left"
                className="w-8 h-8 md:w-10 md:h-10 rounded-full border border-gray-200 bg-white text-gray-600 flex items-center justify-center hover:bg-brand-blue hover:text-white hover:border-brand-blue transition-all"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                onClick={() => scroll('right')}
                aria-label="Scroll categories right"
                className="w-8 h-8 md:w-10 md:h-10 rounded-full border border-gray-200 bg-white text-gray-600 flex items-center justify-center hover:bg-brand-blue hover:text-white hover:border-brand-blue transition-all"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>

        <div className="relative group">
          {categories.length > 0 ? (
            <div
              ref={scrollRef}
              onMouseEnter={() => setIsPaused(true)}
              onMouseLeave={() => setIsPaused(false)}
              className="flex overflow-x-auto gap-4 md:gap-6 pb-6 hide-scrollbar snap-x"
            >
              {categories.map((category) => (
                <CategoryItem key={category.id} category={category} imgErrors={imgErrors} setImgErrors={setImgErrors} />
              ))}
            </div>
          ) : (
            <div className="flex gap-4 md:gap-6 pb-6 overflow-hidden">
              {[1,2,3,4,5,6].map((i) => (
                <div key={i} className="flex flex-col items-center gap-3 min-w-[85px] md:min-w-[120px] animate-pulse">
                  <div className="w-[85px] h-[85px] md:w-[100px] md:h-[100px] bg-gray-200 rounded-xl" />
                  <div className="h-3 w-16 bg-gray-200 rounded" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CategoryItem({ category, imgErrors, setImgErrors }: {
  category: Category;
  imgErrors: { [key: string]: boolean };
  setImgErrors: React.Dispatch<React.SetStateAction<{ [key: string]: boolean }>>;
}) {
  const catImg = category.mediaMeta?.[category.image]?.derivativeManifest?.thumbnail || category.image;
  return (
    <Link
      href={`/products?category=${category.slug}`}
      className="flex flex-col items-center gap-3 min-w-[85px] md:min-w-[120px] snap-center group inline-block cursor-pointer"
    >
      <div className="relative w-[85px] h-[85px] md:w-[100px] md:h-[100px] bg-white rounded-xl shadow-[0_2px_12px_rgba(0,0,0,0.04)] border border-gray-100 flex items-center justify-center overflow-hidden group-hover:shadow-md group-hover:border-brand-blue/30 transition-all duration-300 transform group-hover:-translate-y-1">
        <div className="absolute inset-0 bg-gradient-to-tr from-brand-blue/[0.03] to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
        <Image
          src={imgErrors[category.id] ? PLACEHOLDER_IMAGE : (catImg || PLACEHOLDER_IMAGE)}
          alt=""
          fill
          sizes="100px"
          className="object-cover group-hover:scale-110 transition-transform duration-500 ease-out relative z-10"
          onError={() => setImgErrors(prev => ({ ...prev, [category.id]: true }))}
        />
      </div>
      <span className="text-[12px] md:text-[14px] font-semibold text-gray-700 text-center block w-full truncate group-hover:text-brand-blue transition-colors px-1 mt-2" title={category.name}>
        {category.name}
      </span>
    </Link>
  );
}
