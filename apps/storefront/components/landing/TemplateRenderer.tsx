"use client";

import { useState, useEffect, useCallback } from "react";
import { LandingOrderProvider, useOrder, type OrderLineItem } from "./LandingOrderContext";
import { CountdownTimer, StockIndicator } from "./LandingUtils";

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
        {/* Offer badge */}
        {section.badgeText && (
          <div className="inline-block bg-red-500 text-white text-sm font-bold px-4 py-1.5 rounded-full mb-6 shadow-lg">
            {section.badgeText}
          </div>
        )}
        <h1 className="text-4xl md:text-6xl font-bold leading-tight mb-6">{section.title || "Premium Collection"}</h1>
        {section.subtitle && <p className="text-lg md:text-xl text-white/80 mb-8 max-w-2xl mx-auto">{section.subtitle}</p>}
        {/* Countdown and stock */}
        <div className="flex items-center justify-center gap-3 mb-8">
          {section.offerEndsAt && <CountdownTimer targetDate={section.offerEndsAt} />}
          {section.stockCount && <StockIndicator count={section.stockCount} />}
        </div>
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
    { text: "ক্যাশ অন ডেলিভারি", icon: "💵" },
    { text: "সারাদেশে ফ্রি ডেলিভারি", icon: "🚚" },
    { text: "৭ দিনের ইজি রিটার্ন", icon: "🔄" },
    { text: "১০০% অরিজিনাল প্রোডাক্ট", icon: "✅" },
    { text: "২৪/৭ গ্রাহক সাপোর্ট", icon: "🎧" },
    { text: "নিরাপদ পেমেন্ট", icon: "🛡️" },
  ];
  return (
    <section className="py-16 md:py-24 bg-white">
      <div className="max-w-6xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-bold text-center text-gray-900 mb-12">{section.title || "কেন আমাদের কাছ থেকে কিনবেন?"}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
          {items.map((item: any, i: number) => (
            <div key={i} className="bg-gray-50 rounded-2xl p-6 text-center hover:shadow-lg transition-shadow">
              <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-xl">{item.icon || "✓"}</span>
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
  const { items, updateItem } = useOrder();

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

  const getQty = (productId: string) => items.find(i => i.productId === productId)?.quantity || 0;

  return (
    <section className="py-16 md:py-24 bg-gray-50">
      <div className="max-w-6xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-bold text-center text-gray-900 mb-12">{section.title || "Our Products"}</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
          {products.map((p: any) => {
            const price = parseFloat(String(p.salePrice || p.basePrice || p.price || 0));
            const qty = getQty(p.id);
            const variants = p.variants?.filter((v: any) => v.isActive) || [];
            const firstVariant = variants[0];
            return (
            <div key={p.id} className="bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow-lg transition-shadow">
              <div className="aspect-square bg-gray-100 relative">
                {p.images?.[0] && <img src={p.images[0]} alt={p.name} className="w-full h-full object-cover" />}
              </div>
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 text-sm mb-1">{p.name}</h3>
                <p className="text-lg font-bold text-indigo-600 mb-3">৳{price.toLocaleString('en-BD')}</p>

                {/* Inline variant selector */}
                {variants.length > 1 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {variants.map((v: any) => {
                      const isSelected = items.find(i => i.productId === p.id)?.variantId === v.id;
                      return (
                        <button
                          key={v.id}
                          onClick={() => {
                            updateItem(p.id, {
                              variantId: v.id,
                              variantLabel: v.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / '),
                              price: parseFloat(String(v.price || p.salePrice || p.basePrice || 0)),
                              maxStock: v.stock ?? 999,
                              quantity: isSelected ? 0 : 1,
                            });
                          }}
                          className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${
                            isSelected
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                          }`}
                        >
                          {v.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / ')}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Quantity stepper */}
                <div className="flex items-center justify-between border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    onClick={() => {
                      const newQty = Math.max(0, qty - 1);
                      if (newQty === 0) updateItem(p.id, { quantity: 0 });
                      else updateItem(p.id, { quantity: newQty });
                    }}
                    className="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors text-lg font-medium"
                  >
                    {qty > 0 ? '−' : ''}
                  </button>
                  <span className="w-10 text-center text-sm font-semibold">{qty || 0}</span>
                  <button
                    onClick={() => {
                      if (qty === 0) {
                        // First add — use default variant
                        updateItem(p.id, {
                          productName: p.name,
                          productImage: p.images?.[0],
                          variantId: firstVariant?.id,
                          variantLabel: firstVariant?.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / '),
                          price: parseFloat(String(firstVariant?.price || p.salePrice || p.basePrice || p.price || 0)),
                          maxStock: firstVariant?.stock ?? p.stock ?? 999,
                          quantity: 1,
                        });
                      } else {
                        updateItem(p.id, { quantity: Math.min(qty + 1, 99) });
                      }
                      window.EcoMate?.track?.("AddToCart", { productId: p.id, name: p.name });
                    }}
                    className="w-9 h-9 flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors text-lg font-medium"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function CheckoutFormSection({ section }: SectionProps) {
  const [step, setStep] = useState<"form" | "submitting" | "success" | "error">("form");
  const [errorMsg, setErrorMsg] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const { items, deliveryZone, setDeliveryZone, subtotal, deliveryCharge, total, reset: resetOrder } = useOrder();

  const validatePhone = (phone: string): boolean => {
    const cleaned = phone.replace(/[\s-]/g, '');
    if (!/^01[3-9]\d{8}$/.test(cleaned) && !/^\+8801[3-9]\d{8}$/.test(cleaned)) {
      setPhoneError("Valid BD phone number required: 01XXXXXXXXX");
      return false;
    }
    setPhoneError("");
    return true;
  };

  const deliveryZones = section.deliveryZones || [
    { label: "ঢাকার ভিতরে", charge: 60 },
    { label: "ঢাকার বাইরে", charge: 120 },
  ];

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

    if (!validatePhone(phone)) return;

    // Build order items from shared context
    const orderItems = items
      .filter(i => i.quantity > 0)
      .map(i => ({
        productId: i.productId,
        variantId: i.variantId || undefined,
        quantity: i.quantity,
        price: i.price,
      }));

    if (orderItems.length === 0) {
      setErrorMsg("Please select at least one product above");
      setStep("form");
      return;
    }

    setStep("submitting");

    const payload: Record<string, any> = {
      items: orderItems,
      guestName: name,
      guestPhone: phone,
      shippingAddress: { fullAddress: address, deliveryZone: deliveryZone.label },
      paymentOptionType: payment === "cod" ? "CASH_ON_DELIVERY" : "FULL_PAYMENT",
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
      resetOrder();
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

        {/* Order Summary */}
        {items.filter(i => i.quantity > 0).length > 0 && (
          <div className="bg-gray-50 rounded-xl p-4 mb-6 space-y-2">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Order Summary</h3>
            {items.filter(i => i.quantity > 0).map(item => (
              <div key={item.productId} className="flex justify-between text-sm">
                <span className="text-gray-600">{item.productName}{item.variantLabel ? ` (${item.variantLabel})` : ''} × {item.quantity}</span>
                <span className="font-medium">৳{(item.price * item.quantity).toLocaleString()}</span>
              </div>
            ))}
            <div className="border-t pt-2 mt-2 space-y-1">
              <div className="flex justify-between text-sm text-gray-500">
                <span>Subtotal</span>
                <span>৳{subtotal.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm text-gray-500">
                <span>Delivery ({deliveryZone.label})</span>
                <span>৳{deliveryCharge.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-gray-900 border-t pt-1">
                <span>Total</span>
                <span>৳{total.toLocaleString()}</span>
              </div>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl">{errorMsg}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" name="name" placeholder="Your Full Name" required
            className="w-full px-4 py-3.5 rounded-xl border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-sm" />
          <div>
            <input type="tel" name="phone" placeholder="Phone Number (01XXXXXXXXX)" required
              onChange={e => { if (phoneError) validatePhone(e.target.value); }}
              onBlur={e => { if (e.target.value) validatePhone(e.target.value); }}
              className="w-full px-4 py-3.5 rounded-xl border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-sm" />
            {phoneError && <p className="text-xs text-red-500 mt-1">{phoneError}</p>}
          </div>
          <textarea name="address" placeholder="Full Address" required rows={3}
            className="w-full px-4 py-3.5 rounded-xl border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-sm resize-none" />

          {/* Delivery Zone */}
          <div className="space-y-1.5">
            <p className="text-xs text-gray-500 font-medium">Delivery Area</p>
            <div className="grid grid-cols-2 gap-2">
              {deliveryZones.map((z: any) => (
                <button
                  key={z.label}
                  type="button"
                  onClick={() => setDeliveryZone(z)}
                  className={`px-3 py-2.5 rounded-xl border text-sm transition-colors ${
                    deliveryZone.label === z.label
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-indigo-400'
                  }`}
                >
                  <span className="block font-medium">{z.label}</span>
                  <span className="block text-xs opacity-80">+৳{z.charge}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Payment Method — visual cards */}
          <div className="space-y-1.5">
            <p className="text-xs text-gray-500 font-medium">Payment Method</p>
            <select name="payment"
              className="w-full px-4 py-3.5 rounded-xl border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-sm bg-white"
            >
              <option value="">Select Payment Method</option>
              <option value="cod">💵 Cash on Delivery</option>
              <option value="bkash">💳 bKash</option>
              <option value="nagad">💳 Nagad</option>
              <option value="rocket">💳 Rocket</option>
            </select>
          </div>

          <p className="text-center text-xs text-gray-400">১-৩ কর্মদিবসে ডেলিভারি</p>

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
  const badges = section.items || [
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
          {badges.map((b: any, i: number) => (
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
        {section.badgeText && (
          <div className="inline-block bg-red-500 text-white text-sm font-bold px-4 py-1.5 rounded-full mb-6 shadow-lg">
            {section.badgeText}
          </div>
        )}
        <h2 className="text-3xl md:text-4xl font-bold mb-4">{section.title || "Limited Time Offer"}</h2>
        {section.subtitle && <p className="text-white/80 text-lg mb-8">{section.subtitle}</p>}
        <div className="flex items-center justify-center gap-3 mb-8">
          {section.offerEndsAt && <CountdownTimer targetDate={section.offerEndsAt} />}
          {section.stockCount && <StockIndicator count={section.stockCount} />}
        </div>
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

// ── New section types (§8) ──────────────────────────────────

function ImageGallerySection({ section }: SectionProps) {
  const [active, setActive] = useState(0);
  const images = section.images || [];
  if (images.length === 0) return null;
  return (
    <section className="py-16 bg-white">
      <div className="max-w-4xl mx-auto px-6">
        {section.title && <h2 className="text-2xl font-bold text-center text-gray-900 mb-8">{section.title}</h2>}
        <div className="relative aspect-video bg-gray-100 rounded-2xl overflow-hidden">
          <img src={images[active]} alt="" className="w-full h-full object-cover" />
        </div>
        {images.length > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            {images.map((_: string, i: number) => (
              <button key={i} onClick={() => setActive(i)}
                className={`w-2.5 h-2.5 rounded-full transition-colors ${i === active ? 'bg-indigo-600' : 'bg-gray-300'}`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function VideoEmbedSection({ section }: SectionProps) {
  if (!section.videoUrl) return null;
  const isYoutube = section.videoUrl.includes('youtube.com') || section.videoUrl.includes('youtu.be');
  if (isYoutube) {
    const embedUrl = section.videoUrl.replace('watch?v=', 'embed/').split('&')[0];
    return (
      <section className="py-16 bg-white">
        <div className="max-w-4xl mx-auto px-6">
          {section.title && <h2 className="text-2xl font-bold text-center text-gray-900 mb-8">{section.title}</h2>}
          <div className="aspect-video rounded-2xl overflow-hidden">
            <iframe src={embedUrl} className="w-full h-full" allowFullScreen title="Video" />
          </div>
        </div>
      </section>
    );
  }
  return (
    <section className="py-16 bg-white">
      <div className="max-w-4xl mx-auto px-6">
        {section.title && <h2 className="text-2xl font-bold text-center text-gray-900 mb-8">{section.title}</h2>}
        <div className="aspect-video rounded-2xl overflow-hidden bg-black">
          <video src={section.videoUrl} controls className="w-full h-full" />
        </div>
      </div>
    </section>
  );
}

function TestimonialsSection({ section }: SectionProps) {
  const items = section.items || [];
  if (items.length === 0) return null;
  return (
    <section className="py-16 bg-gray-50">
      <div className="max-w-4xl mx-auto px-6">
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-10">{section.title || "What Our Customers Say"}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {items.map((t: any, i: number) => (
            <div key={i} className="bg-white rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold">{t.name?.[0] || '?'}</div>
                <div>
                  <p className="font-medium text-sm">{t.name || 'Customer'}</p>
                  {t.rating && <p className="text-xs text-amber-500">{'★'.repeat(t.rating)}{'☆'.repeat(5 - t.rating)}</p>}
                </div>
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">{t.text || ''}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FAQSection({ section }: SectionProps) {
  const items = section.items || [];
  if (items.length === 0) return null;
  return (
    <section className="py-16 bg-white">
      <div className="max-w-3xl mx-auto px-6">
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-8">{section.title || "Frequently Asked Questions"}</h2>
        <div className="space-y-3">
          {items.map((faq: any, i: number) => (
            <details key={i} className="bg-gray-50 rounded-xl overflow-hidden">
              <summary className="px-5 py-4 font-medium text-sm text-gray-800 cursor-pointer hover:bg-gray-100 transition-colors">
                {faq.question || ''}
              </summary>
              <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">{faq.answer || ''}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function LandingTemplateRenderer({
  sections,
  products,
  primaryColor,
}: {
  sections: any[];
  products?: any[];
  primaryColor?: string;
}) {
  // Initialize order items from products
  const initialItems: OrderLineItem[] = (products || []).map((p: any) => {
    const firstVariant = p.variants?.find((v: any) => v.isActive);
    return {
      productId: p.id,
      productName: p.name,
      productImage: p.images?.[0],
      variantId: firstVariant?.id,
      variantLabel: firstVariant?.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / '),
      quantity: 0,
      price: parseFloat(String(firstVariant?.price || p.salePrice || p.basePrice || p.price || 0)),
      maxStock: firstVariant?.stock ?? p.stock ?? 999,
    };
  });

  return (
    <LandingOrderProvider initialItems={initialItems}>
      <div className="min-h-screen font-sans antialiased"
        style={primaryColor ? { '--brand-primary': primaryColor } as React.CSSProperties : undefined}>
        {sections.map((section: any, i: number) => {
          const sectionProps = { section, index: i, products };
          switch (section.type) {
            case "hero": return <HeroSection key={i} {...sectionProps} />;
            case "features": return <FeaturesSection key={i} {...sectionProps} />;
            case "featured-grid": return <FeaturedGridSection key={i} {...sectionProps} />;
            case "checkout-form": return <CheckoutFormSection key={i} {...sectionProps} />;
            case "trust-badges": return <TrustBadgesSection key={i} {...sectionProps} />;
            case "cta-footer": return <CTASection key={i} {...sectionProps} />;
          case "image-gallery": return <ImageGallerySection key={i} {...sectionProps} />;
          case "video-embed": return <VideoEmbedSection key={i} {...sectionProps} />;
          case "testimonials": return <TestimonialsSection key={i} {...sectionProps} />;
          case "faq": return <FAQSection key={i} {...sectionProps} />;
            default: return null;
          }
        })}
        {/* Sticky bottom order bar for mobile */}
        <MobileOrderBar />
      </div>
    </LandingOrderProvider>
  );
}

function MobileOrderBar() {
  const { items, total } = useOrder();
  const count = items.filter(i => i.quantity > 0).length;
  if (count === 0) return null;
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] md:hidden">
      <div className="flex items-center justify-between px-4 py-3 max-w-screen-xl mx-auto">
        <div>
          <p className="text-xs text-gray-500">{count} item{count > 1 ? 's' : ''} selected</p>
          <p className="text-lg font-bold text-indigo-600">৳{total.toLocaleString()}</p>
        </div>
        <a
          href="#checkout-form"
          className="bg-indigo-600 text-white font-bold px-6 py-2.5 rounded-lg text-sm hover:bg-indigo-700 transition-colors"
        >
          Order Now
        </a>
      </div>
    </div>
  );
}
