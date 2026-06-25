"use client";

import React, { useEffect, useState } from 'react';
import { X, User, ChevronRight, ChevronDown, HelpCircle, Heart, Calendar } from 'lucide-react';
import { motion, AnimatePresence } from "motion/react";
import Link from "next/link";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";

export default function MobileMenu({}: {}) {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { config } = useStorefrontConfig();
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
        className={`fixed inset-0 bg-black/60 z-[60] backdrop-blur-sm md:hidden transition-opacity ${
          isMobileMenuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setIsMobileMenuOpen(false)}
      >
        <button 
          onClick={() => setIsMobileMenuOpen(false)}
          className="absolute top-4 right-4 text-white hover:text-gray-200 transition-colors p-2"
        >
          <X size={32} strokeWidth={1} />
        </button>
      </div>

      <div className={`fixed top-0 left-0 h-full w-[85vw] max-w-[340px] bg-white z-[70] flex flex-col transform transition-transform duration-300 ease-out md:hidden ${
        isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        
        {/* Header User Area */}
        <div className="p-4 pt-4">
          <div className="bg-brand-blue rounded-[8px] p-4 flex items-center gap-4 shadow-sm">
             <div className="w-[46px] h-[46px] bg-white rounded-full flex items-center justify-center">
                <User size={30} className="text-brand-blue fill-brand-blue" strokeWidth={1} />
             </div>
             <div className="text-white pt-0.5">
                <p className="text-[15px] font-normal leading-snug">Hello there!</p>
                <p className="text-[15px] font-normal leading-snug">Signin</p>
             </div>
          </div>
        </div>

        {/* Links */}
        <div className="flex-1 overflow-y-auto pb-8">
           <div className="px-4 mb-6">
             <div className="bg-[#fcfcfc] rounded-[8px] border border-gray-100 overflow-hidden">
                {menuItems.map((item, index) => (
                  <MobileNavItem key={item.id || item.label || index} item={item} onClose={closeMenu} />
                ))}
             </div>
           </div>

           {/* Quick Links */}
           <div className="px-4">
              <div className="mb-4 mt-2">
                <h3 className="text-[14px] font-medium text-gray-600 block pb-2">
                  Quick Links
                </h3>
                <div className="w-[36px] h-[2px] bg-brand-blue -mt-1 rounded-full"></div>
              </div>
              
              <div className="bg-[#f9f9f9] rounded-[10px] overflow-hidden py-1 border border-gray-100">
                <Link 
                  href="/orders"
                  onClick={closeMenu}
                  className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-100 transition-colors border-b border-gray-100/70"
                >
                  <Calendar size={18} strokeWidth={1.5} className="text-gray-700" /> 
                  <span className="text-[13px] tracking-wide text-gray-700">Track Your Order</span>
                </Link>
                <Link href="/wishlist" onClick={closeMenu} className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-100 transition-colors border-b border-gray-100/70">
                  <Heart size={18} strokeWidth={1.5} className="text-gray-700" /> 
                  <span className="text-[13px] tracking-wide text-gray-700">My Wishlists</span>
                </Link>
                <Link href="/faq" onClick={closeMenu} className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-100 transition-colors">
                  <HelpCircle size={18} strokeWidth={1.5} className="text-gray-700" /> 
                  <span className="text-[13px] tracking-wide text-gray-700">F.A.Qs</span>
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
  const hasChildren = item.children?.length > 0;

  const getHref = (it: any) => {
    if (it.type === 'category') return `/products?categoryId=${it.categoryId || it.id}`;
    return it.url || '/';
  };

  if (!hasChildren) {
    return (
      <Link 
        href={getHref(item)}
        onClick={onClose}
        className="w-full flex items-center text-left justify-between px-4 py-[11px] transition-colors hover:bg-gray-50"
        style={{ paddingLeft: `${16 + level * 20}px` }}
      >
        <span className="text-[13px] text-gray-700 font-normal">{item.label || item.name}</span>
      </Link>
    );
  }

  return (
    <div>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center text-left justify-between px-4 py-[11px] transition-colors hover:bg-gray-50"
        style={{ paddingLeft: `${16 + level * 20}px` }}
      >
        <span className="text-[13px] text-gray-700 font-normal">{item.label || item.name}</span>
        <ChevronDown
          size={14}
          className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          strokeWidth={2}
        />
      </button>
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key={item.label}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            className="overflow-hidden bg-gray-50/50"
          >
            <div>
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
