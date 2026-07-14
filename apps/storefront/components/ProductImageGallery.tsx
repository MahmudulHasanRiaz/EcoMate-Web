"use client";

import { useState, useRef, useCallback, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Pause, Play, ZoomIn, ZoomOut } from 'lucide-react';
import Image from 'next/image';
import { PLACEHOLDER_IMAGE } from "@/lib/constants";
import type { MediaMeta } from "@/lib/types";

interface Props {
  images: string[];
  productName: string;
  badge?: string;
  mediaMeta?: MediaMeta;
}

function resolveDerivative(url: string, mediaMeta: MediaMeta | undefined, variant: string): string {
  return mediaMeta?.[url]?.derivativeManifest?.[variant] || url;
}

const AUTO_SLIDE_MS = 4000;

export function ProductImageGallery({ images, productName, badge, mediaMeta }: Props) {
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

  const lightboxImageRef = useRef<HTMLDivElement>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [isZoomed, setIsZoomed] = useState(false);
  const lastTapRef = useRef<number>(0);
  const pinchDistRef = useRef<number>(0);

  const hasMultiple = images.length > 1;

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
        return;
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

  useEffect(() => {
    const thumbContainer = thumbRef.current;
    if (!thumbContainer) return;
    const containerRect = thumbContainer.getBoundingClientRect();
    if (containerRect.bottom < 0) return;
    const activeThumb = thumbContainer.children[activeIndex] as HTMLElement;
    if (activeThumb) {
      activeThumb.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeIndex]);

  useEffect(() => {
    if (!lightboxOpen) {
      setIsZoomed(false);
      setZoomScale(1);
    }
  }, [lightboxOpen]);

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

  const lightboxGoNext = useCallback(() => {
    if (lightboxIndex < images.length - 1) {
      setLightboxIndex(lightboxIndex + 1);
      setIsZoomed(false);
      setZoomScale(1);
    }
  }, [lightboxIndex, images.length]);

  const lightboxGoPrev = useCallback(() => {
    if (lightboxIndex > 0) {
      setLightboxIndex(lightboxIndex - 1);
      setIsZoomed(false);
      setZoomScale(1);
    }
  }, [lightboxIndex]);

  const toggleZoom = useCallback(() => {
    if (isZoomed) {
      setZoomScale(1);
      setIsZoomed(false);
    } else {
      setZoomScale(2.5);
      setIsZoomed(true);
    }
  }, [isZoomed]);

  const getPinchDistance = (touches: React.TouchList): number => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const lightboxSwipeState = useRef({ startX: 0, startY: 0, isSwiping: false, translateX: 0 });

  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          setLightboxOpen(false);
          break;
        case 'ArrowLeft':
          lightboxGoPrev();
          break;
        case 'ArrowRight':
          lightboxGoNext();
          break;
        case '+':
        case '=':
          e.preventDefault();
          setZoomScale(s => Math.min(s + 0.5, 4));
          setIsZoomed(true);
          break;
        case '-':
          e.preventDefault();
          setZoomScale(s => {
            const next = Math.max(s - 0.5, 0.5);
            if (next <= 1) setIsZoomed(false);
            return next;
          });
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxOpen, lightboxGoNext, lightboxGoPrev]);

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
        <div className="hidden md:flex gap-3">
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
                    src={imgErrors[i] ? PLACEHOLDER_IMAGE : resolveDerivative(img, mediaMeta, 'thumbnail')}
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
                  onClick={() => { setLightboxOpen(true); setLightboxIndex(activeIndex); }}
                >
                  <Image
                    src={imgErrors[i] ? PLACEHOLDER_IMAGE : resolveDerivative(img, mediaMeta, 'medium')}
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

            {hasMultiple && (
              <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm text-white text-[11px] font-medium px-2.5 py-1 rounded-full z-10 flex items-center gap-1">
                <span className="font-semibold">{activeIndex + 1}</span>
                <span className="text-white/50">/</span>
                <span>{images.length}</span>
              </div>
            )}

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
                onClick={() => { setLightboxOpen(true); setLightboxIndex(activeIndex); }}
              >
                <Image
                  src={imgErrors[i] ? PLACEHOLDER_IMAGE : resolveDerivative(img, mediaMeta, 'small')}
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

          {hasMultiple && (
            <div className="absolute top-3 right-3 bg-black/60 backdrop-blur-sm text-white text-[11px] font-medium px-2.5 py-1 rounded-full z-10">
              <span className="font-semibold">{activeIndex + 1}</span>
              <span className="text-white/50 mx-0.5">/</span>
              <span>{images.length}</span>
            </div>
          )}

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

      {lightboxOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/95 select-none"
          onClick={() => setLightboxOpen(false)}
        >
          <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
            <div
              ref={lightboxImageRef}
              className="relative w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing"
              onClick={e => e.stopPropagation()}
              onTouchStart={(e) => {
                if (e.touches.length === 2) {
                  pinchDistRef.current = getPinchDistance(e.touches);
                  return;
                }
                lightboxSwipeState.current.startX = e.touches[0].clientX;
                lightboxSwipeState.current.startY = e.touches[0].clientY;
                lightboxSwipeState.current.isSwiping = true;
                lightboxSwipeState.current.translateX = 0;
              }}
              onTouchMove={(e) => {
                if (e.touches.length === 2) {
                  e.preventDefault();
                  const dist = getPinchDistance(e.touches);
                  const scale = pinchDistRef.current > 0 ? dist / pinchDistRef.current : 1;
                  const newScale = Math.max(0.5, Math.min(zoomScale * scale, 4));
                  setZoomScale(newScale);
                  if (newScale > 1) setIsZoomed(true);
                  pinchDistRef.current = dist;
                  return;
                }
                if (!lightboxSwipeState.current.isSwiping || isZoomed) return;
                const dx = e.touches[0].clientX - lightboxSwipeState.current.startX;
                lightboxSwipeState.current.translateX = dx;
                if (lightboxImageRef.current) {
                  const img = lightboxImageRef.current.firstChild as HTMLElement;
                  if (img) {
                    img.style.transform = `translateX(${dx}px) scale(${zoomScale})`;
                    img.style.transition = 'none';
                  }
                }
              }}
              onTouchEnd={(e) => {
                if (pinchDistRef.current > 0) {
                  pinchDistRef.current = 0;
                  return;
                }
                const now = Date.now();
                const dt = now - lastTapRef.current;
                lastTapRef.current = now;

                if (dt < 300 && dt > 50 && !lightboxSwipeState.current.isSwiping) {
                  toggleZoom();
                  e.preventDefault();
                  return;
                }

                const dx = lightboxSwipeState.current.translateX;
                if (lightboxImageRef.current) {
                  const img = lightboxImageRef.current.firstChild as HTMLElement;
                  if (img) {
                    img.style.transition = 'transform 0.3s ease';
                    img.style.transform = `scale(${zoomScale})`;
                  }
                }
                if (Math.abs(dx) > 60 && !isZoomed) {
                  if (dx < 0) lightboxGoNext();
                  else lightboxGoPrev();
                }
                lightboxSwipeState.current.isSwiping = false;
                lightboxSwipeState.current.translateX = 0;
              }}
            >
              <Image
                src={imgErrors[lightboxIndex] ? PLACEHOLDER_IMAGE : (images[lightboxIndex] || PLACEHOLDER_IMAGE)}
                alt={productName}
                width={800} height={800}
                className="max-w-[95vw] max-h-[90vh] object-contain transition-transform duration-300 ease-out"
                style={{ transform: `scale(${zoomScale})` }}
                draggable={false}
                priority
              />
            </div>
          </div>

          <button
            onClick={() => setLightboxOpen(false)}
            className="absolute top-4 right-4 w-12 h-12 flex items-center justify-center text-white bg-black/50 backdrop-blur-sm hover:bg-black/70 hover:text-white rounded-full z-30 transition-all border border-white/20 shadow-lg"
            aria-label="Close"
          >
            <X size={24} strokeWidth={2} />
          </button>

          {hasMultiple && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm text-white text-[12px] font-medium px-3 py-1.5 rounded-full z-30">
              <span className="font-semibold">{lightboxIndex + 1}</span>
              <span className="text-white/50 mx-1">/</span>
              <span>{images.length}</span>
            </div>
          )}

          {hasMultiple && images.length <= 10 && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2 z-30">
              {images.map((_, i) => (
                <button key={i} onClick={(e) => { e.stopPropagation(); setLightboxIndex(i); setIsZoomed(false); setZoomScale(1); }}
                  className={`rounded-full transition-all ${
                    i === lightboxIndex ? 'bg-white w-2.5 h-2.5' : 'bg-white/40 hover:bg-white/70 w-2 h-2'
                  }`} />
              ))}
            </div>
          )}

          {lightboxIndex > 0 && (
            <button onClick={(e) => { e.stopPropagation(); lightboxGoPrev(); }}
              className="absolute left-4 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center text-white/80 hover:text-white z-30 transition-all bg-black/40 backdrop-blur-sm hover:bg-black/60 rounded-full border border-white/15">
              <ChevronLeft size={22} strokeWidth={2.5} />
            </button>
          )}
          {lightboxIndex < images.length - 1 && (
            <button onClick={(e) => { e.stopPropagation(); lightboxGoNext(); }}
              className="absolute right-4 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center text-white/80 hover:text-white z-30 transition-all bg-black/40 backdrop-blur-sm hover:bg-black/60 rounded-full border border-white/15">
              <ChevronRight size={22} strokeWidth={2.5} />
            </button>
          )}

          {isZoomed && (
            <button onClick={(e) => { e.stopPropagation(); toggleZoom(); }}
              className="absolute bottom-6 right-6 w-10 h-10 flex items-center justify-center text-white/80 hover:text-white z-30 transition-all bg-black/50 backdrop-blur-sm rounded-full border border-white/20"
              aria-label="Zoom out">
              <ZoomOut size={20} />
            </button>
          )}

          {!isZoomed && (
            <button onClick={(e) => { e.stopPropagation(); toggleZoom(); }}
              className="absolute bottom-6 right-6 w-10 h-10 flex items-center justify-center text-white/80 hover:text-white z-30 transition-all bg-black/50 backdrop-blur-sm rounded-full border border-white/20"
              aria-label="Zoom in">
              <ZoomIn size={20} />
            </button>
          )}
        </div>
      )}
    </>
  );
}
