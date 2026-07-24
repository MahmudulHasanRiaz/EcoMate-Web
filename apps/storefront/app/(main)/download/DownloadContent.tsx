"use client";

import { Smartphone, Tablet, Monitor, Shield, Zap, ArrowRight, Download, Lock, PackageOpen } from 'lucide-react';
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { StoreAppCard } from "./StoreAppCard";

export default function DownloadContent() {
  const { config } = useStorefrontConfig();
  const storeName = config.store.name || 'Store';
  const licenseFeatures: string[] = (config as any)?.licenseFeatures ?? [];
  const licenseActive = (config as any)?._licenseActive ?? true;
  const hasWildcard = licenseFeatures.includes('*');
  const hasMobileDistro = hasWildcard || licenseFeatures.includes('mobile_distribution');
  const hasMobileAdmin = hasWildcard || licenseFeatures.includes('mobile_distribution_admin');
  const hasMobilePos = hasWildcard || licenseFeatures.includes('mobile_distribution_pos');
  const playStoreUrl = (config as any)?.playStoreUrl || '';
  const appStoreUrl = (config as any)?.appStoreUrl || '';
  const storefrontPlayStoreUrl = (config as any)?.storefrontPlayStoreUrl || '';
  const storefrontAppStoreUrl = (config as any)?.storefrontAppStoreUrl || '';
  const adminPlayStoreUrl = (config as any)?.adminPlayStoreUrl || '';
  const adminAppStoreUrl = (config as any)?.adminAppStoreUrl || '';
  const posPlayStoreUrl = (config as any)?.posPlayStoreUrl || '';
  const posAppStoreUrl = (config as any)?.posAppStoreUrl || '';

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 md:py-16">
      {/* Hero */}
      <div className="text-center mb-12">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-blue/10 text-brand-blue rounded-full mb-4">
          <Smartphone size={32} />
        </div>
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-3">
          Get the {storeName} App
        </h1>
        <p className="text-gray-500 max-w-xl mx-auto">
          Install our app for a faster, more convenient shopping experience.
          Access exclusive deals, track orders in real-time, and enjoy seamless checkout — right from your phone.
        </p>
      </div>

      {/* Features */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
        <div className="bg-white border border-gray-100 rounded-xl p-4 text-center">
          <div className="w-10 h-10 bg-green-50 text-green-600 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Zap size={20} />
          </div>
          <h3 className="font-bold text-gray-800 text-sm mb-1">Faster Checkout</h3>
          <p className="text-gray-400 text-xs">Save details for one-tap purchases</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4 text-center">
          <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center mx-auto mb-3">
            <PackageOpen size={20} />
          </div>
          <h3 className="font-bold text-gray-800 text-sm mb-1">Order Tracking</h3>
          <p className="text-gray-400 text-xs">Real-time updates from dispatch to delivery</p>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4 text-center">
          <div className="w-10 h-10 bg-purple-50 text-purple-600 rounded-xl flex items-center justify-center mx-auto mb-3">
            <Shield size={20} />
          </div>
          <h3 className="font-bold text-gray-800 text-sm mb-1">Secure & Private</h3>
          <p className="text-gray-400 text-xs">Your data stays safe with encrypted checkout</p>
        </div>
      </div>

      {/* Storefront App */}
      {hasMobileDistro && (
        <StoreAppCard
          name={storeName}
          description={`Shop directly from the ${storeName} app — browse products, track orders, and get push notifications for flash sales and deals.`}
          icon={Download}
          badge="Customer App"
          playStoreUrl={storefrontPlayStoreUrl || playStoreUrl}
          appStoreUrl={storefrontAppStoreUrl || appStoreUrl}
        />
      )}

      {/* Business Tools Section */}
      {(hasMobileAdmin || hasMobilePos) && (
        <div className="mb-12 mt-8">
          <div className="flex items-center gap-3 mb-6 pt-8 border-t border-gray-100">
            <div className="h-px flex-1 bg-gray-100" />
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Business Tools</span>
            <div className="h-px flex-1 bg-gray-100" />
          </div>
          <p className="text-gray-500 text-sm text-center mb-6 max-w-lg mx-auto">
            Manage your store, process orders, and handle point-of-sale transactions on the go.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {hasMobileAdmin && (
              <StoreAppCard
                name={`${storeName} Admin`}
                description="Full admin dashboard on mobile — manage products, orders, customers, inventory, and analytics from anywhere."
                icon={Tablet}
                badge="Admin"
                playStoreUrl={adminPlayStoreUrl || playStoreUrl}
                appStoreUrl={adminAppStoreUrl || appStoreUrl}
              />
            )}
            {hasMobilePos && (
              <StoreAppCard
                name={`${storeName} POS`}
                description="Point-of-sale terminal for mobile devices. Process orders, take payments, and print receipts on the floor."
                icon={Monitor}
                badge="POS"
                playStoreUrl={posPlayStoreUrl || playStoreUrl}
                appStoreUrl={posAppStoreUrl || appStoreUrl}
              />
            )}
          </div>
        </div>
      )}

      {/* License upgrade prompt */}
      {licenseActive && !hasMobileDistro && !hasMobileAdmin && !hasMobilePos && (
        <div className="mt-8 bg-gradient-to-r from-brand-blue/5 to-transparent border border-brand-blue/10 rounded-2xl p-6 text-center">
          <p className="text-gray-600 text-sm mb-3">
            Mobile app access is available with upgraded license plans.
          </p>
          <a
            href="/admin/mon/settings/license"
            className="inline-flex items-center gap-1.5 text-brand-blue font-bold text-sm hover:underline"
          >
            View License Plans
            <ArrowRight size={14} />
          </a>
        </div>
      )}
    </div>
  );
}
