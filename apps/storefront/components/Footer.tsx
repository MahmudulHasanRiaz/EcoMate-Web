"use client";

import React from 'react';
import { MapPin, Phone, Mail } from 'lucide-react';
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { StoreBrand } from "./StoreBrand";
import EcoMateAttribution from "./EcoMateAttribution";
import { usePathname } from "next/navigation";
import Link from 'next/link';

export default function Footer({}: {}) {
  const pathname = usePathname();
  const { config } = useStorefrontConfig();
  if (pathname && pathname.startsWith('/checkout')) return null;
  const { store, social, footer: footerConfig } = config;

  const footerColumns = config.menu?.footer?.columns || [];

  const defaultColumns = [
    { id: 'info', title: 'Information', items: [
      { id: 'abt', type: 'custom', label: 'About us', url: '/about' },
      { id: 'cnt', type: 'custom', label: 'Contact us', url: '/support' },
      { id: 'cmp', type: 'custom', label: 'Company Information', url: '/company' },
      { id: 'str', type: 'custom', label: `${store.name} Stores`, url: '/stores' },
      { id: 'trm', type: 'custom', label: 'Terms & Conditions', url: '/terms-conditions' },
      { id: 'prv', type: 'custom', label: 'Privacy Policy', url: '/privacy-policy' },
      { id: 'car', type: 'custom', label: 'Careers', url: '/careers' },
    ]},
    { id: 'shop', title: 'Shop By', items: [
      { id: 's1', type: 'custom', label: 'iPhone' },
      { id: 's2', type: 'custom', label: 'Samsung' },
      { id: 's3', type: 'custom', label: 'Google Pixel' },
      { id: 's4', type: 'custom', label: 'Accessories' },
      { id: 's5', type: 'custom', label: 'Smart Watches' },
      { id: 's6', type: 'custom', label: 'Audio Gadgets' },
      { id: 's7', type: 'custom', label: 'MacBook' },
    ]},
    { id: 'sup', title: 'Support', items: [
      { id: 'su1', type: 'custom', label: 'Support Center', url: '/support' },
      { id: 'su2', type: 'custom', label: 'How to Order' },
      { id: 'su3', type: 'custom', label: 'Order Tracking', url: '/orders' },
      { id: 'su4', type: 'custom', label: 'Payment' },
      { id: 'su5', type: 'custom', label: 'Shipping' },
      { id: 'su6', type: 'custom', label: 'FAQ', url: '/faq' },
    ]},
    { id: 'con', title: 'Consumer Policy', items: [
      { id: 'co1', type: 'custom', label: 'Happy Return' },
      { id: 'co2', type: 'custom', label: 'Refund Policy', url: '/refund-policy' },
      { id: 'co3', type: 'custom', label: 'Exchange', url: '/exchange-policy' },
      { id: 'co4', type: 'custom', label: 'Cancellation' },
      { id: 'co5', type: 'custom', label: 'Pre-Order' },
      { id: 'co6', type: 'custom', label: 'Extra Discount' },
    ]},
  ];

  // Merge admin columns with defaults, cap at 4
  const columns = (() => {
    if (footerColumns.length === 0) return defaultColumns;
    const merged = [...footerColumns];
    for (const def of defaultColumns) {
      if (merged.length >= 4) break;
      // Don't duplicate same-title columns
      if (!merged.some(c => c.title === def.title)) {
        merged.push(def);
      }
    }
    return merged;
  })();

  const colCount = columns.length;

  return (
    <footer className="bg-white pt-16 pb-0 border-t border-gray-100">
      <div className="max-w-7xl mx-auto px-4">
        {/* Top Grid */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-10 md:gap-8 mb-12">
          
          {/* Brand Info */}
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-6">
              <StoreBrand />
            </div>
            <p className="text-[13px] text-gray-500 leading-relaxed mb-6 max-w-sm">
              {footerConfig.description || `${store.name} — delivering quality products and service.`}
            </p>
            <div className="space-y-4">
              {store.address && (
                <div className="flex items-start gap-3">
                  <MapPin size={18} className="text-brand-blue shrink-0 mt-0.5" />
                  <span className="text-[13px] text-gray-600">{store.address}</span>
                </div>
              )}
              {store.phone && (
                <div className="flex items-start gap-3">
                  <Phone size={18} className="text-brand-blue shrink-0 mt-0.5" />
                  <span className="text-[13px] text-gray-600">{store.phone}</span>
                </div>
              )}
              {store.email && (
                <div className="flex items-start gap-3">
                  <Mail size={18} className="text-brand-blue shrink-0 mt-0.5" />
                  <span className="text-[13px] text-gray-600">{store.email}</span>
                </div>
              )}
            </div>
            
            {/* Social Icons */}
            <div className="flex items-center gap-4 mt-8">
              {social.facebook && (
                <a href={social.facebook} target="_blank" rel="noreferrer" aria-label="Facebook" className="w-8 h-8 rounded-full border border-gray-100 flex items-center justify-center text-gray-400 hover:bg-brand-blue hover:text-white hover:border-brand-blue transition-all">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
                </a>
              )}
              {social.instagram && (
                <a href={social.instagram} target="_blank" rel="noreferrer" aria-label="Instagram" className="w-8 h-8 rounded-full border border-gray-100 flex items-center justify-center text-gray-400 hover:bg-brand-blue hover:text-white hover:border-brand-blue transition-all">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>
                </a>
              )}
              {social.youtube && (
                <a href={social.youtube} target="_blank" rel="noreferrer" aria-label="YouTube" className="w-8 h-8 rounded-full border border-gray-100 flex items-center justify-center text-gray-400 hover:bg-brand-blue hover:text-white hover:border-brand-blue transition-all">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                </a>
              )}
            </div>
          </div>

          {/* Columns */}
          <div className={`grid grid-cols-2 md:col-span-3 gap-8 md:gap-4 ${colCount === 1 ? 'md:grid-cols-1' : colCount === 2 ? 'md:grid-cols-2' : colCount === 3 ? 'md:grid-cols-3' : 'md:grid-cols-4'}`}>
            {columns.map((col: any) => (
              <FooterColumn key={col.id} title={col.title} items={col.items} />
            ))}
          </div>

        </div>

        {/* Apps Download Section */}
        <div className="pt-10 border-t border-gray-100 mb-10">
          <p className="font-bold text-[13px] text-gray-800 mb-4">Download App on Mobile :</p>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => alert('Android App coming soon!')} className="bg-[#1a1a1a] p-1.5 px-3 rounded-md flex items-center gap-2 text-white border border-gray-800 hover:bg-black transition-colors">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.523 15.341c-.551 0-1 .449-1 1s.449 1 1 1 1-.449 1-1-.449-1-1-1zm-11.045 0c-.551 0-1 .449-1 1s.449 1 1 1 1-.449 1-1-.449-1-1-1zM22 13.5v-3c0-.827-.673-1.5-1.5-1.5h-1.564c-.456-2.906-2.973-5-6-5s-5.544 2.094-6 5H5.45C4.623 9 4 9.673 4 10.5v3c0 .827.673 1.5 1.5 1.5h1.564c.266 1.696 1.159 3.097 2.436 4.015L7.9 21.1c-.13.38.07.79.45.92s.79-.07.92-.45l1.62-4.71c.36.09.73.14 1.11.14s.75-.05 1.11-.14l1.62 4.71c.13.38.54.58.92.45.38-.13.58-.54.45-.92l-1.6-4.585c1.277-.918 2.17-2.319 2.436-4.015H18.5c.827 0 1.5-.673 1.5-1.5z"></path>
              </svg>
              <div className="text-left">
                <p className="text-[10px] leading-none text-gray-400">Download on</p>
                <p className="text-[14px] font-bold leading-tight">Google Play</p>
              </div>
            </button>
            <button onClick={() => alert('iOS App coming soon!')} className="bg-[#1a1a1a] p-1.5 px-3 rounded-md flex items-center gap-2 text-white border border-gray-800 hover:bg-black transition-colors">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.1 2.48-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .76-3.27.82-1.31.05-2.31-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91 1.34.05 3 .53 4 2.17-2.51 1.48-2.11 4.77.46 5.82-.9 2.14-2.14 4.54-3.57 6.67zM14.96 6.9c.14-1.34-.45-3.01-1.37-4.14-1.12-1.31-2.95-1.72-4.2-.67-.14 1.34.45 3.01 1.37 4.14 1.12 1.31 2.95 1.72 4.2.67z"></path>
              </svg>
              <div className="text-left">
                <p className="text-[10px] leading-none text-gray-400">Download on</p>
                <p className="text-[14px] font-bold leading-tight">App Store</p>
              </div>
            </button>
          </div>
        </div>

        <EcoMateAttribution storeName={store.name} />
      </div>
    </footer>
  );
}

function FooterColumn({ title, items }: { title: string, items: any[] }) {
  return (
    <div>
      <h4 className="font-bold text-[14px] text-gray-800 mb-4">{title}</h4>
      <ul className="space-y-2.5">
        {items.map((item: any) => {
          const href = item.type === 'category'
            ? item.slug
              ? `/products?category=${item.slug}`
              : `/products?categoryId=${item.categoryId || item.id}`
            : item.url;
          if (href) {
            return (
              <li key={item.id}>
                <Link href={href} className="text-[12px] text-gray-500 hover:text-brand-blue transition-colors text-left">
                  {item.label}
                </Link>
              </li>
            );
          }
          return (
            <li key={item.id}>
              <span className="text-[12px] text-gray-500">{item.label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
