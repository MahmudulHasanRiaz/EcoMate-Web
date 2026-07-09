"use client";

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import Image from 'next/image';
import { PLACEHOLDER_IMAGE } from "@/lib/constants";

interface Props {
  images: string[];
  productName: string;
  badge?: string;
}

const AUTO_SLIDE_MS = 4000;

export function ProductImageGallery({ images, productName, badge }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [imgErrors, setImgErrors] = useState<Record<number, boolean>>({});
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);
  const [progress, setProgress] = useState(0);
  const desktopScrollRef = useRef<HTMLDivElement>(null);
  const mobileScrollRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<number>(0);

  const hasMultiple = images.length > 1;

  // Scroll main gallery to active index
  const scrollTo = useCallback((index: number) => {
    const desktopEl = desktopScrollRef.current;
    if (desktopEl && desktopEl.clientWidth > 0) {
      desktopEl.scrollTo({ left: desktopEl.clientWidth * index, behavior: 'smooth' });
    }
    const mobileEl = mobileScrollRef.current;
    if (mobileEl && mobileEl.clientWidth > 0) {
      mobileEl.scrollTo({ left: mobileEl.clientWidth * index, behavior: 'smooth' });
    }
    setActiveIndex(index);
  }, []);

  // Auto-slide logic
  const startAutoPlay = useCallback(() => {
    if (!hasMultiple) return;
    
    if (progressRef.current) cancelAnimationFrame(progressRef.current);
    setProgress(0);
    
    const startTime = Date.now();
    const tick = () => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min((elapsed / AUTO_SLIDE_MS) * 100, 100);
      setProgress(pct);
      if (pct >= 100) {
        scrollTo((activeIndex + 1) % images.length);
        return; // Do NOT recursively call startAutoPlay, useEffect handles it
      }
      progressRef.current = requestAnimationFrame(tick);
    };
    progressRef.current = requestAnimationFrame(tick);
  }, [hasMultiple, images.length, activeIndex, scrollTo]);

  const stopAutoPlay = useCallback(() => {
    if (progressRef.current) cancelAnimationFrame(progressRef.current);
    setProgress(0);
  }, []);

  useEffect(() => {
    if (isAutoPlaying && hasMultiple && !lightboxOpen) {
      startAutoPlay();
    } else {
      stopAutoPlay();
    }
    return () => {
      if (progressRef.current) cancelAnimationFrame(progressRef.current);
    };
  }, [activeIndex, isAutoPlaying, hasMultiple, lightboxOpen, startAutoPlay, stopAutoPlay]);

  // Scroll thumbnail into view (skip if gallery is off-screen to prevent page scroll jump)
  useEffect(() => {
    const thumbContainer = thumbRef.current;
    if (!thumbContainer) return;
    // If user scrolled past gallery, don't scrollIntoView — it would jump the page
    const containerRect = thumbContainer.getBoundingClientRect();
    if (containerRect.bottom < 0) return;
    const activeThumb = thumbContainer.children[activeIndex] as HTMLElement;
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeIndex]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (!el) return;
    const newIndex = el.clientWidth > 0 ? Math.round(el.scrollLeft / el.clientWidth) : 0;
    const clamped = Math.max(0, Math.min(newIndex, images.length - 1));
    if (clamped !== activeIndex) setActiveIndex(clamped);
  }, [activeIndex, images.length]);

  const goNext = useCallback(() => {
    if (activeIndex < images.length - 1) scrollTo(activeIndex + 1);
  }, [activeIndex, images.length, scrollTo]);

  const goPrev = useCallback(() => {
    if (activeIndex > 0) scrollTo(activeIndex - 1);
  }, [activeIndex, scrollTo]);

  if (images.length === 0) {
    return (
      <div className="md:w-[45%]">
        <div className="aspect-square bg-gray-50 rounded-2xl flex items-center justify-center">
          <Image src={PLACEHOLDER_IMAGE} alt={productName} width={600} height={600} className="w-full h-full object-contain" />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="md:w-[45%]">
        {/* ── Desktop: Main + Thumbnails side-by-side ── */}
        <div className="hidden md:flex gap-3">
          {/* Thumbnails (vertical strip) */}
          {hasMultiple && (
            <div ref={thumbRef} className="flex flex-col gap-2 overflow-y-auto hide-scrollbar max-h-[520px] flex-shrink-0 w-[72px]">
              {images.map((img, i) => (
                <button
                  key={i}
                  onClick={() => { scrollTo(i); setIsAutoPlaying(true); }}
                  className={`relative flex-shrink-0 w-[72px] h-[72px] rounded-xl overflow-hidden border-2 transition-all duration-200 ${
                    i === activeIndex
                      ? 'border-brand-blue shadow-md shadow-brand-blue/20 scale-105'
                      : 'border-gray-200 hover:border-gray-300 opacity-70 hover:opacity-100'
                  }`}
                >
                  <Image
                    src={imgErrors[i] ? PLACEHOLDER_IMAGE : (img || PLACEHOLDER_IMAGE)}
                    alt=""
                    width={72} height={72}
                    className="w-full h-full object-cover"
                    onError={() => setImgErrors(prev => ({ ...prev, [i]: true }))}
                  />
                  {i === activeIndex && isAutoPlaying && (
                    <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand-blue/30">
                      <div
                        className="h-full bg-brand-blue transition-none"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Main image */}
          <div className="relative flex-1 min-w-0">
            <div
              ref={desktopScrollRef}
              onScroll={handleScroll}
              className="flex overflow-x-auto snap-x snap-mandatory hide-scrollbar scroll-smooth rounded-2xl"
            >
              {images.map((img, i) => (
                <div
                  key={i}
                  className="snap-center shrink-0 w-full rounded-2xl overflow-hidden bg-gray-50 relative cursor-pointer"
                  style={{ aspectRatio: '4/5' }}
                  onClick={() => setLightboxOpen(true)}
                >
                  <Image
                    src={imgErrors[i] ? PLACEHOLDER_IMAGE : (img || PLACEHOLDER_IMAGE)}
                    alt={`${productName} ${i + 1}`}
                    fill
                    sizes="(max-width: 768px) 100vw, 45vw"
                    className="object-contain transition-transform duration-300"
                    onError={() => setImgErrors(prev => ({ ...prev, [i]: true }))}
                    draggable={false}
                    priority={i === 0}
                  />
                </div>
              ))}
            </div>
            
            {badge && (
              <div className="absolute top-4 left-4 bg-red-500 text-white text-sm font-bold px-3 py-1 rounded-full z-10 shadow-md">
                {badge}
              </div>
            )}

            {/* Counter badge */}
            {hasMultiple && (
              <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm text-white text-[11px] font-medium px-2.5 py-1 rounded-full z-10 flex items-center gap-1">
                <span className="font-semibold">{activeIndex + 1}</span>
                <span className="text-white/50">/</span>
                <span>{images.length}</span>
              </div>
            )}

            {/* Nav arrows (desktop) */}
            {hasMultiple && (
              <>
                {activeIndex > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); goPrev(); }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center bg-white/90 hover:bg-white text-gray-700 rounded-full shadow-lg transition-all z-10 hover:scale-110"
                  >
                    <ChevronLeft size={18} strokeWidth={2.5} />
                  </button>
                )}
                {activeIndex < images.length - 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); goNext(); }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center bg-white/90 hover:bg-white text-gray-700 rounded-full shadow-lg transition-all z-10 hover:scale-110"
                  >
                    <ChevronRight size={18} strokeWidth={2.5} />
                  </button>
                )}
              </>
            )}

            {/* Auto-play toggle */}
            {hasMultiple && (
              <button
                onClick={() => setIsAutoPlaying(p => !p)}
                className="absolute bottom-3 left-3 w-8 h-8 flex items-center justify-center bg-black/50 backdrop-blur-sm text-white/80 hover:text-white rounded-full transition-all z-10"
                title={isAutoPlaying ? 'Pause slideshow' : 'Play slideshow'}
              >
                {isAutoPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
              </button>
            )}
          </div>
        </div>

        {/* ── Mobile: Full-width carousel ── */}
        <div className="md:hidden relative">
          <div
            ref={mobileScrollRef}
            onScroll={handleScroll}
            className="flex overflow-x-auto snap-x snap-mandatory hide-scrollbar scroll-smooth"
          >
            {images.map((img, i) => (
              <div
                key={i}
                className="snap-center shrink-0 w-full rounded-2xl overflow-hidden bg-gray-50 relative"
                style={{ aspectRatio: '4/5' }}
                onClick={() => setLightboxOpen(true)}
              >
                <Image
                  src={imgErrors[i] ? PLACEHOLDER_IMAGE : (img || PLACEHOLDER_IMAGE)}
                  alt={`${productName} image ${i + 1}`}
                  fill
                  priority={i === 0}
                  sizes="(max-width: 768px) 100vw, 50vw"
                  className="object-contain"
                  onError={() => setImgErrors(prev => ({ ...prev, [i]: true }))}
                  draggable={false}
                />
              </div>
            ))}
          </div>
          
          {badge && (
            <div className="absolute top-4 left-4 bg-red-500 text-white text-sm font-bold px-3 py-1 rounded-full z-10 shadow-md">
              {badge}
            </div>
          )}

          {/* Mobile counter */}
          {hasMultiple && (
            <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm text-white text-[11px] font-medium px-2.5 py-1 rounded-full z-10">
              <span className="font-semibold">{activeIndex + 1}</span>
              <span className="text-white/50 mx-0.5">/</span>
              <span>{images.length}</span>
            </div>
          )}

          {/* Mobile dots */}
          {hasMultiple && (
            <div className="flex items-center justify-center gap-1.5 mt-3">
              {images.map((_, i) => (
                <button
                  key={i}
                  onClick={() => { scrollTo(i); setIsAutoPlaying(true); }}
                  className={`rounded-full transition-all duration-300 ${
                    i === activeIndex
                      ? 'bg-brand-blue w-5 h-1.5'
                      : 'bg-gray-300 hover:bg-gray-400 w-1.5 h-1.5'
                  }`}
                  aria-label={`Go to image ${i + 1}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Lightbox ── */}
      {lightboxOpen && (
        <div className="fixed inset-0 z-[100] bg-black/95 flex items-center justify-center" onClick={() => setLightboxOpen(false)}>
          <button onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center text-white/80 hover:text-white z-20 transition-colors">
            <X size={28} />
          </button>

          <div className="relative w-full h-full flex items-center justify-center overflow-hidden select-none"
            onClick={e => e.stopPropagation()}
            onTouchStart={(e) => { const t = e.target as HTMLElement; t.dataset.touchStartX = String(e.touches[0].clientX); }}
            onTouchMove={(e) => { const t = e.target as HTMLElement; t.dataset.touchEndX = String(e.touches[0].clientX); }}
            onTouchEnd={(e) => {
              const t = e.currentTarget;
              const start = parseFloat(t.dataset.touchStartX || '0');
              const end = parseFloat(t.dataset.touchEndX || '0');
              const diff = start - end;
              if (Math.abs(diff) > 50) {
                if (diff > 0 && lightboxIndex < images.length - 1) setLightboxIndex(lightboxIndex + 1);
                else if (diff < 0 && lightboxIndex > 0) setLightboxIndex(lightboxIndex - 1);
              }
            }}
          >
            <Image
              src={imgErrors[lightboxIndex] ? PLACEHOLDER_IMAGE : (images[lightboxIndex] || PLACEHOLDER_IMAGE)}
              alt={productName}
              width={800} height={800}
              className="max-w-[95vw] max-h-[90vh] object-contain"
              draggable={false}
              priority
            />
          </div>

          {/* Lightbox counter */}
          {hasMultiple && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm text-white text-[12px] font-medium px-3 py-1.5 rounded-full">
              <span className="font-semibold">{lightboxIndex + 1}</span>
              <span className="text-white/50 mx-1">/</span>
              <span>{images.length}</span>
            </div>
          )}

          {/* Lightbox dots */}
          {hasMultiple && images.length <= 10 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
              {images.map((_, i) => (
                <button key={i} onClick={(e) => { e.stopPropagation(); setLightboxIndex(i); }}
                  className={`rounded-full transition-all ${
                    i === lightboxIndex ? 'bg-white w-2.5 h-2.5' : 'bg-white/40 hover:bg-white/70 w-2 h-2'
                  }`} />
              ))}
            </div>
          )}

          {/* Lightbox arrows */}
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
