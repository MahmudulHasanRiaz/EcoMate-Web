"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { ShoppingCart, Menu, Search, ClipboardList, User, Heart, MoreVertical, ChevronDown } from "lucide-react";
import { motion } from "motion/react";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { StoreBrand } from "./StoreBrand";



export default function Header() {
  const { cartCount, setIsCartOpen } = useCart();
  const { user } = useAuth();
  const router = useRouter();
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);
  const { config } = useStorefrontConfig();
  const navItems = config.navigation?.items?.length ? config.navigation.items : [];

  const [menuCategories, setMenuCategories] = useState<any[]>([])

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || '/api'}/categories/menu`)
      .then(res => res.json())
      .then(data => {
        const cats = data.data || data || []
        setMenuCategories(Array.isArray(cats) ? cats : [])
      })
      .catch(() => {})
  }, [])

  const allNavItems = useMemo(() => {
    const items = [...(config.navigation?.items || [])]
    for (const cat of menuCategories) {
      const exists = items.some(i => i.href === `/products?categoryId=${cat.id}`)
      if (!exists) {
        items.push({
          name: cat.name,
          href: `/products?categoryId=${cat.id}`,
        })
      }
    }
    return items
  }, [config.navigation?.items, menuCategories])

  return (
    <header className="sticky top-0 z-50 w-full glass border-b border-white/20">
      {/* Main Header Row */}
      <div className="max-w-screen-xl mx-auto px-3 py-2 md:px-4 md:py-4">
        <div className="flex items-center justify-between gap-2 md:gap-8 min-h-[36px] md:min-h-[44px]">
          
          {/* Logo Section */}
          <div className="flex items-center gap-3">
            <button 
              onClick={() => {
                window.dispatchEvent(new CustomEvent('open-mobile-menu'));
              }}
              className="p-1.5 -ml-1.5 text-gray-800 hover:bg-gray-100/50 rounded-full transition-colors md:hidden"
            >
              <Menu size={20} strokeWidth={2} />
            </button>

            <motion.div 
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="flex flex-shrink-0 items-center cursor-pointer"
              onClick={() => router.push('/')}
            >
              <StoreBrand />
            </motion.div>
          </div>

          {/* Search Bar - Desktop Centered */}
          <div className="hidden md:flex flex-1 max-w-lg mx-auto">
            <div className="relative flex items-center w-full h-[42px] rounded-[14px] border border-gray-200/50 bg-gray-50/50 focus-within:bg-white focus-within:border-brand-blue focus-within:ring-4 focus-within:ring-brand-blue/10 transition-all">
              <input
                type="text"
                placeholder="Search products..."
                className="w-full h-full pl-5 pr-10 outline-none text-[14px] bg-transparent text-gray-800 font-medium rounded-[14px]"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                    router.push(`/products?search=${encodeURIComponent((e.target as HTMLInputElement).value)}`);
                  }
                }}
              />
              <div className="absolute right-4 text-brand-blue pointer-events-none">
                <Search size={18} strokeWidth={2.5} />
              </div>
            </div>
          </div>

          {/* Action Icons - Right */}
          <div className="flex items-center gap-1 md:gap-5">
            {/* Desktop Only Icons */}
            <HeaderAction 
              icon={<ClipboardList size={22} />} 
              label="Track Order" 
              hideOnMobile 
              onClick={() => router.push('/orders')}
            />
            {user ? (
              <HeaderAction 
                icon={<div className="w-6 h-6 bg-brand-blue/20 text-brand-blue rounded-full flex items-center justify-center text-[11px] font-bold">{user.name[0].toUpperCase()}</div>} 
                label={user.name.split(' ')[0]}
                hideOnMobile
                onClick={() => router.push('/account')}
              />
            ) : (
              <HeaderAction 
                icon={<User size={22} />} 
                label="Sign In" 
                hideOnMobile 
                onClick={() => router.push('/account')}
              />
            )}
            <HeaderAction 
              icon={<Heart size={22} />} 
              label="Wishlist" 
              hideOnMobile 
              onClick={() => router.push('/wishlist')}
            />
            
            {/* Action Group for Mobile (Search + Cart) */}
            <div className="flex items-center gap-2 md:gap-0">
              {/* Mobile Search Icon */}
              <button 
                className="p-2 md:hidden text-gray-800 bg-gray-50 rounded-full hover:bg-gray-100 transition-colors"
                onClick={() => setIsMobileSearchOpen(!isMobileSearchOpen)}
              >
                <Search size={18} strokeWidth={2} />
              </button>

              {/* Cart Icon - Visible on Both */}
              <button 
                onClick={() => setIsCartOpen(true)}
                className="flex flex-col items-center group relative text-gray-800 md:text-gray-600 gap-0.5 p-1 md:p-0"
              >
                <div className="relative">
                  <ShoppingCart size={22} className="stroke-[1.5]" />
                  <span className="absolute -top-1.5 -right-1.5 w-[16px] h-[16px] bg-brand-blue text-white text-[9px] flex items-center justify-center rounded-full font-bold shadow-sm">
                    {cartCount}
                  </span>
                </div>
                <span className="hidden md:block text-[11px] font-medium group-hover:text-brand-blue">Cart</span>
              </button>
            </div>

            <HeaderAction icon={<MoreVertical size={22} />} label="More" hideOnMobile />
          </div>
        </div>

        {/* Mobile Search Input Expansion */}
        {isMobileSearchOpen && (
          <div className="mt-3 md:hidden">
            <div className="relative flex items-center w-full h-[40px] rounded-full border border-brand-blue/50 bg-white shadow-sm transition-all focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/20">
              <input
                type="text"
                autoFocus
                placeholder="Search products..."
                className="w-full h-full pl-5 pr-10 outline-none text-[14px] bg-transparent text-gray-800 font-normal rounded-full"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                    router.push(`/products?search=${encodeURIComponent((e.target as HTMLInputElement).value)}`);
                    setIsMobileSearchOpen(false);
                  }
                }}
              />
              <div className="absolute right-3 text-brand-blue pointer-events-none">
                <Search size={18} strokeWidth={2} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Category Navigation - Desktop Only */}
      <div className="hidden md:block bg-[#1a1a1a] text-white border-b border-gray-200">
        <div className="max-w-screen-xl mx-auto px-4 h-10 flex items-center justify-between">
          <div className="flex items-center gap-5 overflow-x-auto whitespace-nowrap hide-scrollbar">
            {allNavItems.map((item, idx) => (
              <button 
                key={idx} 
                onClick={() => { if (item.href) router.push(item.href); }}
                className="text-[12px] font-medium hover:text-brand-blue transition-colors flex items-center gap-1 uppercase tracking-wide cursor-pointer"
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}

function HeaderAction({ icon, label, count, hideOnMobile, onClick }: { icon: React.ReactNode, label: string, count?: number, hideOnMobile?: boolean, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick || (() => {})}
      className={`${hideOnMobile ? 'hidden md:flex' : 'flex'} flex-col items-center text-gray-600 hover:text-brand-blue transition-colors group gap-0.5`}
    >
      <div className="relative">
        {icon}
        {count !== undefined && (
          <span className="absolute -top-1 -right-1 w-[15px] h-[15px] bg-brand-blue text-white text-[9px] flex items-center justify-center rounded-full font-bold">
            {count}
          </span>
        )}
      </div>
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}
