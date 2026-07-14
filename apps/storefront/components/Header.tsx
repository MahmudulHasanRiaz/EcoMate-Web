"use client";

import React, { useState, useRef, useEffect } from 'react';
import { ShoppingCart, Menu, ClipboardList, User, Heart, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { usePathname } from "next/navigation";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { StoreBrand } from "./StoreBrand";
import Link from 'next/link';
import { HeaderSearch } from "./HeaderSearch";

export default function Header({}: {}) {
  const pathname = usePathname();
  const { cartCount } = useCart();
  const { user } = useAuth();
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const { config } = useStorefrontConfig();

  useEffect(() => {
    const handler = () => setIsMobileSearchOpen(true);
    window.addEventListener('open-mobile-search', handler);
    return () => window.removeEventListener('open-mobile-search', handler);
  }, []);

  if (pathname && pathname.startsWith('/checkout')) return null;

  const navItems = config.menu?.header?.items || [];

  return (
    <header className="sticky top-0 z-50 w-full bg-white border-b border-gray-100">
      {/* Top Brand Accent Bar */}
      <div className="h-[3px] w-full bg-gradient-to-r from-brand-blue/40 via-brand-blue to-brand-blue/40" />

      {/* Main Header Row */}
      <div className="max-w-screen-xl mx-auto px-3 py-1 md:px-4 md:py-3">
        <div className="flex items-center justify-between gap-2 md:gap-8 min-h-[32px] md:min-h-[44px]">

          {/* Mobile: Hamburger (left) */}
          <div className="flex md:hidden items-center">
            <button
              onClick={() => {
                window.dispatchEvent(new CustomEvent('open-mobile-menu'));
              }}
              aria-label="Open menu"
              className="p-1.5 -ml-1.5 text-gray-700 hover:bg-gray-100 rounded-full transition-colors"
            >
              <Menu size={20} strokeWidth={2} />
            </button>
          </div>

          {/* Logo - Centered on mobile, left on desktop */}
          <div className="flex items-center md:flex-none">
            <Link href="/" className="mx-auto md:mx-0">
              <motion.div
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                className="flex flex-shrink-0 items-center cursor-pointer"
              >
                <StoreBrand />
              </motion.div>
            </Link>
          </div>

          {/* Search Bar - Desktop Centered */}
          <div className="hidden md:flex flex-1 max-w-lg mx-auto">
            <HeaderSearch />
          </div>

          {/* Action Icons - Right */}
          <div className="flex items-center gap-1 md:gap-5">
            <HeaderAction icon={<ClipboardList size={20} />} label="Track Order" hideOnMobile href="/orders" />
            {user ? (
              <HeaderAction icon={<div className="w-6 h-6 bg-brand-blue/10 text-brand-blue rounded-full flex items-center justify-center text-[11px] font-bold">{(user.firstName?.[0] || user.email[0]).toUpperCase()}</div>} label={user.firstName || 'Account'} hideOnMobile href="/account" />
            ) : (
              <HeaderAction icon={<User size={20} />} label="Sign In" hideOnMobile href="/account" />
            )}
            {config.licenseFeatures?.includes('storefront_wishlist') && (
              <HeaderAction icon={<Heart size={20} />} label="Wishlist" hideOnMobile href="/wishlist" />
            )}

            <div className="flex items-center gap-1 md:gap-2">
              <Link
                href="/cart"
                className="flex flex-col items-center group relative text-gray-600 gap-0.5 p-1 md:p-0"
              >
                <div className="relative">
                  <ShoppingCart size={20} className="stroke-[1.5]" />
                  <span className="absolute -top-1.5 -right-1.5 w-[16px] h-[16px] bg-brand-blue text-white text-[9px] flex items-center justify-center rounded-full font-bold shadow-sm">
                    {cartCount}
                  </span>
                </div>
                <span className="hidden md:block text-[11px] font-medium group-hover:text-brand-blue">Cart</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Mobile Search */}
        {isMobileSearchOpen && (
          <div className="mt-3 md:hidden">
            <HeaderSearch onCloseMobile={() => setIsMobileSearchOpen(false)} />
          </div>
        )}
      </div>

      {/* Desktop Navigation - Modern Auto-Sliding */}
      {navItems.length > 0 && (
        <div className="hidden md:block bg-brand-blue/[0.03] border-t border-brand-blue/10">
          <div className="max-w-screen-xl mx-auto px-4">
            <NavSlider>
              {navItems.map((item: any) => (
                <NavItem key={item.id} item={item} />
              ))}
            </NavSlider>
          </div>
        </div>
      )}
    </header>
  );
}

function NavItem({ item }: { item: any }) {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setIsOpen(true);
  };

  const hide = () => {
    closeTimer.current = setTimeout(() => setIsOpen(false), 150);
  };

  useEffect(() => {
    return () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  }, []);

  const getHref = (it: any) => {
    if (it.type === 'category') {
      if (it.slug) return `/products?category=${it.slug}`;
      if (it.categoryId) return `/products?categoryId=${it.categoryId}`;
    }
    return it.url || '/';
  };

  const hasChildren = item.children?.length > 0;

  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={hide}>
      <Link
        href={getHref(item)}
        className={`flex items-center gap-1 px-3 py-2 text-[14px] font-medium transition-colors whitespace-nowrap rounded-md ${
          isOpen ? 'text-brand-blue bg-white shadow-sm' : 'text-gray-700 hover:text-brand-blue hover:bg-brand-blue/5'
        }`}
      >
        {item.label}
        {hasChildren && (
          <ChevronDown size={13} className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        )}
      </Link>

      <AnimatePresence>
        {hasChildren && isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scaleY: 0.95 }}
            animate={{ opacity: 1, y: 0, scaleY: 1 }}
            exit={{ opacity: 0, y: -4, scaleY: 0.95 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className="absolute top-full left-0 pt-2 z-50 origin-top"
            onMouseEnter={show} onMouseLeave={hide}
          >
            <div className="bg-white rounded-xl shadow-lg border border-gray-100 py-1.5 min-w-[200px]">
              {item.children.map((child: any) => (
                <SubMenuItem key={child.id} item={child} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function SubMenuItem({ item }: { item: any }) {
  const [isOpen, setIsOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setIsOpen(true);
  };

  const hide = () => {
    closeTimer.current = setTimeout(() => setIsOpen(false), 150);
  };

  useEffect(() => {
    return () => { if (closeTimer.current) clearTimeout(closeTimer.current); };
  }, []);

  const getHref = (it: any) => {
    if (it.type === 'category') {
      if (it.slug) return `/products?category=${it.slug}`;
      if (it.categoryId) return `/products?categoryId=${it.categoryId}`;
    }
    return it.url || '/';
  };

  const hasChildren = item.children?.length > 0;

  if (hasChildren) {
    return (
      <div className="relative" onMouseEnter={show} onMouseLeave={hide}>
        <Link
          href={getHref(item)}
          className="flex items-center justify-between gap-4 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-brand-blue transition-colors rounded-none"
        >
          <span>{item.label}</span>
          <ChevronDown size={13} className="-rotate-90 text-gray-400 shrink-0" />
        </Link>
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, x: -6, scaleX: 0.95 }}
              animate={{ opacity: 1, x: 0, scaleX: 1 }}
              exit={{ opacity: 0, x: -6, scaleX: 0.95 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="absolute top-0 left-full ml-1 z-50 origin-left"
              onMouseEnter={show} onMouseLeave={hide}
            >
              <div className="bg-white rounded-xl shadow-lg border border-gray-100 py-1.5 min-w-[200px]">
                {item.children.map((child: any) => (
                  <SubMenuItem key={child.id} item={child} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <Link
      href={getHref(item)}
      className="block px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-brand-blue transition-colors rounded-none"
    >
      {item.label}
    </Link>
  );
}

function HeaderAction({ icon, label, count, hideOnMobile, onClick, href }: { icon: React.ReactNode, label: string, count?: number, hideOnMobile?: boolean, onClick?: () => void, href?: string }) {
  const content = (
    <>
      <div className="relative">
        {icon}
        {count !== undefined && (
          <span className="absolute -top-1 -right-1 w-[15px] h-[15px] bg-brand-blue text-white text-[9px] flex items-center justify-center rounded-full font-bold">
            {count}
          </span>
        )}
      </div>
      <span className="text-[11px] font-medium">{label}</span>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={`${hideOnMobile ? 'hidden md:flex' : 'flex'} flex-col items-center text-gray-600 hover:text-brand-blue transition-colors group gap-0.5`}>
        {content}
      </Link>
    );
  }

  return (
    <button 
      onClick={onClick || (() => {})}
      className={`${hideOnMobile ? 'hidden md:flex' : 'flex'} flex-col items-center text-gray-600 hover:text-brand-blue transition-colors group gap-0.5`}
    >
      {content}
    </button>
  );
}

function NavSlider({ children }: { children: React.ReactNode }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  
  // Use a ref so the animation loop reads the live value instantly,
  // without waiting for a React re-render cycle.
  const isHoveredRef = useRef(false);
  
  const currentX = useRef(0);
  const startX = useRef(0);
  const initialX = useRef(0);
  const speed = useRef(0.5); // pixels per frame
  const isPointerDown = useRef(false);
  const didDrag = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    const track = trackRef.current;
    if (!container || !track) return;

    let animationFrameId: number;
    let cachedMaxScroll = track.scrollWidth - container.clientWidth;
    let isPageVisible = !document.hidden;

    const onVisibilityChange = () => {
      isPageVisible = !document.hidden;
      if (document.hidden) {
        cancelAnimationFrame(animationFrameId);
      } else {
        // Recalc layout on return — dimensions may have changed
        cachedMaxScroll = (track?.scrollWidth ?? 0) - (container?.clientWidth ?? 0);
        animationFrameId = requestAnimationFrame(step);
      }
    };

    const onResize = () => {
      cachedMaxScroll = (track?.scrollWidth ?? 0) - (container?.clientWidth ?? 0);
    };

    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    document.addEventListener('visibilitychange', onVisibilityChange);

    const step = () => {
      if (isPageVisible && !isHoveredRef.current && !isPointerDown.current) {
        if (cachedMaxScroll > 0) {
          currentX.current -= speed.current; // Move left

          if (-currentX.current >= cachedMaxScroll) {
            speed.current = -0.5; // Reverse to right
            currentX.current = -cachedMaxScroll;
          } else if (currentX.current <= 0 && -currentX.current <= 0) {
            speed.current = 0.5; // Reverse to left
            currentX.current = 0;
          }

          track.style.transform = `translateX(${currentX.current}px)`;
        } else {
          currentX.current = 0;
          track.style.transform = `translateX(0px)`;
        }
      }
      animationFrameId = requestAnimationFrame(step);
    };

    animationFrameId = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(animationFrameId);
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    isPointerDown.current = true;
    didDrag.current = false;
    startX.current = e.clientX;
    initialX.current = currentX.current;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isPointerDown.current) return;
    const track = trackRef.current;
    const container = containerRef.current;
    if (!track || !container) return;

    const dx = e.clientX - startX.current;
    if (Math.abs(dx) > 10) {
      if (!didDrag.current) {
        didDrag.current = true;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch (err) {
          // ignore
        }
      }
    }

    let newX = initialX.current + dx;
    
    const maxScroll = track.scrollWidth - container.clientWidth;
    if (maxScroll > 0) {
       if (newX > 0) newX = 0;
       if (newX < -maxScroll) newX = -maxScroll;
       currentX.current = newX;
       track.style.transform = `translateX(${newX}px)`;
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    isPointerDown.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (err) {
        // ignore
      }
    }
    setTimeout(() => { didDrag.current = false; }, 50);
  };

  return (
    <div 
      className="relative w-full flex items-center min-h-[44px]"
      style={{ overflowX: 'clip', overflowY: 'visible' }}
      onMouseEnter={() => { isHoveredRef.current = true; }}
      onMouseLeave={() => {
        isHoveredRef.current = false;
        isPointerDown.current = false;
        didDrag.current = false;
      }}
    >
      <div 
        ref={containerRef}
        className="w-full relative"
      >
        <div 
          ref={trackRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onClickCapture={(e) => {
            // Only block the click if the user actually dragged (moved 10px+).
            // didDrag is only set to true inside handlePointerMove when dx > 10.
            if (didDrag.current) {
              e.stopPropagation();
              e.preventDefault();
            }
          }}
          className={`flex items-center gap-1 w-max py-1.5 cursor-grab active:cursor-grabbing touch-pan-y`}
          style={{ willChange: 'transform' }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
