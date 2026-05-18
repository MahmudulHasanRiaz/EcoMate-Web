import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/context/CartContext";
import { AuthProvider } from "@/context/AuthContext";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import BottomNav from "@/components/BottomNav";
import CartDrawer from "@/components/CartDrawer";
import MobileMenu from "@/components/MobileMenu";
import FloatingWidgets from "@/components/FloatingWidgets";
import FlyCartLayer from "@/components/FlyCartLayer";
import TrackingScripts from "@/components/TrackingScripts";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Fixed Plus - Premium Gadgets & Repair Services in Bangladesh",
  description:
    "Shop premium gadgets, expert repair services, and smart home solutions at Fixed Plus. Fast delivery across Bangladesh with genuine products and official warranty.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="min-h-screen flex flex-col bg-gray-50 text-gray-900 antialiased" suppressHydrationWarning>
        <TrackingScripts />
        <AuthProvider>
          <CartProvider>
            <Header />
            <CartDrawer />
            <MobileMenu />
            <main className="flex-1 pb-24 md:pb-0">{children}</main>
            <Footer />
            <BottomNav />
            <FloatingWidgets />
            <FlyCartLayer />
          </CartProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
