import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import BottomNav from "@/components/BottomNav";
import {
  LazyCartDrawer,
  LazyMobileMenu,
  LazyFloatingWidgets,
} from "@/components/ClientChrome";
import HideOnCheckout from "@/components/HideOnCheckout";
import FlyCartLayer from "@/components/FlyCartLayer";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";

/**
 * D7 — when search-engine indexing is OFF, every page under (main)
 * carries `noindex, nofollow`. Private segments (account, checkout, …)
 * keep their own explicit noindex regardless of the flag.
 */
export async function generateMetadata(): Promise<Metadata> {
  const config = await getStorefrontConfigServer().catch(() => null);
  if (config?.searchIndexingEnabled === true) return {};
  return { robots: { index: false, follow: false } };
}

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // P5 (JS diet): Footer is a Server Component now and receives the config
  // as a prop. getStorefrontConfigServer is React-cached and the root layout
  // already fetched it for this request, so this costs no extra fetch.
  const config = await getStorefrontConfigServer();

  return (
    <>
      <Header />
      <LazyCartDrawer />
      <LazyMobileMenu />
      <main className="flex-1 pb-24 md:pb-0">{children}</main>
      <HideOnCheckout>
        <Footer config={config} />
      </HideOnCheckout>
      <BottomNav />
      <LazyFloatingWidgets />
      <FlyCartLayer />
    </>
  );
}
