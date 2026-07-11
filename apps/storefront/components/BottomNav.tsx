"use client";

import { Home, LayoutGrid, ShoppingBag, User, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export default function BottomNav() {
  const pathname = usePathname();
  const navRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (navRef.current && pathname?.startsWith('/products/')) {
      navRef.current.style.display = 'none';
    }
  }, [pathname]);

  if (pathname && pathname.startsWith('/checkout')) return null;

  return (
    <div ref={navRef} className="fixed bottom-4 left-0 right-0 z-50 md:hidden flex justify-center pointer-events-none px-4 pb-safe">
      <nav className="bg-white/95 backdrop-blur-md shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-gray-100/80 rounded-[20px] w-full max-w-sm pointer-events-auto flex items-center justify-around h-[52px]">
          <Link 
            href="/"
            className={`flex flex-col items-center justify-center w-12 h-full transition-colors ${pathname === '/' ? 'text-brand-blue' : 'text-gray-400 hover:text-gray-800'}`}
          >
            <Home size={20} className="stroke-[2.5]" />
            <span className="text-[9px] font-bold mt-0.5">Home</span>
          </Link>
          <button 
            onClick={() => window.dispatchEvent(new CustomEvent('open-mobile-menu'))}
            aria-label="Open menu"
            className="flex flex-col items-center justify-center w-12 h-full text-gray-400 hover:text-gray-800 transition-colors"
          >
            <LayoutGrid size={20} className="stroke-[2.5]" />
            <span className="text-[9px] font-medium mt-0.5">Menu</span>
          </button>
          <Link
            href="/products"
            className={`flex flex-col items-center justify-center w-12 h-full transition-colors ${pathname === '/products' ? 'text-brand-blue' : 'text-gray-400 hover:text-gray-800'}`}
          >
            <ShoppingBag size={20} className="stroke-[2.5]" />
            <span className="text-[9px] font-medium mt-0.5">Shop</span>
          </Link>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('open-mobile-search'))}
            aria-label="Search"
            className="flex flex-col items-center justify-center w-12 h-full text-gray-400 hover:text-gray-800 transition-colors"
          >
            <Search size={20} className="stroke-[2.5]" />
            <span className="text-[9px] font-medium mt-0.5">Search</span>
          </button>
          <Link
            href="/account"
            className={`flex flex-col items-center justify-center w-12 h-full transition-colors ${pathname?.startsWith('/account') ? 'text-brand-blue' : 'text-gray-400 hover:text-gray-800'}`}
          >
            <User size={20} className="stroke-[2.5]" />
            <span className="text-[9px] font-medium mt-0.5">Account</span>
          </Link>
      </nav>
    </div>
  );
}
