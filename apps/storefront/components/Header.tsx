"use client";

import React, { useState, useRef, useEffect } from 'react';
import { ShoppingCart, Menu, Search, ClipboardList, User, Heart, MoreVertical, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { StoreBrand } from "./StoreBrand";

export default function Header({}: {}) {
  const { cartCount, setIsCartOpen } = useCart();
  const { user } = useAuth();
  const router = useRouter();
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const { config } = useStorefrontConfig();

  const navItems = config.menu?.header?.items || [];

  return (
    <header className="sticky top-0 z-50 w-full bg-white border-b border-gray-100">
      {/* Main Header Row */}
      <div className="max-w-screen-xl mx-auto px-3 py-2 md:px-4 md:py-3">
        <div className="flex items-center justify-between gap-2 md:gap-8 min-h-[36px] md:min-h-[44px]">
          
          {/* Logo Section */}
          <div className="flex items-center gap-3">
            <button 
              onClick={() => {
                window.dispatchEvent(new CustomEvent('open-mobile-menu'));
              }}
              className="p-1.5 -ml-1.5 text-gray-700 hover:bg-gray-100 rounded-full transition-colors md:hidden"
            >
              <Menu size={20} strokeWidth={2} />
            </button>

            <Link href="/">
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
            <div className="relative flex items-center w-full h-[40px] rounded-full border border-gray-200 bg-gray-50 focus-within:bg-white focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/10 transition-all">
              <input
                type="text"
                placeholder="Search products..."
                className="w-full h-full pl-5 pr-10 outline-none text-[14px] bg-transparent text-gray-700 font-medium rounded-full"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                    router.push(`/products?search=${encodeURIComponent((e.target as HTMLInputElement).value)}`);
                  }
                }}
              />
              <div className="absolute right-3 text-brand-blue pointer-events-none">
                <Search size={18} strokeWidth={2} />
              </div>
            </div>
          </div>

          {/* Action Icons - Right */}
          <div className="flex items-center gap-1 md:gap-5">
            <HeaderAction icon={<ClipboardList size={20} />} label="Track Order" hideOnMobile href="/orders" />
            {user ? (
              <HeaderAction icon={<div className="w-6 h-6 bg-brand-blue/10 text-brand-blue rounded-full flex items-center justify-center text-[11px] font-bold">{user.name[0].toUpperCase()}</div>} label={user.name.split(' ')[0]} hideOnMobile href="/account" />
            ) : (
              <HeaderAction icon={<User size={20} />} label="Sign In" hideOnMobile href="/account" />
            )}
            <HeaderAction icon={<Heart size={20} />} label="Wishlist" hideOnMobile href="/wishlist" />
            
            <div className="flex items-center gap-1 md:gap-2">
              <button 
                className="p-2 md:hidden text-gray-600 bg-gray-50 rounded-full hover:bg-gray-100 transition-colors"
                onClick={() => setIsMobileSearchOpen(!isMobileSearchOpen)}
              >
                <Search size={18} strokeWidth={2} />
              </button>

              <button 
                onClick={() => setIsCartOpen(true)}
                className="flex flex-col items-center group relative text-gray-600 gap-0.5 p-1 md:p-0"
              >
                <div className="relative">
                  <ShoppingCart size={20} className="stroke-[1.5]" />
                  <span className="absolute -top-1.5 -right-1.5 w-[16px] h-[16px] bg-brand-blue text-white text-[9px] flex items-center justify-center rounded-full font-bold shadow-sm">
                    {cartCount}
                  </span>
                </div>
                <span className="hidden md:block text-[11px] font-medium group-hover:text-brand-blue">Cart</span>
              </button>
            </div>

            <HeaderAction icon={<MoreVertical size={20} />} label="More" hideOnMobile />
          </div>
        </div>

        {/* Mobile Search */}
        {isMobileSearchOpen && (
          <div className="mt-3 md:hidden">
            <div className="relative flex items-center w-full h-[40px] rounded-full border border-brand-blue/50 bg-white shadow-sm">
              <input autoFocus type="text" placeholder="Search products..."
                className="w-full h-full pl-5 pr-10 outline-none text-[14px] bg-transparent text-gray-700 font-normal rounded-full"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                    router.push(`/products?search=${encodeURIComponent((e.target as HTMLInputElement).value)}`);
                    setIsMobileSearchOpen(false);
                  }
                }} />
              <div className="absolute right-3 text-brand-blue pointer-events-none">
                <Search size={18} strokeWidth={2} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Desktop Navigation - Modern Minimal */}
      {navItems.length > 0 && (
        <div className="hidden md:block border-t border-gray-100">
          <div className="max-w-screen-xl mx-auto px-4">
            <nav className="flex items-center gap-0.5 h-11">
              {navItems.map((item: any) => (
                <NavItem key={item.id} item={item} />
              ))}
            </nav>
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
    if (it.type === 'category') return `/products?category=${it.categoryId || it.id}`;
    return it.url || '/';
  };

  const hasChildren = item.children?.length > 0;

  return (
    <div className="relative" onMouseEnter={show} onMouseLeave={hide}>
      <Link
        href={getHref(item)}
        className="flex items-center gap-1 px-3 py-1.5 text-[13px] font-medium text-gray-600 hover:text-brand-blue transition-colors rounded-md hover:bg-brand-blue/5"
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
    if (it.type === 'category') return `/products?category=${it.categoryId || it.id}`;
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
