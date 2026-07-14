"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Image from 'next/image';
import { PLACEHOLDER_IMAGE } from "@/lib/constants";

interface Slide {
  image: string;
  link?: string;
  alt?: string;
}

export default function HeroSlideshow({ slides }: { slides: Slide[] }) {
  const [currentSlide, setCurrentSlide] = useState(0);

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev === slides.length - 1 ? 0 : prev + 1));
  };

  const prevSlide = () => {
    setCurrentSlide((prev) => (prev === 0 ? slides.length - 1 : prev - 1));
  };

  // Preload next slide via native Image constructor — only render active slide
  useEffect(() => {
    if (slides.length <= 1) return;
    const next = (currentSlide + 1) % slides.length;
    const img = new window.Image();
    img.src = slides[next].image;
  }, [currentSlide, slides]);

  useEffect(() => {
    const timer = setInterval(() => {
      nextSlide();
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  return (
    <>
      {slides.map((slide, index) => {
        const isActive = index === currentSlide;
        const href = (slide as { link?: string }).link;
        const inner = isActive ? (
          <Image
            src={slide.image || PLACEHOLDER_IMAGE}
            alt={slide.alt || `Promotional banner ${index + 1}`}
            fill
            sizes="(max-width: 768px) 100vw, 66vw"
            priority={index === 0}
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gray-100" />
        );
        return (
          <div
            key={index}
            className={`absolute inset-0 transition-opacity duration-700 ease-in-out ${isActive ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
          >
            {href ? (
              <Link href={href} aria-label={slide.alt || `Slide ${index + 1}`} className="relative block w-full h-full">{inner}</Link>
            ) : (
              inner
            )}
          </div>
        );
      })}

      {/* Slider Controls - Desktop only */}
      {slides.length > 1 && (
        <div className="hidden md:flex absolute inset-x-0 inset-y-0 items-center justify-between px-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20 pointer-events-none">
          <button
            onClick={prevSlide}
            aria-label="Previous slide"
            className="w-10 h-10 rounded-full bg-white/80 text-gray-800 flex items-center justify-center hover:bg-white transition-colors shadow-sm pointer-events-auto"
          >
            <ChevronLeft size={20} />
          </button>
          <button
            onClick={nextSlide}
            aria-label="Next slide"
            className="w-10 h-10 rounded-full bg-white/80 text-gray-800 flex items-center justify-center hover:bg-white transition-colors shadow-sm pointer-events-auto"
          >
            <ChevronRight size={20} />
          </button>
        </div>
      )}

      {/* Pagination Dots */}
      {slides.length > 1 && (
        <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-3 z-20">
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentSlide(index)}
              aria-label={`Go to slide ${index + 1}`}
              className="flex items-center justify-center w-6 h-6"
            >
              <span className={`block rounded-full transition-all ${index === currentSlide ? 'bg-white w-4 h-2' : 'bg-white/50 hover:bg-white/80 w-2 h-2'}`} />
            </button>
          ))}
        </div>
      )}
    </>
  );
}
