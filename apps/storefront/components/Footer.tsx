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
  const playStoreUrl = (config as any).playStoreUrl || '';
  const appStoreUrl = (config as any).appStoreUrl || '';

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

        {/* Apps Download Section — always clickable */}
        <div className="pt-10 border-t border-gray-100 mb-10">
          <p className="font-bold text-[13px] text-gray-800 mb-4">Download App on Mobile :</p>
          <div className="flex flex-wrap items-center gap-3">
            {playStoreUrl ? (
              <a href={playStoreUrl} target="_blank" rel="noreferrer"
                className="bg-[#1a1a1a] p-1.5 px-3 rounded-md flex items-center gap-2 text-white border border-gray-800 hover:bg-black transition-colors">
                <svg width="24" height="24" viewBox="0 0 512 512" fill="currentColor">
                  <path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z"/>
                </svg>
                <div className="text-left">
                  <p className="text-[10px] leading-none text-gray-400">Download on</p>
                  <p className="text-[14px] font-bold leading-tight">Google Play</p>
                </div>
              </a>
            ) : (
              <Link href="/download"
                className="bg-[#1a1a1a] p-1.5 px-3 rounded-md flex items-center gap-2 text-white border border-gray-800 hover:bg-black transition-colors">
                <svg width="24" height="24" viewBox="0 0 512 512" fill="currentColor">
                  <path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z"/>
                </svg>
                <div className="text-left">
                  <p className="text-[10px] leading-none text-gray-400">Get it on</p>
                  <p className="text-[14px] font-bold leading-tight">Google Play</p>
                </div>
              </Link>
            )}
            {appStoreUrl ? (
              <a href={appStoreUrl} target="_blank" rel="noreferrer"
                className="bg-[#1a1a1a] p-1.5 px-3 rounded-md flex items-center gap-2 text-white border border-gray-800 hover:bg-black transition-colors">
                <svg width="24" height="24" viewBox="0 0 512 512" fill="currentColor">
                  <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-111.3-59.9-121.2z"/>
                </svg>
                <div className="text-left">
                  <p className="text-[10px] leading-none text-gray-400">Download on</p>
                  <p className="text-[14px] font-bold leading-tight">App Store</p>
                </div>
              </a>
            ) : (
              <Link href="/download"
                className="bg-[#1a1a1a] p-1.5 px-3 rounded-md flex items-center gap-2 text-white border border-gray-800 hover:bg-black transition-colors">
                <svg width="24" height="24" viewBox="0 0 512 512" fill="currentColor">
                  <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-111.3-59.9-121.2z"/>
                </svg>
                <div className="text-left">
                  <p className="text-[10px] leading-none text-gray-400">Get it on</p>
                  <p className="text-[14px] font-bold leading-tight">App Store</p>
                </div>
              </Link>
            )}
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
