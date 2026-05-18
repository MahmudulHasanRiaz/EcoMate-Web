"use client";

import { Home, LayoutGrid, ShoppingBag, Search, User } from "lucide-react";
import { useCart } from "@/context/CartContext";
import { useRouter, usePathname } from "next/navigation";

export default function BottomNav() {
  const { cartCount, setIsCartOpen } = useCart();
  const router = useRouter();
  const pathname = usePathname();

  return (
    <div className="fixed bottom-4 left-0 right-0 z-50 md:hidden flex justify-center pointer-events-none px-4 pb-safe">
      <nav className="bg-white/95 backdrop-blur-md shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-gray-100/80 rounded-[20px] w-full max-w-sm pointer-events-auto flex items-center justify-around h-[52px]">
          <button 
            onClick={() => router.push('/')}
            className={`flex flex-col items-center justify-center w-12 h-full transition-colors ${pathname === '/' ? 'text-brand-blue' : 'text-gray-400 hover:text-gray-800'}`}
          >
            <Home size={20} className="stroke-[2.5]" />
            <span className="text-[9px] font-bold mt-0.5">Home</span>
          </button>
          <button 
            onClick={() => window.dispatchEvent(new CustomEvent('open-mobile-menu'))}
            className="flex flex-col items-center justify-center w-12 h-full text-gray-400 hover:text-gray-800 transition-colors"
          >
            <LayoutGrid size={20} className="stroke-[2.5]" />
            <span className="text-[9px] font-medium mt-0.5">Menu</span>
          </button>
          <button 
            id="mobile-cart"
            onClick={() => setIsCartOpen(true)}
            className="flex flex-col items-center justify-center w-12 h-full text-gray-400 hover:text-gray-800 transition-all relative"
          >
            <div className="relative">
              <ShoppingBag size={20} className="stroke-[2.5]" />
              {cartCount > 0 && (
                <div className="absolute -top-1.5 -right-2 bg-brand-blue text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border-2 border-white box-content">
                  {cartCount}
                </div>
              )}
            </div>
            <span className="text-[9px] font-medium mt-0.5">Cart</span>
          </button>
          <button 
            onClick={() => router.push('/products')}
            className="flex flex-col items-center justify-center w-12 h-full text-gray-400 hover:text-gray-800 transition-colors"
          >
            <Search size={20} className="stroke-[2.5]" />
            <span className="text-[9px] font-medium mt-0.5">Search</span>
          </button>
          <button 
            onClick={() => {
              router.push('/account');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className={`flex flex-col items-center justify-center w-12 h-full transition-colors ${pathname.startsWith('/account') ? 'text-brand-blue' : 'text-gray-400 hover:text-gray-800'}`}
          >
            <User size={20} className="stroke-[2.5]" />
            <span className="text-[9px] font-medium mt-0.5">Account</span>
          </button>
      </nav>
    </div>
  );
}
