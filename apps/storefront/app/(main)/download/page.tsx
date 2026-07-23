import type { Metadata } from "next";
import { Smartphone, Tablet, Monitor, Shield, Zap, ArrowRight, Download, Lock, Store, PackageOpen } from 'lucide-react';
import { pageMetadata } from "@/lib/metadata";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";

export async function generateMetadata(): Promise<Metadata> {
  const config = await getStorefrontConfigServer().catch(() => null);
  const storeName = config?.store?.name || 'Store';
  return pageMetadata(
    `Download ${storeName} App`,
    `Get the official ${storeName} mobile app. Experience faster checkout, order tracking, and exclusive offers on your phone.`
  );
}

function MobileAppCard({
  name,
  description,
  icon: Icon,
  badge,
  hasAccess,
  storeName,
}: {
  name: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  badge: string;
  hasAccess: boolean;
  storeName: string;
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

          {hasAccess ? (
            <div className="flex flex-wrap gap-2">
              <a
                href="/"
                className="inline-flex items-center gap-1.5 bg-brand-blue text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:bg-brand-blue-dark transition-colors"
              >
                <Download size={14} />
                Install Web App
              </a>
              <span className="text-[11px] text-gray-400 self-center">
                or use browser menu → Add to Home Screen
              </span>
            </div>
          ) : (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
              <p className="text-amber-700 text-xs font-medium flex items-center gap-1.5">
                <Lock size={12} />
                Mobile app available with an upgraded license plan
              </p>
            </div>
          )}
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
  const hasMobileDistro = licenseFeatures.includes('mobile_distribution');
  const hasMobileAdmin = licenseFeatures.includes('mobile_distribution_admin');
  const hasMobilePos = licenseFeatures.includes('mobile_distribution_pos');

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

      {/* App List */}
      <div className="space-y-4 mb-12">
        <MobileAppCard
          name={storeName}
          description={`Shop directly from the ${storeName} mobile app — browse products, track orders, and get push notifications for flash sales and deals.`}
          icon={Store}
          badge="Customer App"
          hasAccess={hasMobileDistro}
          storeName={storeName}
        />
      </div>

      {/* Business Tools Section */}
      {(hasMobileAdmin || hasMobilePos) && (
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-6 pt-8 border-t border-gray-100">
            <div className="h-px flex-1 bg-gray-100" />
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">Business Tools</span>
            <div className="h-px flex-1 bg-gray-100" />
          </div>
          <p className="text-gray-500 text-sm text-center mb-6 max-w-lg mx-auto">
            Manage your store, process orders, and handle point-of-sale transactions on the go.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MobileAppCard
              name={`${storeName} Admin`}
              description="Full admin dashboard on mobile — manage products, orders, customers, inventory, and analytics from anywhere."
              icon={Tablet}
              badge="Admin"
              hasAccess={hasMobileAdmin}
              storeName={storeName}
            />
            <MobileAppCard
              name={`${storeName} POS`}
              description="Point-of-sale terminal for mobile devices. Process orders, take payments, and print receipts on the floor."
              icon={Monitor}
              badge="POS"
              hasAccess={hasMobilePos}
              storeName={storeName}
            />
          </div>
        </div>
      )}

      {/* How to Install */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 md:p-8">
        <h2 className="font-bold text-gray-900 text-lg mb-4">How to Install</h2>
        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="w-8 h-8 bg-brand-blue/10 text-brand-blue rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold">1</div>
            <div>
              <h3 className="font-bold text-gray-800 text-sm">Open in your browser</h3>
              <p className="text-gray-500 text-xs mt-0.5">Open this page in Chrome (Android) or Safari (iOS)</p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="w-8 h-8 bg-brand-blue/10 text-brand-blue rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold">2</div>
            <div>
              <h3 className="font-bold text-gray-800 text-sm">Tap the install prompt</h3>
              <p className="text-gray-500 text-xs mt-0.5">
                {`Android: Chrome menu → "Add to Home Screen" | iOS: Share → "Add to Home Screen"`}
              </p>
            </div>
          </div>
          <div className="flex gap-4">
            <div className="w-8 h-8 bg-brand-blue/10 text-brand-blue rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold">3</div>
            <div>
              <h3 className="font-bold text-gray-800 text-sm">Done!</h3>
              <p className="text-gray-500 text-xs mt-0.5">The app icon appears on your home screen — tap to launch</p>
            </div>
          </div>
        </div>
      </div>

      {/* License upgrade prompt */}
      {licenseActive && !hasMobileDistro && (
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
