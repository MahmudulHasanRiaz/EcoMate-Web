"use client";

import React, { useEffect, useState } from 'react';
import { X, User, ChevronRight, HelpCircle, Heart, Calendar } from 'lucide-react';
import { useRouter } from "next/navigation";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";

export default function MobileMenu() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const router = useRouter();
  const { config } = useStorefrontConfig();
  const menuItems = config.navigation?.items?.length ? config.navigation.items : [];

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

  const handleCategoryClick = (href: string) => {
    if (href) router.push(href);
    setIsMobileMenuOpen(false);
  };

  const resetAllAndOpen = (path: string) => {
    router.push(path);
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
                  <button 
                     key={item.name || index} 
                     onClick={() => handleCategoryClick(item.href)}
                     className={`w-full flex items-center text-left justify-between px-4 py-[11px] transition-colors ${
                       index !== menuItems.length - 1 ? 'border-b border-gray-100/70' : ''
                     } hover:bg-gray-50`}
                  >
                     <span className="text-[13px] text-gray-700 font-normal">{item.name}</span>
                     {item.href && <ChevronRight size={14} className="text-gray-400" strokeWidth={2} />}
                  </button>
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
                <button 
                  onClick={() => resetAllAndOpen('/orders')}
                  className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-100 transition-colors border-b border-gray-100/70"
                >
                  <Calendar size={18} strokeWidth={1.5} className="text-gray-700" /> 
                  <span className="text-[13px] tracking-wide text-gray-700">Track Your Order</span>
                </button>
                <button onClick={() => resetAllAndOpen('/wishlist')} className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-100 transition-colors border-b border-gray-100/70">
                  <Heart size={18} strokeWidth={1.5} className="text-gray-700" /> 
                  <span className="text-[13px] tracking-wide text-gray-700">My Wishlists</span>
                </button>
                <button onClick={() => resetAllAndOpen('/faq')} className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-100 transition-colors">
                  <HelpCircle size={18} strokeWidth={1.5} className="text-gray-700" /> 
                  <span className="text-[13px] tracking-wide text-gray-700">F.A.Qs</span>
                </button>
              </div>
           </div>
        </div>
      </div>
    </>
  );
}
