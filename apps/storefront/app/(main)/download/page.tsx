import type { Metadata } from "next";
import { Smartphone, Tablet, Monitor, Shield, Zap, ArrowRight, Download, Lock, PackageOpen } from 'lucide-react';
import { pageMetadata } from "@/lib/metadata";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import InstallButtons from "@/components/InstallButtons";

export async function generateMetadata(): Promise<Metadata> {
  const config = await getStorefrontConfigServer().catch(() => null);
  const storeName = config?.store?.name || 'Store';
  return pageMetadata(
    `Download ${storeName} App`,
    `Get the official ${storeName} mobile app. Experience faster checkout, order tracking, and exclusive offers on your phone.`
  );
}

function StoreAppCard({
  name,
  description,
  icon: Icon,
  badge,
  playStoreUrl,
  appStoreUrl,
}: {
  name: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge: string;
  playStoreUrl?: string;
  appStoreUrl?: string;
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start gap-4">
        <div className="w-14 h-14 bg-brand-blue/10 text-brand-blue rounded-2xl flex items-center justify-center flex-shrink-0">
          <Icon size={28} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-bold text-gray-900 text-lg">{name}</h3>
            <span className="text-[10px] font-bold text-brand-blue bg-brand-blue/10 px-2 py-0.5 rounded-full uppercase tracking-wider">
              {badge}
            </span>
          </div>
          <p className="text-gray-500 text-sm mb-4">{description}</p>
          <div className="flex flex-wrap gap-2">
            {playStoreUrl ? (
              <a
                href={playStoreUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 bg-[#1a1a1a] text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-black transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor">
                  <path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z"/>
                </svg>
                Google Play
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-400 text-xs font-bold px-4 py-2.5 rounded-xl">
                <svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor">
                  <path d="M325.3 234.3L104.6 13l280.8 161.2-60.1 60.1zM47 0C34 6.8 25.3 19.2 25.3 35.3v441.3c0 16.1 8.7 28.5 21.7 35.3l256.6-256L47 0zm425.2 225.6l-58.9-34.1-65.7 64.5 65.7 64.5 60.1-34.1c18-14.3 18-46.5-1.2-60.8zM104.6 499l280.8-161.2-60.1-60.1L104.6 499z"/>
                </svg>
                Android
              </span>
            )}
            {appStoreUrl ? (
              <a
                href={appStoreUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 bg-[#1a1a1a] text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-black transition-colors"
              >
                <svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor">
                  <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-111.3-59.9-121.2zM256 160c-51.3 0-85.9-33.5-87.2-82 0-6.6.3-13.3 1.1-19.8-40.6 2-75.3 21.9-96.5 52.4-20.3 29.4-32.2 63.3-32.2 100.9 0 0 0 .1 0 .2 7.6-3.4 14.4-5.2 20.5-5.2 17.4 0 52.9 18.4 70.4 18.4 20.1 0 53.1-18.1 71.3-18.1 12.6 0 39.2 8.4 55.9 17.8 8.6-13.5 20.4-31 33.7-49.9-9.4-9.6-21-18.4-35.8-27.4z"/>
                </svg>
                App Store
              </a>
            ) : (
              <span className="inline-flex items-center gap-1.5 bg-gray-100 text-gray-400 text-xs font-bold px-4 py-2.5 rounded-xl">
                <svg width="16" height="16" viewBox="0 0 512 512" fill="currentColor">
                  <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-111.3-59.9-121.2zM256 160c-51.3 0-85.9-33.5-87.2-82 0-6.6.3-13.3 1.1-19.8-40.6 2-75.3 21.9-96.5 52.4-20.3 29.4-32.2 63.3-32.2 100.9 0 0 0 .1 0 .2 7.6-3.4 14.4-5.2 20.5-5.2 17.4 0 52.9 18.4 70.4 18.4 20.1 0 53.1-18.1 71.3-18.1 12.6 0 39.2 8.4 55.9 17.8 8.6-13.5 20.4-31 33.7-49.9-9.4-9.6-21-18.4-35.8-27.4z"/>
                </svg>
                iOS
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function DownloadPage() {
  const config = await getStorefrontConfigServer().catch(() => null);
  const storeName = config?.store?.name || 'Store';
  const licenseFeatures: string[] = (config as any)?.licenseFeatures ?? [];
  const licenseActive = (config as any)?._licenseActive ?? true;
  const hasWildcard = licenseFeatures.includes('*');
  const hasMobileDistro = hasWildcard || licenseFeatures.includes('mobile_distribution');
  const hasMobileAdmin = hasWildcard || licenseFeatures.includes('mobile_distribution_admin');
  const hasMobilePos = hasWildcard || licenseFeatures.includes('mobile_distribution_pos');
  const playStoreUrl = (config as any)?.playStoreUrl || '';
  const appStoreUrl = (config as any)?.appStoreUrl || '';

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
          playStoreUrl={playStoreUrl}
          appStoreUrl={appStoreUrl}
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
                playStoreUrl={playStoreUrl}
                appStoreUrl={appStoreUrl}
              />
            )}
            {hasMobilePos && (
              <StoreAppCard
                name={`${storeName} POS`}
                description="Point-of-sale terminal for mobile devices. Process orders, take payments, and print receipts on the floor."
                icon={Monitor}
                badge="POS"
                playStoreUrl={playStoreUrl}
                appStoreUrl={appStoreUrl}
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
