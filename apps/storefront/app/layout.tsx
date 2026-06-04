import type { Metadata } from "next";
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
      icons: faviconUrl
        ? {
            icon: [{ url: faviconUrl }],
          }
        : undefined,
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

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="min-h-screen flex flex-col bg-gray-50 text-gray-900 antialiased" suppressHydrationWarning>
        {initialConfig ? (
          <script id="__INITIAL_CONFIG__" type="application/json" dangerouslySetInnerHTML={{ __html: JSON.stringify(initialConfig) }} />
        ) : null}
        <AuthProvider>
          <CartProvider>
            <WishlistProvider>
            <StorefrontConfigProvider initialConfig={initialConfig}>
            <TrackingScripts />
            <Header />
            <CartDrawer />
            <MobileMenu />
            <main className="flex-1 pb-24 md:pb-0">{children}</main>
            <Footer />
            <BottomNav />
            <FloatingWidgets />
            <FlyCartLayer />
            </StorefrontConfigProvider>
            </WishlistProvider>
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
