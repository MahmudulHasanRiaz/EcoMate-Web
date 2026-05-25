"use client";

import React, { useState } from "react";
import { MessageSquare, ShoppingBag, MessageCircle, Phone, X, MessageCircleMore } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { motion, AnimatePresence } from "motion/react";

export default function FloatingWidgets() {
  const { cartCount, cartTotal, setIsCartOpen } = useCart();
  const { config } = useStorefrontConfig();
  const [isChatOpen, setIsChatOpen] = useState(false);

  const wa = config.social.whatsapp.replace(/[^0-9]/g, '');
  const phoneDigits = config.store.phone.replace(/[^0-9]/g, '');

  const chatOptions = [
    ...(wa ? [{
      name: "WhatsApp",
      icon: <MessageCircle size={20} />,
      color: "bg-[#25D366]",
      link: `https://wa.me/${wa}`,
      delay: 0.1
    }] : []),
    ...(config.social.facebook ? [{
      name: "Messenger",
      icon: <MessageCircleMore size={20} />,
      color: "bg-[#0084FF]",
      link: `https://m.me/${config.social.facebook.split('/').pop()}`,
      delay: 0.2
    }] : []),
    ...(phoneDigits ? [{
      name: "Direct Call",
      icon: <Phone size={20} />,
      color: "bg-gray-800",
      link: `tel:+${phoneDigits}`,
      delay: 0.3
    }] : []),
  ];

  return (
    <>
      {/* Right side floating cart */}
      <div 
        id="floating-cart"
        onClick={() => setIsCartOpen(true)}
        className={`fixed right-0 top-1/2 -translate-y-1/2 z-40 bg-brand-blue text-white rounded-l shadow-[-2px_0_10px_rgba(0,0,0,0.1)] flex flex-col items-center cursor-pointer hover:bg-brand-blue/90 overflow-hidden transition-all duration-300 ease-in-out ${cartCount > 0 ? 'translate-x-0 opacity-100 ease-out' : 'translate-x-[120%] opacity-0 ease-in pointer-events-none'}`}
      >
        <div className="flex flex-col items-center justify-center w-16 px-1 py-2">
          <ShoppingBag size={20} className="mb-0.5" strokeWidth={2} />
          <div className="text-[10px] font-medium leading-tight text-center tracking-wide">
            {cartCount} Items
          </div>
        </div>
        <div className="bg-white text-brand-blue w-full text-center py-1.5 text-[11px] font-bold border-t border-brand-blue/10">
          {config.currency.symbol}{cartTotal.toLocaleString()}
        </div>
      </div>

      {/* Floating Chat Button */}
      <div className="fixed bottom-20 md:bottom-6 right-6 z-[60] flex flex-col items-end gap-3">
        <AnimatePresence>
          {isChatOpen && (
            <motion.div 
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              className="flex flex-col items-end gap-3 mb-2"
            >
              {chatOptions.map((option) => (
                <motion.a
                  key={option.name}
                  href={option.link}
                  target="_blank"
                  rel="noreferrer"
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: option.delay }}
                  className="group flex items-center gap-3"
                >
                  <span className="bg-white text-gray-800 text-[12px] font-bold px-3 py-1.5 rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity border border-gray-100">
                    {option.name}
                  </span>
                  <div className={`${option.color} w-12 h-12 rounded-full flex items-center justify-center text-white shadow-xl hover:scale-110 transition-transform active:scale-95`}>
                    {option.icon}
                  </div>
                </motion.a>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex items-center gap-3">
          {!isChatOpen && (
            <motion.div 
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-white shadow-lg border border-gray-100 px-4 py-2 rounded-xl hidden sm:flex items-center gap-2 relative"
            >
              <span className="text-xl leading-none animate-bounce">👋</span>
              <span className="text-[13px] font-bold text-gray-800 uppercase tracking-wider">
                Support
              </span>
              <div className="absolute -right-2 top-1/2 -translate-y-1/2 border-y-[6px] border-y-transparent border-l-[8px] border-l-white"></div>
            </motion.div>
          )}
          
          <button 
            onClick={() => setIsChatOpen(!isChatOpen)}
            className={`w-14 h-14 ${isChatOpen ? 'bg-gray-800' : 'bg-brand-coral'} text-white rounded-full flex items-center justify-center shadow-2xl hover:scale-105 transition-all outline outline-4 ${isChatOpen ? 'outline-gray-800/20' : 'outline-brand-coral/20'} z-50`}
          >
            {isChatOpen ? <X size={26} strokeWidth={2.5} /> : <MessageSquare size={26} fill="currentColor" />}
          </button>
        </div>
      </div>
    </>
  );
}
