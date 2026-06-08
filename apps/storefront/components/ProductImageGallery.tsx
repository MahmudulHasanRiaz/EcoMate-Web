"use client";

import { useState, useRef, useCallback, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { PLACEHOLDER_IMAGE } from "@/lib/constants";

interface Props {
  images: string[];
  productName: string;
}

export function ProductImageGallery({ images, productName }: Props) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [imgErrors, setImgErrors] = useState<Record<number, boolean>>({});
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [zoomPos, setZoomPos] = useState({ x: 50, y: 50 });
  const [isHovered, setIsHovered] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!mainRef.current || isMobile) return;
    const rect = mainRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setZoomPos({ x: Math.min(100, Math.max(0, x)), y: Math.min(100, Math.max(0, y)) });
  }, [isMobile]);

  const handlePrev = useCallback(() => {
    setActiveIndex(prev => (prev === 0 ? images.length - 1 : prev - 1));
  }, [images.length]);

  const handleNext = useCallback(() => {
    setActiveIndex(prev => (prev === images.length - 1 ? 0 : prev + 1));
  }, [images.length]);

  const currentSrc = imgErrors[activeIndex] ? PLACEHOLDER_IMAGE : (images[activeIndex] || PLACEHOLDER_IMAGE);

  return (
    <>
      <div className="flex gap-4 md:gap-6 flex-row md:w-1/2">
        <div className="flex flex-col gap-3 w-[60px] md:w-[80px] flex-shrink-0">
          {images.map((img, i) => (
            <button key={i} onClick={() => setActiveIndex(i)}
              className={`w-full aspect-square border rounded-[4px] overflow-hidden flex items-center justify-center p-1 transition-colors ${activeIndex === i ? 'border-brand-blue' : 'border-gray-200'}`}>
              <img
                src={imgErrors[i] ? PLACEHOLDER_IMAGE : (img || PLACEHOLDER_IMAGE)}
                alt=""
                className="w-full h-full object-contain"
                onError={() => setImgErrors(prev => ({ ...prev, [i]: true }))}
              />
            </button>
          ))}
        </div>

        <div
          ref={mainRef}
          className="flex-1 border border-gray-100 rounded-[4px] relative aspect-square overflow-hidden cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseEnter={() => !isMobile && setIsHovered(true)}
          onMouseLeave={() => { setIsHovered(false); setZoomPos({ x: 50, y: 50 }); }}
          onClick={() => setLightboxOpen(true)}
        >
          <button className="absolute left-2 w-8 h-8 flex items-center justify-center text-blue-500 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100 transition-opacity z-10"
            onClick={e => { e.stopPropagation(); handlePrev(); }}>
            <ChevronLeft size={24} strokeWidth={1.5} />
          </button>

          <img
            src={currentSrc}
            alt={productName}
            className="w-full h-full object-contain transition-transform duration-200 ease-out"
            style={{
              transform: isHovered ? 'scale(1.5)' : 'scale(1)',
              transformOrigin: `${zoomPos.x}% ${zoomPos.y}%`,
              touchAction: 'pinch-zoom',
            }}
            onError={() => setImgErrors(prev => ({ ...prev, [activeIndex]: true }))}
          />

          <button className="absolute right-2 w-8 h-8 flex items-center justify-center text-blue-500 top-1/2 -translate-y-1/2 opacity-70 hover:opacity-100 transition-opacity z-10"
            onClick={e => { e.stopPropagation(); handleNext(); }}>
            <ChevronRight size={24} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {lightboxOpen && (
        <div className="fixed inset-0 z-[100] bg-black/90 flex items-center justify-center" onClick={() => setLightboxOpen(false)}>
          <button onClick={() => setLightboxOpen(false)} className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center text-white/80 hover:text-white z-20 transition-colors">
            <X size={28} />
          </button>

          <button onClick={e => { e.stopPropagation(); handlePrev(); }} className="absolute left-4 w-10 h-10 flex items-center justify-center text-white/80 hover:text-white z-20 transition-colors">
            <ChevronLeft size={32} />
          </button>

          <img
            src={currentSrc}
            alt={productName}
            className="max-w-[90vw] max-h-[90vh] object-contain"
            onClick={e => e.stopPropagation()}
          />

          <button onClick={e => { e.stopPropagation(); handleNext(); }} className="absolute right-4 w-10 h-10 flex items-center justify-center text-white/80 hover:text-white z-20 transition-colors">
            <ChevronRight size={32} />
          </button>
        </div>
      )}
    </>
  );
}
