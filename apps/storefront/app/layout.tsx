import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/context/CartContext";
import { AuthProvider } from "@/context/AuthContext";
import { WishlistProvider } from "@/context/WishlistContext";
import { StorefrontConfigProvider } from "@/context/StorefrontConfigContext";
import TrackingScripts from "@/components/TrackingScripts";
import OfflineBanner from "@/components/OfflineBanner";
import { Toaster } from "sonner";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import type { StorefrontConfig } from "@/lib/api/storefront-config";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export async function generateMetadata(): Promise<Metadata> {
  try {
    const config = await getStorefrontConfigServer();
    const faviconUrl = config.branding?.storefrontFavicon || "";
    return {
      title: {
        template: `%s — ${config.store.name}`,
        default: config.store.name,
      },
      description: config.seo.description || `${config.store.name} — premium products and services`,
      keywords: config.seo.keywords || undefined,
      icons: {
        icon: [{ url: faviconUrl || '/favicon.svg', type: 'image/svg+xml' }],
      },
      openGraph: {
        title: config.seo.title || config.store.name,
        description: config.seo.description || undefined,
        images: config.branding?.storefrontOgImage ? [config.branding.storefrontOgImage] : undefined,
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: config.seo.title || config.store.name,
        description: config.seo.description || undefined,
        images: config.branding?.storefrontOgImage ? [config.branding.storefrontOgImage] : undefined,
      },
    };
  } catch {
    return {
      title: "Store",
      description: "Premium products and services",
      icons: {
        icon: [{ url: '/favicon.svg', type: 'image/svg+xml' }],
      },
    };
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  let initialConfig: StorefrontConfig | undefined;
  try {
    initialConfig = await getStorefrontConfigServer();
  } catch {}

  const API_URL = process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
  let licenseActive = true;
  let licenseMessage = '';
  try {
    const licenseRes = await fetch(`${API_URL}/license/status`, {
      next: { revalidate: 300 },
    });
    const licenseStatus = await licenseRes.json();
    licenseActive = licenseStatus?.active ?? true;
    licenseMessage = licenseStatus?.message || '';
  } catch {}

  const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://example.com';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: initialConfig?.store.name || 'Store',
    url: BASE_URL,
    logo: initialConfig?.branding?.storeLogo || undefined,
    sameAs: [
      initialConfig?.social?.facebook,
      initialConfig?.social?.instagram,
      initialConfig?.social?.youtube,
    ].filter(Boolean),
    contactPoint: {
      '@type': 'ContactPoint',
      telephone: initialConfig?.store?.phone || undefined,
      email: initialConfig?.store?.email || undefined,
      contactType: 'customer service',
    },
    address: initialConfig?.store?.address ? {
      '@type': 'PostalAddress',
      streetAddress: initialConfig.store.address,
    } : undefined,
  };

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#0089CD" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content={initialConfig?.store?.name || 'Store'} />
      </head>
      <body className="min-h-screen flex flex-col bg-gray-50 text-gray-900 antialiased" suppressHydrationWarning>
        {initialConfig ? (
          <script id="__INITIAL_CONFIG__" type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify(initialConfig) }} />
        ) : null}
        <AuthProvider>
          <CartProvider>
            <WishlistProvider>
            <StorefrontConfigProvider initialConfig={initialConfig}>
            <script
              type="application/ld+json"
              dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
            />
            <TrackingScripts />
            {!licenseActive ? (
              <div className="min-h-screen flex flex-col items-center justify-center bg-[#f8f9fa] text-center p-6 w-full">
                <div className="max-w-md bg-white rounded-[32px] p-10 border border-gray-100/80 shadow-[0_8px_30px_rgb(0,0,0,0.03)]">
                  <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                  <h1 className="text-2xl font-black text-gray-900 uppercase tracking-tight mb-3">License Required</h1>
                  <p className="text-gray-600 text-sm mb-6 leading-relaxed">
                    {licenseMessage || 'This EcoMate installation requires a valid license. Please contact your administrator or service provider to activate your license.'}
                  </p>
                </div>
              </div>
            ) : initialConfig?.features?.maintenanceMode ? (
              <div className="min-h-screen flex flex-col items-center justify-center bg-[#f8f9fa] text-center p-6 w-full">
                <div className="max-w-md bg-white rounded-[32px] p-10 border border-gray-100/80 shadow-[0_8px_30px_rgb(0,0,0,0.03)] transition-all hover:shadow-[0_12px_40px_rgb(0,0,0,0.05)]">
                  <div className="w-16 h-16 bg-[#0089CD]/10 text-[#0089CD] rounded-2xl flex items-center justify-center mx-auto mb-6 animate-pulse">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
                      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                    </svg>
                  </div>
                  <h1 className="text-2xl font-black text-gray-900 uppercase tracking-tight mb-3">Under Maintenance</h1>
                  <p className="text-gray-600 text-sm mb-6 leading-relaxed">
                    {initialConfig?.store?.name || 'Store'} is currently undergoing scheduled updates to serve you better. We'll be back shortly. Thank you for your patience!
                  </p>
                  <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50 px-4 py-2 rounded-full inline-block">
                    Coming Back Soon
                  </div>
                </div>
              </div>
            ) : (
              children
            )}
            <Toaster
              position="top-right"
              richColors
              closeButton
              duration={4000}
            />
            <OfflineBanner />
            </StorefrontConfigProvider>
            </WishlistProvider>
          </CartProvider>
        </AuthProvider>
        {process.env.NODE_ENV === 'production' && (
          <script
            dangerouslySetInnerHTML={{
              __html: `
                if ('serviceWorker' in navigator) {
                  window.addEventListener('load', () => {
                    navigator.serviceWorker.register('/sw.js').catch(() => {});
                  });
                }
              `,
            }}
          />
        )}
      </body>
    </html>
  );
}
