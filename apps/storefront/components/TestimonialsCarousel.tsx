"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Star, ChevronLeft, ChevronRight } from "lucide-react";
import { PLACEHOLDER_IMAGE } from "@/lib/constants";

interface ReviewItem {
  id: string;
  customerName: string;
  rating: number;
  text: string | null;
  createdAt: string;
  product: {
    id: string;
    name: string;
    slug: string;
    images: string[];
  };
}

const AUTO_SLIDE_INTERVAL = 4000;

export default function TestimonialsCarousel({ reviews }: { reviews: ReviewItem[] }) {
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});
  const [current, setCurrent] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const items = reviews.slice(0, 6);

  const next = useCallback(() => {
    setCurrent((p) => (p + 1) % items.length);
  }, [items.length]);

  const prev = useCallback(() => {
    setCurrent((p) => (p - 1 + items.length) % items.length);
  }, [items.length]);

  useEffect(() => {
    if (isPaused || items.length < 2) return;
    timerRef.current = setInterval(next, AUTO_SLIDE_INTERVAL);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPaused, items.length, next]);

  if (items.length === 0) return null;

  return (
    <div
      className="relative max-w-2xl mx-auto"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="relative min-h-[220px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={items[current].id}
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -60 }}
            transition={{ duration: 0.35, ease: "easeInOut" }}
            className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm text-left"
          >
            <div className="flex items-center gap-1 mb-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Star
                  key={i}
                  size={16}
                  className={
                    i < items[current].rating
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-gray-200"
                  }
                />
              ))}
            </div>
            <p className="text-[14px] md:text-[15px] text-gray-600 italic leading-relaxed mb-6">
              &ldquo;{items[current].text}&rdquo;
            </p>
            <div className="flex items-center gap-3">
              <img
                src={
                  imgErrors[items[current].id]
                    ? PLACEHOLDER_IMAGE
                    : items[current].product?.images?.[0] ||
                      PLACEHOLDER_IMAGE
                }
                alt={items[current].customerName}
                className="w-11 h-11 rounded-full object-cover border border-gray-100 bg-gray-50"
                onError={() =>
                  setImgErrors((prev) => ({
                    ...prev,
                    [items[current].id]: true,
                  }))
                }
              />
              <div>
                <h4 className="text-[14px] font-bold text-gray-800">
                  {items[current].customerName}
                </h4>
                <p className="text-[11px] text-gray-400 font-medium">
                  {items[current].product?.name || "Verified Buyer"}
                </p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {items.length > 1 && (
        <>
          <button
            onClick={prev}
            className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 md:-translate-x-12 w-9 h-9 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-500 hover:text-brand-blue hover:border-brand-blue transition-all"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            onClick={next}
            className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 md:translate-x-12 w-9 h-9 rounded-full bg-white border border-gray-200 shadow-sm flex items-center justify-center text-gray-500 hover:text-brand-blue hover:border-brand-blue transition-all"
          >
            <ChevronRight size={18} />
          </button>

          <div className="flex items-center justify-center gap-2 mt-8">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`rounded-full transition-all ${
                  i === current
                    ? "w-6 h-2 bg-brand-blue"
                    : "w-2 h-2 bg-gray-300 hover:bg-gray-400"
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
