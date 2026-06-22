"use client";

import { useState } from "react";
import type { Product } from "@/lib/types";

interface SectionProps {
  section: any;
  index: number;
  products?: Product[];
}

function HeroSection({ section }: SectionProps) {
  return (
    <section className="relative min-h-[70vh] flex items-center bg-gradient-to-br from-indigo-900 via-purple-900 to-slate-900 text-white overflow-hidden">
      {section.image && (
        <div className="absolute inset-0 bg-cover bg-center opacity-30" style={{ backgroundImage: `url(${section.image})` }} />
      )}
      <div className="relative z-10 max-w-4xl mx-auto px-6 text-center py-20">
        <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">{section.title || "Premium Collection"}</h1>
        {section.subtitle && <p className="text-lg md:text-xl text-white/80 mb-8 max-w-2xl mx-auto">{section.subtitle}</p>}
        {section.ctaText && (
          <button
            onClick={() => window.EcoMate?.track?.("ViewContent", { section: "hero" })}
            className="inline-block bg-white text-gray-900 font-bold px-8 py-4 rounded-full text-lg hover:bg-gray-100 transition-all transform hover:scale-105 shadow-2xl"
          >
            {section.ctaText}
          </button>
        )}
      </div>
    </section>
  );
}

function FeaturesSection({ section }: SectionProps) {
  const items = section.items || [
    { text: "Premium Quality Fabrics" },
    { text: "Free Delivery Across Bangladesh" },
    { text: "Easy 7-Day Returns" },
    { text: "Cash on Delivery Available" },
    { text: "24/7 Customer Support" },
    { text: "Authentic Products Guaranteed" },
  ];
  return (
    <section className="py-16 md:py-24 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-bold text-center text-gray-900 mb-12">{section.title || "Why Choose Us"}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          {items.map((item: any, i: number) => (
            <div key={i} className="bg-gray-50 rounded-2xl p-6 text-center hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-indigo-600 text-xl font-bold">✓</span>
              </div>
              <p className="text-gray-700 font-medium">{item.text || "Feature"}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeaturedGridSection({ section, products = [] }: SectionProps) {
  if (products.length === 0) {
    return (
      <section className="py-16 md:py-24 bg-gray-50">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-bold text-center text-gray-900 mb-12">{section.title || "Our Products"}</h2>
          <p className="text-center text-gray-400">Select products in the admin panel.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="py-16 md:py-24 bg-gray-50">
      <div className="max-w-6xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-bold text-center text-gray-900 mb-12">{section.title || "Our Products"}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          {products.map((p: any, i: number) => (
            <div key={p.id} className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-shadow">
              <div className="aspect-square bg-gray-100 relative">
                {p.images?.[0] && <img src={p.images[0]} alt={p.name} className="w-full h-full object-cover" />}
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 text-sm mb-1">{p.name}</h3>
                <p className="text-lg font-bold text-indigo-600">
                  ৳{(p.salePrice ? Number(p.salePrice) : Number(p.basePrice)).toLocaleString()}
                </p>
                <button
                  onClick={() => window.EcoMate?.track?.("AddToCart", { productId: p.id, name: p.name })}
                  className="mt-3 w-full bg-indigo-600 text-white text-sm font-bold py-2.5 rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Add to Cart
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CheckoutFormSection({ section }: SectionProps) {
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    window.EcoMate?.track?.("Lead", { section: "checkout" });
    window.EcoMate?.track?.("InitiateCheckout", {});
    setSubmitted(true);
  };

  if (submitted) {
    return (
      <section className="py-16 md:py-24 bg-white">
        <div className="max-w-lg mx-auto px-6 text-center">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Order Received!</h2>
          <p className="text-gray-500">We will contact you shortly to confirm your order.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="py-16 md:py-24 bg-white">
      <div className="max-w-lg mx-auto px-6">
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">{section.title || "Order Now"}</h2>
        <p className="text-gray-500 text-center mb-8">Fill in your details to place your order</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="Your Full Name" required
            className="w-full px-4 py-3.5 rounded-xl border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-sm" />
          <input type="tel" placeholder="Phone Number" required
            className="w-full px-4 py-3.5 rounded-xl border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-sm" />
          <textarea placeholder="Full Address" required rows={3}
            className="w-full px-4 py-3.5 rounded-xl border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-sm resize-none" />
          <select
            className="w-full px-4 py-3.5 rounded-xl border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-sm bg-white"
          >
            <option value="">Select Payment Method</option>
            <option value="cod">Cash on Delivery</option>
            <option value="bkash">bKash</option>
            <option value="nagad">Nagad</option>
          </select>
          <button type="submit"
            className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl text-lg hover:bg-indigo-700 transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg"
          >
            {section.submitText || "Place Order"}
          </button>
        </form>
      </div>
    </section>
  );
}

function TrustBadgesSection({ section }: SectionProps) {
  const badges = [
    { icon: "🚚", label: "Free Delivery" },
    { icon: "💳", label: "Cash on Delivery" },
    { icon: "🔄", label: "Easy Returns" },
    { icon: "🔒", label: "Secure Payment" },
  ];
  return (
    <section className="py-12 bg-gray-50 border-y border-gray-200">
      <div className="max-w-4xl mx-auto px-6">
        <h3 className="text-center text-gray-500 text-sm font-medium uppercase tracking-wider mb-6">{section.title || "Why Shop With Us"}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {badges.map((b, i) => (
            <div key={i} className="bg-white rounded-xl p-4 shadow-sm text-center">
              <div className="text-2xl mb-2">{b.icon}</div>
              <p className="text-sm font-medium text-gray-700">{b.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function CTASection({ section }: SectionProps) {
  return (
    <section className="py-20 bg-gradient-to-r from-indigo-600 to-purple-600 text-white">
      <div className="max-w-3xl mx-auto px-6 text-center">
        <h2 className="text-3xl md:text-4xl font-bold mb-4">{section.title || "Limited Time Offer"}</h2>
        {section.subtitle && <p className="text-white/80 text-lg mb-8">{section.subtitle}</p>}
        {section.ctaText && (
          <button
            onClick={() => window.EcoMate?.track?.("ViewContent", { section: "cta" })}
            className="inline-block bg-white text-indigo-600 font-bold px-10 py-4 rounded-full text-lg hover:bg-gray-100 transition-all transform hover:scale-105 shadow-2xl"
          >
            {section.ctaText}
          </button>
        )}
      </div>
    </section>
  );
}

export default function LandingTemplateRenderer({
  sections,
  products,
}: {
  sections: any[];
  products?: any[];
}) {
  return (
    <div className="min-h-screen font-sans antialiased">
      {sections.map((section: any, i: number) => {
        switch (section.type) {
          case "hero": return <HeroSection key={i} section={section} index={i} />;
          case "features": return <FeaturesSection key={i} section={section} index={i} />;
          case "featured-grid": return <FeaturedGridSection key={i} section={section} index={i} products={products} />;
          case "checkout-form": return <CheckoutFormSection key={i} section={section} index={i} />;
          case "trust-badges": return <TrustBadgesSection key={i} section={section} index={i} />;
          case "cta-footer": return <CTASection key={i} section={section} index={i} />;
          default: return null;
        }
      })}
    </div>
  );
}
