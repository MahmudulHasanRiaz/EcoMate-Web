"use client";

import React, { useRef, useEffect, useState } from 'react';
import { CATEGORIES } from "@/lib/constants";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { motion } from 'motion/react';

const PLACEHOLDER_IMAGE = "https://placehold.co/600x600/f8f9fa/a0aec0?text=No+Image";

export default function CategoryList() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isPaused, setIsPaused] = useState(false);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = 240;
      scrollRef.current.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth'
      });
    }
  };

  useEffect(() => {
    if (isPaused) return;

    const interval = setInterval(() => {
      if (scrollRef.current) {
        const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
        if (scrollLeft + clientWidth >= scrollWidth - 10) {
          scrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
        } else {
          scrollRef.current.scrollBy({ left: 200, behavior: 'smooth' });
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isPaused]);

  return (
    <section className="py-6 md:py-10 bg-[#f8f9fa]">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between mb-6 md:mb-8">
           <h3 className="text-xl md:text-2xl font-black text-gray-900 uppercase tracking-tighter">
             Featured Categories
           </h3>
           <div className="flex items-center gap-2">
             <button 
               onClick={() => scroll('left')}
               className="w-8 h-8 md:w-10 md:h-10 rounded-full border border-gray-200 bg-white text-gray-600 flex items-center justify-center hover:bg-brand-blue hover:text-white hover:border-brand-blue transition-all"
             >
               <ChevronLeft size={20} />
             </button>
             <button 
               onClick={() => scroll('right')}
               className="w-8 h-8 md:w-10 md:h-10 rounded-full border border-gray-200 bg-white text-gray-600 flex items-center justify-center hover:bg-brand-blue hover:text-white hover:border-brand-blue transition-all"
             >
               <ChevronRight size={20} />
             </button>
           </div>
        </div>

        <div className="relative group">
          <div 
            ref={scrollRef}
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
            className="flex overflow-x-auto gap-4 md:gap-6 pb-6 scrollbar-hide snap-x"
          >
            {CATEGORIES.map((category) => (
              <CategoryItem key={category.id} category={category} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CategoryItem({ category }: { category: typeof CATEGORIES[0]; key?: string | number }) {
  const [imgError, setImgError] = React.useState(false);

  return (
    <a
      href={`#${category.slug}`}
      className="flex flex-col items-center gap-2 min-w-[95px] md:min-w-[120px] snap-center group inline-block"
    >
      <div className="w-[95px] h-[95px] md:w-[120px] md:h-[120px] bg-white rounded-[24px] md:rounded-[32px] shadow-[0_4px_16px_rgba(0,0,0,0.04)] flex items-center justify-center overflow-hidden group-hover:shadow-[0_8px_20px_rgba(0,0,0,0.08)] transition-shadow">
        <img
          src={imgError ? PLACEHOLDER_IMAGE : (category.image || PLACEHOLDER_IMAGE)}
          alt={category.name}
          className="w-full h-full object-contain group-hover:scale-105 transition-transform"
          onError={() => setImgError(true)}
        />
      </div>
      <span className="text-[13px] md:text-[14px] font-medium text-gray-800 text-center leading-tight mt-1">
        {category.name}
      </span>
    </a>
  );
}
