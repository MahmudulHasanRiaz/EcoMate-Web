"use client";

import React, { useEffect, useState } from 'react';
import { X, User, LogOut, ChevronRight, ChevronDown, HelpCircle, Heart, Calendar } from 'lucide-react';
import { motion, AnimatePresence } from "motion/react";
import Link from "next/link";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { useAuth } from "@/context/AuthContext";
import { usePathname } from "next/navigation";

export default function MobileMenu({}: {}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { config } = useStorefrontConfig();
  const { user, logout } = useAuth();
  const menuItems = config.menu?.mobile?.items || [];

  useEffect(() => {
    const handleOpen = () => setIsMobileMenuOpen(true);
    const handleClose = () => setIsMobileMenuOpen(false);
    window.addEventListener('open-mobile-menu', handleOpen);
    window.addEventListener('close-mobile-menu', handleClose);
    return () => {
      window.removeEventListener('open-mobile-menu', handleOpen);
      window.removeEventListener('close-mobile-menu', handleClose);
    };
  }, []);

  const closeMenu = () => {
    setIsMobileMenuOpen(false);
  };

  return (
    <>
      <div 
        className={`fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm md:hidden transition-opacity duration-300 ${
          isMobileMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsMobileMenuOpen(false)}
      >
        <button 
          onClick={() => setIsMobileMenuOpen(false)}
          className="absolute top-4 right-4 text-white hover:text-gray-200 transition-colors p-2 focus:outline-none"
          aria-label="Close menu"
        >
          <X size={32} strokeWidth={1.5} />
        </button>
      </div>

      <div className={`fixed top-0 left-0 h-full w-[85vw] max-w-[340px] bg-white z-[70] flex flex-col transform transition-transform duration-300 ease-out md:hidden shadow-2xl ${
        isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        
        {/* Header User Area */}
        <div className="p-4 pt-5">
          {user ? (
            <>
              <Link href="/account" onClick={closeMenu} className="block bg-brand-blue rounded-xl p-4 shadow-md transition-all active:scale-[0.98]">
                <div className="flex items-center gap-4">
                  <div className="w-[46px] h-[46px] bg-white rounded-full flex items-center justify-center shadow-inner shrink-0">
                    <span className="text-brand-blue text-[18px] font-bold">{(user.firstName?.[0] || user.email[0]).toUpperCase()}</span>
                  </div>
                  <div className="text-white min-w-0 pt-0.5">
                    <p className="text-[14px] opacity-90 font-light leading-snug truncate">Hello {user.firstName || 'there'}!</p>
                    <p className="text-[16px] font-medium leading-snug truncate">{user.email}</p>
                  </div>
                </div>
              </Link>
              <button
                onClick={() => { logout(); closeMenu(); }}
                className="w-full flex items-center justify-center gap-2 mt-3 py-2.5 text-[13px] text-white/70 hover:text-white bg-brand-blue/80 hover:bg-brand-blue rounded-lg transition-all active:scale-[0.98]"
              >
                <LogOut size={14} strokeWidth={1.5} />
                <span>Sign Out</span>
              </button>
            </>
          ) : (
            <Link href="/account" onClick={closeMenu} className="block bg-brand-blue rounded-xl p-4 shadow-md transition-all active:scale-[0.98]">
              <div className="flex items-center gap-4">
                <div className="w-[46px] h-[46px] bg-white rounded-full flex items-center justify-center shadow-inner shrink-0">
                  <User size={24} className="text-brand-blue fill-brand-blue" strokeWidth={1.5} />
                </div>
                <div className="text-white pt-0.5">
                  <p className="text-[14px] opacity-90 font-light leading-snug">Hello there!</p>
                  <p className="text-[16px] font-medium leading-snug">Sign in / Register</p>
                </div>
              </div>
            </Link>
          )}
        </div>

        {/* Links */}
        <div className="flex-1 overflow-y-auto pb-8 scrollbar-thin">
           <div className="px-4 mb-6">
             <div className="bg-[#fcfcfc] rounded-xl border border-gray-100/80 overflow-hidden shadow-sm">
                {menuItems.map((item, index) => (
                  <MobileNavItem key={item.id || item.label || index} item={item} onClose={closeMenu} />
                ))}
             </div>
           </div>

           {/* Quick Links */}
           <div className="px-4">
              <div className="mb-4 mt-2">
                <h3 className="text-[14px] font-semibold text-gray-600 block pb-1">
                  Quick Links
                </h3>
                <div className="w-[30px] h-[3px] bg-brand-blue rounded-full"></div>
              </div>
              
              <div className="bg-[#fcfcfc] rounded-xl overflow-hidden border border-gray-100/80 shadow-sm">
                <Link 
                  href="/orders"
                  onClick={closeMenu}
                  className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-brand-blue/[0.02] active:bg-gray-100 transition-all border-b border-gray-100/70 text-gray-700 hover:text-brand-blue"
                >
                  <Calendar size={18} strokeWidth={1.5} /> 
                  <span className="text-[13px] font-medium tracking-wide">Track Your Order</span>
                </Link>
                {config.licenseFeatures?.includes('storefront_wishlist') && (
                  <Link 
                    href="/wishlist" 
                    onClick={closeMenu} 
                    className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-brand-blue/[0.02] active:bg-gray-100 transition-all border-b border-gray-100/70 text-gray-700 hover:text-brand-blue"
                  >
                    <Heart size={18} strokeWidth={1.5} /> 
                    <span className="text-[13px] font-medium tracking-wide">My Wishlists</span>
                  </Link>
                )}
                <Link 
                  href="/faq" 
                  onClick={closeMenu} 
                  className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-brand-blue/[0.02] active:bg-gray-100 transition-all text-gray-700 hover:text-brand-blue"
                >
                  <HelpCircle size={18} strokeWidth={1.5} /> 
                  <span className="text-[13px] font-medium tracking-wide">F.A.Qs</span>
                </Link>
              </div>
           </div>
        </div>
      </div>
    </>
  );
}

function MobileNavItem({ item, onClose, level = 0 }: { item: any; onClose: () => void; level?: number }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const pathname = usePathname();
  const hasChildren = item.children?.length > 0;

  const getHref = (it: any) => {
    if (it.type === 'category') {
      if (it.slug) return `/products?category=${it.slug}`;
      return `/products?categoryId=${it.categoryId || it.id}`;
    }
    return it.url || '/';
  };

  const href = getHref(item);
  const isActive = pathname === href;

  if (!hasChildren) {
    return (
      <Link 
        href={href}
        onClick={onClose}
        className={`w-full flex items-center text-left justify-between px-4 py-[13px] transition-all active:bg-gray-100 border-b border-gray-100/50 last:border-0 ${
          isActive 
            ? 'bg-brand-blue/[0.04] text-brand-blue font-medium border-l-[3px] border-brand-blue pl-[13px]' 
            : 'text-gray-700 hover:text-brand-blue hover:bg-brand-blue/[0.02]'
        }`}
        style={{ paddingLeft: isActive ? undefined : `${16 + level * 16}px` }}
      >
        <span className="text-[13px]">{item.label || item.name}</span>
        <ChevronRight size={14} className="opacity-40" />
      </Link>
    );
  }

  return (
    <div className="border-b border-gray-100/50 last:border-0">
      <div
        className={`flex items-center justify-between transition-all ${
          isExpanded
            ? 'bg-gray-50/80 text-brand-blue font-medium'
            : 'text-gray-700'
        }`}
        style={{ paddingLeft: `${16 + level * 16}px` }}
      >
        <Link
          href={href}
          onClick={onClose}
          className={`flex-1 py-[13px] pr-2 transition-all active:bg-gray-100 ${
            isExpanded ? 'text-brand-blue font-medium' : 'hover:text-brand-blue'
          }`}
        >
          <span className="text-[13px]">{item.label || item.name}</span>
        </Link>
        <button
          onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
          className={`px-3 py-[13px] transition-all active:bg-gray-100 ${
            isExpanded ? 'text-brand-blue' : 'text-gray-400 hover:text-brand-blue'
          }`}
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
        >
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
            strokeWidth={2}
          />
        </button>
      </div>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key={item.label || item.name}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden bg-gray-50/30"
          >
            <div className="border-l border-gray-100/80 ml-4 my-1">
              {item.children.map((child: any, i: number) => (
                <MobileNavItem key={child.id || child.label || i} item={child} onClose={onClose} level={level + 1} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
