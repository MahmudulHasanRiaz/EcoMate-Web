"use client";

import { useState } from "react";

interface SectionProps {
  section: any;
  index: number;
  products?: any[];
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
          {products.map((p: any, i: number) => {
            const price = parseFloat(String(p.salePrice || p.basePrice || p.price || 0));
            return (
            <div key={p.id} className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-shadow">
              <div className="aspect-square bg-gray-100 relative">
                {p.images?.[0] && <img src={p.images[0]} alt={p.name} className="w-full h-full object-cover" />}
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 text-sm mb-1">{p.name}</h3>
                <p className="text-lg font-bold text-indigo-600">
                  ৳{price.toLocaleString('en-BD')}
                </p>
                <button
                  onClick={() => window.EcoMate?.track?.("AddToCart", { productId: p.id, name: p.name })}
                  className="mt-3 w-full bg-indigo-600 text-white text-sm font-bold py-2.5 rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Add to Cart
                </button>
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CheckoutFormSection({ section, products = [] }: SectionProps) {
  const [step, setStep] = useState<"form" | "submitting" | "success" | "error">("form");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg("");

    const form = e.currentTarget;
    const name = (form.elements.namedItem("name") as HTMLInputElement).value;
    const phone = (form.elements.namedItem("phone") as HTMLInputElement).value;
    const address = (form.elements.namedItem("address") as HTMLTextAreaElement).value;
    const payment = (form.elements.namedItem("payment") as HTMLSelectElement).value;

    window.EcoMate?.track?.("Lead", { section: "checkout" });

    if (!name || !phone) {
      setErrorMsg("Name and phone are required");
      return;
    }

    setStep("submitting");

    // Build order items from assigned products
    const items = products
      .filter((p: any) => p.id)
      .map((p: any) => ({
        productId: p.id,
        quantity: 1,
        price: parseFloat(String(p.salePrice || p.basePrice || p.price || 0)),
      }));

    if (items.length === 0) {
      setErrorMsg("No products assigned to this page. Please contact support.");
      setStep("form");
      return;
    }

    const payload: Record<string, any> = {
      items,
      guestName: name,
      guestPhone: phone,
      shippingAddress: { fullAddress: address },
      paymentOptionType: payment === "cod" ? "CASH_ON_DELIVERY" : payment === "bkash" ? "FULL_PAYMENT" : "FULL_PAYMENT",
      gatewayCode: payment || "cash",
    };

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || `Order failed (${res.status})`);
      }

      const order = await res.json();
      window.EcoMate?.track?.("InitiateCheckout", { orderId: order.id });
      setStep("success");
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to place order. Please try again.");
      setStep("form");
    }
  };

  if (step === "success") {
    return (
      <section className="py-16 md:py-24 bg-white">
        <div className="max-w-lg mx-auto px-6 text-center">
          <div className="text-5xl mb-4">✅</div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Order Placed!</h2>
          <p className="text-gray-500 mb-6">We will contact you shortly to confirm your order.</p>
          <p className="text-xs text-gray-400">Check your order status using your phone number.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="py-16 md:py-24 bg-white">
      <div className="max-w-lg mx-auto px-6">
        <h2 className="text-3xl font-bold text-center text-gray-900 mb-4">{section.title || "Order Now"}</h2>
        <p className="text-gray-500 text-center mb-8">Fill in your details to place your order</p>

        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">{errorMsg}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" name="name" placeholder="Your Full Name" required
            className="w-full px-4 py-3.5 rounded-xl border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-sm" />
          <input type="tel" name="phone" placeholder="Phone Number" required
            className="w-full px-4 py-3.5 rounded-xl border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-sm" />
          <textarea name="address" placeholder="Full Address" required rows={3}
            className="w-full px-4 py-3.5 rounded-xl border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-sm resize-none" />
          <select name="payment"
            className="w-full px-4 py-3.5 rounded-xl border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-sm bg-white"
          >
            <option value="">Select Payment Method</option>
            <option value="cod">Cash on Delivery</option>
            <option value="bkash">bKash</option>
            <option value="nagad">Nagad</option>
          </select>
          <button
            type="submit"
            disabled={step === "submitting"}
            className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl text-lg hover:bg-indigo-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
          >
            {step === "submitting" ? "Placing Order..." : section.submitText || "Place Order"}
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
        const sectionProps = { section, index: i, products };
        switch (section.type) {
          case "hero": return <HeroSection key={i} {...sectionProps} />;
          case "features": return <FeaturesSection key={i} {...sectionProps} />;
          case "featured-grid": return <FeaturedGridSection key={i} {...sectionProps} />;
          case "checkout-form": return <CheckoutFormSection key={i} {...sectionProps} />;
          case "trust-badges": return <TrustBadgesSection key={i} {...sectionProps} />;
          case "cta-footer": return <CTASection key={i} {...sectionProps} />;
          default: return null;
        }
      })}
    </div>
  );
}
