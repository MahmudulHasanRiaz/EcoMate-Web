import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/context/CartContext";
import { AuthProvider } from "@/context/AuthContext";
import { WishlistProvider } from "@/context/WishlistContext";
import { StorefrontConfigProvider } from "@/context/StorefrontConfigContext";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import BottomNav from "@/components/BottomNav";
import CartDrawer from "@/components/CartDrawer";
import MobileMenu from "@/components/MobileMenu";
import FloatingWidgets from "@/components/FloatingWidgets";
import FlyCartLayer from "@/components/FlyCartLayer";
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
  };

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#16a34a" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="apple-mobile-web-app-title" content="EcoMate" />
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
            <Header />
            <CartDrawer />
            <MobileMenu />
            <main className="flex-1 pb-24 md:pb-0">{children}</main>
            <Footer />
            <BottomNav />
            <FloatingWidgets />
            <FlyCartLayer />
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
