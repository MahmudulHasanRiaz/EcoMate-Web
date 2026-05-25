"use client";

import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";

const FALLBACK_SLIDES = [
  "https://images.unsplash.com/photo-1510557880182-3d4d3cba3f21?auto=format&fit=crop&q=80&w=1600",
  "https://images.unsplash.com/photo-1616348436168-de43ad0db179?auto=format&fit=crop&q=80&w=1600",
  "https://images.unsplash.com/photo-1593642632823-8f785ba67e45?auto=format&fit=crop&q=80&w=1600"
];

const PLACEHOLDER_IMAGE = "https://placehold.co/600x600/f8f9fa/a0aec0?text=No+Image";

export default function Hero() {
  const { config } = useStorefrontConfig();
  const slides = config.hero.slides.length > 0
    ? config.hero.slides.map(s => s.image)
    : FALLBACK_SLIDES;

  const [imgErrors, setImgErrors] = useState<{ [key: string]: boolean }>({});
  const [currentSlide, setCurrentSlide] = useState(0);

  const handleImageError = (id: string) => {
    setImgErrors(prev => ({ ...prev, [id]: true }));
  };

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev === 0 ? slides.length - 1 : prev - 1));
  };

  useEffect(() => {
    const timer = setInterval(() => {
      nextSlide();
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  return (
    <section className="w-full bg-[#fcfcfc] py-2 md:py-6">
      <div className="max-w-7xl mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
          
          {/* Main Banner (col-8) */}
          <div className="md:col-span-8 overflow-hidden rounded-[12px] md:rounded-[20px] shadow-sm bg-white relative group">
            <div className="relative w-full h-[180px] md:h-[400px]">
              {slides.map((slide, index) => (
                <div 
                  key={index} 
                  className={`absolute inset-0 transition-opacity duration-700 ease-in-out ${index === currentSlide ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
                >
                  <img
                    src={imgErrors[`banner-${index}`] ? PLACEHOLDER_IMAGE : slide}
                    alt={`Banner ${index + 1}`}
                    className="w-full h-full object-cover"
                    onError={() => handleImageError(`banner-${index}`)}
                  />
                </div>
              ))}
            </div>
            
            {/* Slider Controls */}
            <div className="absolute inset-x-0 inset-y-0 flex items-center justify-between px-2 md:px-4 opacity-100 md:opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20 pointer-events-none">
              <button 
                onClick={prevSlide}
                className="w-7 h-7 md:w-10 md:h-10 rounded-full bg-white/80 text-gray-800 flex items-center justify-center hover:bg-white transition-colors shadow-sm pointer-events-auto"
              >
                <ChevronLeft size={18} className="md:hidden" />
                <ChevronLeft size={20} className="hidden md:block" />
              </button>
              <button 
                onClick={nextSlide}
                className="w-7 h-7 md:w-10 md:h-10 rounded-full bg-white/80 text-gray-800 flex items-center justify-center hover:bg-white transition-colors shadow-sm pointer-events-auto"
              >
                <ChevronRight size={18} className="md:hidden" />
                <ChevronRight size={20} className="hidden md:block" />
              </button>
            </div>

            {/* Pagination Dots */}
            <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-2 z-20">
              {slides.map((_, index) => (
                <button
                  key={index}
                  onClick={() => setCurrentSlide(index)}
                  className={`w-2 h-2 rounded-full transition-all ${index === currentSlide ? 'bg-white w-4' : 'bg-white/50 hover:bg-white/80'}`}
                />
              ))}
            </div>
          </div>

          {/* Secondary Banner (col-4) */}
          <div className="hidden md:block md:col-span-4 overflow-hidden rounded-[20px] shadow-sm bg-white">
            <div className="relative w-full h-[400px]">
               <img 
                  src={imgErrors['banner-sec'] ? PLACEHOLDER_IMAGE : (config.hero.secondaryBanner || "https://images.unsplash.com/photo-1468495244123-6c6c332eeece?auto=format&fit=crop&q=80&w=800")} 
                  alt="Banner Secondary"
                 className="w-full h-full object-cover"
                 onError={() => handleImageError('banner-sec')}
               />
            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
