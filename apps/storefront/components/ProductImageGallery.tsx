"use client";

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import Image from 'next/image';
import { PLACEHOLDER_IMAGE } from "@/lib/constants";

interface Props {
  images: string[];
  productName: string;
}

export function ProductImageGallery({ images, productName }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [imgErrors, setImgErrors] = useState<Record<number, boolean>>({});
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef(0);
  const touchEndX = useRef(0);

  useEffect(() => {
    if (lightboxOpen) {
      setLightboxIndex(activeIndex);
    }
  }, [lightboxOpen]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const newIndex = el.clientWidth > 0 ? Math.round(el.scrollLeft / el.clientWidth) : 0
    setActiveIndex(isNaN(newIndex) ? 0 : newIndex);
  }, []);

  const scrollTo = useCallback((index: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ left: el.clientWidth * index, behavior: 'smooth' });
    setActiveIndex(index);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  }, []);

  const handleTouchEnd = useCallback(() => {
    const diff = touchStartX.current - touchEndX.current;
    const threshold = 50;
    if (Math.abs(diff) > threshold) {
      if (diff > 0 && activeIndex < images.length - 1) {
        scrollTo(activeIndex + 1);
      } else if (diff < 0 && activeIndex > 0) {
        scrollTo(activeIndex - 1);
      }
    }
  }, [activeIndex, images.length, scrollTo]);

  const currentSrc = imgErrors[activeIndex] ? PLACEHOLDER_IMAGE : (images[activeIndex] || PLACEHOLDER_IMAGE);

  if (images.length === 0) {
    return (
      <div className="md:w-1/2">
        <div className="aspect-square bg-gray-50 rounded-lg flex items-center justify-center">
          <Image src={PLACEHOLDER_IMAGE} alt={productName} width={600} height={600} className="w-full h-full object-contain" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="md:w-1/2">
        <div className="relative -mx-4 md:mx-0">
          <div
            ref={scrollRef}
            onScroll={handleScroll}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className="flex overflow-x-auto snap-x snap-mandatory hide-scrollbar scroll-smooth"
            style={{ WebkitOverflowScrolling: 'touch' }}
          >
            {images.map((img, i) => (
              <div
                key={i}
                className="snap-center shrink-0 w-full md:rounded-lg overflow-hidden bg-gray-50 relative"
                style={{ aspectRatio: '4/5' }}
                onClick={() => setLightboxOpen(true)}
              >
                <Image
                  src={imgErrors[i] ? PLACEHOLDER_IMAGE : (img || PLACEHOLDER_IMAGE)}
                  alt={`${productName} ${i + 1}`}
                  fill
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-contain cursor-pointer"
                  onError={() => setImgErrors(prev => ({ ...prev, [i]: true }))}
                  draggable={false}
                />
              </div>
            ))}
          </div>

          {images.length > 1 && (
            <div className="flex items-center justify-center gap-2 mt-3 px-4 md:px-0">
              {images.map((_, i) => (
                <button
                  key={i}
                  onClick={() => scrollTo(i)}
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    i === activeIndex
                      ? 'bg-brand-blue w-5'
                      : 'bg-gray-300 hover:bg-gray-400'
                  }`}
                  aria-label={`Go to image ${i + 1}`}
                />
              ))}
            </div>
          )}
        </div>

        {images.length > 1 && (
          <div className="hidden md:flex gap-2 mt-3 overflow-x-auto hide-scrollbar">
            {images.map((img, i) => (
              <button key={i} onClick={() => scrollTo(i)}
                className={`w-16 h-16 flex-shrink-0 border rounded-md overflow-hidden p-0.5 transition-colors ${
                  i === activeIndex ? 'border-brand-blue ring-1 ring-brand-blue' : 'border-gray-200 hover:border-gray-400'
                }`}>
                <Image
                  src={imgErrors[i] ? PLACEHOLDER_IMAGE : (img || PLACEHOLDER_IMAGE)}
                  alt=""
                  width={64} height={64}
                  className="w-full h-full object-contain"
                  onError={() => setImgErrors(prev => ({ ...prev, [i]: true }))}
                />
              </button>
            ))}
          </div>
        )}
      </div>

          {lightboxOpen && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center" onClick={() => setLightboxOpen(false)}>
          <button onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center text-white/80 hover:text-white z-20 transition-colors">
            <X size={28} />
          </button>

          <div
            className="relative w-full h-full flex items-center justify-center"
            onClick={e => e.stopPropagation()}
          >
            <Image
              src={imgErrors[lightboxIndex] ? PLACEHOLDER_IMAGE : (images[lightboxIndex] || PLACEHOLDER_IMAGE)}
              alt={productName}
              width={800} height={800}
              className="max-w-[95vw] max-h-[90vh] object-contain select-none"
              draggable={false}
            />
          </div>

          {images.length > 1 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
              {images.map((_, i) => (
                <button key={i} onClick={(e) => { e.stopPropagation(); setLightboxIndex(i); }}
                  className={`w-2.5 h-2.5 rounded-full transition-all ${
                    i === lightboxIndex ? 'bg-white scale-110' : 'bg-white/40 hover:bg-white/70'
                  }`} />
              ))}
            </div>
          )}

          {lightboxIndex > 0 && (
            <button onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex - 1); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-white/70 hover:text-white z-20 transition-colors bg-white/10 hover:bg-white/20 rounded-full">
              <ChevronLeft size={20} strokeWidth={2.5} />
            </button>
          )}
          {lightboxIndex < images.length - 1 && (
            <button onClick={(e) => { e.stopPropagation(); setLightboxIndex(lightboxIndex + 1); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center text-white/70 hover:text-white z-20 transition-colors bg-white/10 hover:bg-white/20 rounded-full">
              <ChevronRight size={20} strokeWidth={2.5} />
            </button>
          )}
        </div>
      )}
    </>
  );
}
