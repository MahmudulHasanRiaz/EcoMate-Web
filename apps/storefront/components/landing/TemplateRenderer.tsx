"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
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
        <div className="absolute inset-0 opacity-30">
          <Image src={section.image} alt="Hero background" fill className="object-cover" />
        </div>
      )}
      <div className="relative z-10 max-w-5xl mx-auto px-6 text-center py-24 md:py-32">
        {/* Offer badge */}
        {section.badgeText && (
          <div className="inline-flex items-center gap-2 bg-white/20 backdrop-blur-md border border-white/30 text-white text-sm font-semibold px-5 py-2 rounded-full mb-8 shadow-[0_8px_30px_rgb(0,0,0,0.12)] transform hover:scale-105 transition-transform cursor-default">
            <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse"></span>
            {section.badgeText}
          </div>
        )}
        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1] mb-8 drop-shadow-lg">{section.title || "Premium Collection"}</h1>
        {section.subtitle && <p className="text-xl md:text-2xl text-white/90 mb-10 max-w-3xl mx-auto font-medium leading-relaxed drop-shadow-md">{section.subtitle}</p>}
        {/* Countdown and stock */}
        <div className="flex flex-wrap items-center justify-center gap-4 mb-10">
          {section.offerEndsAt && <CountdownTimer targetDate={section.offerEndsAt} />}
          {section.stockCount && <StockIndicator count={section.stockCount} />}
        </div>
        {section.ctaText && (
          <button
            onClick={() => {
              window.EcoMate?.track?.("ViewContent", { section: "hero" });
              document.getElementById('checkout')?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="inline-block bg-white text-gray-900 font-extrabold px-10 py-5 rounded-full text-lg hover:bg-gray-50 transition-all duration-300 transform hover:scale-105 hover:-translate-y-1 shadow-[0_20px_40px_rgba(255,255,255,0.2)]"
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
    <section className="py-20 md:py-32 bg-gradient-to-b from-gray-50 to-white relative">
      <div className="max-w-6xl mx-auto px-6">
        <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-center text-gray-900 mb-16">{section.title || "কেন আমাদের কাছ থেকে কিনবেন?"}</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-6 md:gap-8">
          {items.map((item: any, i: number) => (
            <div key={i} className="bg-white/60 backdrop-blur-xl border border-white/50 rounded-3xl p-8 text-center shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:-translate-y-1.5 hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)] transition-all duration-300 group">
              <div className="w-16 h-16 bg-[var(--brand-primary,#4f46e5)]/10 text-[var(--brand-primary,#4f46e5)] rounded-2xl flex items-center justify-center mx-auto mb-6 group-hover:scale-110 transition-transform duration-300">
                <span className="text-3xl">{item.icon || "✓"}</span>
              </div>
              <p className="text-gray-800 font-bold text-lg">{item.text || "Feature"}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DynamicProductSection({ section, products = [] }: SectionProps) {
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

  // Scenario C: Multiple Products (Combo or Store view)
  if (products.length > 1) {
    return (
      <section className="py-16 md:py-24 bg-gray-50">
        <div className="max-w-6xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-extrabold text-center text-gray-900 mb-12">{section.title || "Choose Your Package"}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
            {products.map((p: any) => {
              const variants = p.variants?.filter((v: any) => v.isActive) || [];
              const firstVariant = variants[0];
              const price = parseFloat(String(firstVariant?.price || p.salePrice || p.basePrice || p.price || 0));
              const qty = getQty(p.id);
              return (
              <div key={p.id} className="bg-white rounded-[24px] overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 hover:-translate-y-1.5 hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)] transition-all duration-500 group flex flex-col">
                <div className="aspect-square bg-gray-50 relative overflow-hidden">
                  {p.images?.[0] && <Image src={p.images[0]} alt={p.name} fill className="object-cover group-hover:scale-105 transition-transform duration-700 ease-out" sizes="(max-width: 768px) 50vw, 25vw" />}
                </div>
                <div className="p-5 md:p-6 flex flex-col flex-1">
                  <h3 className="font-bold text-gray-900 text-base md:text-lg mb-2 line-clamp-2 leading-tight">{p.name}</h3>
                  <p className="text-xl md:text-2xl font-extrabold text-[color:var(--brand-primary,#4f46e5)] mb-4">৳{price.toLocaleString('en-BD')}</p>
  
                  <div className="mt-auto">
                    {/* Inline variant selector */}
                    {variants.length > 1 && (
                      <div className="flex flex-wrap gap-2 mb-4">
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
                              className={`text-xs px-3.5 py-2 rounded-full border font-bold transition-all duration-300 ${
                                isSelected
                                  ? 'bg-[var(--brand-primary,#4f46e5)] text-white border-[var(--brand-primary,#4f46e5)] shadow-md'
                                  : 'bg-white text-gray-700 border-gray-200 hover:border-[var(--brand-primary,#4f46e5)]/50 hover:bg-gray-50'
                              }`}
                            >
                              {v.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / ')}
                            </button>
                          );
                        })}
                      </div>
                    )}
  
                    {/* Quantity stepper */}
                    <div className="flex items-center justify-between border border-gray-200 bg-gray-50/50 rounded-full overflow-hidden p-1">
                      <button
                        onClick={() => {
                          const newQty = Math.max(0, qty - 1);
                          if (newQty === 0) updateItem(p.id, { quantity: 0 });
                          else updateItem(p.id, { quantity: newQty });
                        }}
                        className="w-10 h-10 flex items-center justify-center bg-white rounded-full text-gray-600 hover:bg-gray-100 hover:text-gray-900 shadow-sm transition-all text-xl font-medium active:scale-95"
                      >
                        {qty > 0 ? '−' : ''}
                      </button>
                      <span className="w-12 text-center text-base font-bold text-gray-900">{qty || 0}</span>
                      <button
                        onClick={() => {
                          if (qty === 0) {
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
                        className="w-10 h-10 flex items-center justify-center bg-white rounded-full text-gray-600 hover:bg-gray-100 hover:text-gray-900 shadow-sm transition-all text-xl font-medium active:scale-95"
                      >
                        +
                      </button>
                    </div>
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

  // Scenarios A & B: Single Product (Simple or Variable)
  const p = products[0];
  const variants = p.variants?.filter((v: any) => v.isActive) || [];
  const firstVariant = variants[0];
  const price = parseFloat(String(firstVariant?.price || p.salePrice || p.basePrice || p.price || 0));
  const qty = getQty(p.id);

  return (
    <section className="py-16 md:py-24 bg-white">
      <div className="max-w-5xl mx-auto px-6">
        <h2 className="text-3xl md:text-4xl font-extrabold text-center text-gray-900 mb-12">{section.title || "Get Yours Today"}</h2>
        
        <div className="flex flex-col md:flex-row bg-white rounded-[32px] overflow-hidden shadow-[0_20px_60px_rgb(0,0,0,0.06)] border border-gray-100">
          {/* Image Side */}
          <div className="w-full md:w-1/2 bg-gray-50 relative aspect-square md:aspect-auto">
            {p.images?.[0] && <Image src={p.images[0]} alt={p.name} fill className="object-cover" sizes="(max-width: 768px) 100vw, 50vw" />}
          </div>
          
          {/* Content Side */}
          <div className="w-full md:w-1/2 p-8 md:p-12 flex flex-col justify-center">
            <h3 className="font-extrabold text-2xl md:text-3xl text-gray-900 mb-4">{p.name}</h3>
            <p className="text-3xl font-extrabold text-[color:var(--brand-primary,#4f46e5)] mb-8">৳{price.toLocaleString('en-BD')}</p>

            {/* Scenario B: Variable Product - Variant Selectors */}
            {variants.length > 1 && (
              <div className="mb-8">
                <p className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">Select Option</p>
                <div className="flex flex-wrap gap-3">
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
                            quantity: isSelected ? 0 : (qty === 0 ? 1 : qty),
                          });
                        }}
                        className={`px-5 py-3 rounded-xl border-2 font-bold transition-all duration-300 ${
                          isSelected
                            ? 'bg-[var(--brand-primary,#4f46e5)] text-white border-[var(--brand-primary,#4f46e5)] shadow-lg scale-105'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-[var(--brand-primary,#4f46e5)]/50 hover:bg-gray-50'
                        }`}
                      >
                        {v.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / ')}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Quantity Stepper (Same for both) */}
            <div className="mb-8">
               <p className="text-sm font-bold text-gray-700 mb-3 uppercase tracking-wider">Quantity</p>
               <div className="inline-flex items-center justify-between border-2 border-gray-100 bg-gray-50 rounded-2xl overflow-hidden p-1 w-48">
                  <button
                    onClick={() => {
                      const newQty = Math.max(0, qty - 1);
                      if (newQty === 0) updateItem(p.id, { quantity: 0 });
                      else updateItem(p.id, { quantity: newQty });
                    }}
                    className="w-12 h-12 flex items-center justify-center bg-white rounded-xl text-gray-600 hover:bg-gray-100 hover:text-gray-900 shadow-sm transition-all text-2xl font-medium active:scale-95"
                  >
                    −
                  </button>
                  <span className="w-12 text-center text-xl font-bold text-gray-900">{qty || 0}</span>
                  <button
                    onClick={() => {
                      if (qty === 0) {
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
                    className="w-12 h-12 flex items-center justify-center bg-white rounded-xl text-gray-600 hover:bg-gray-100 hover:text-gray-900 shadow-sm transition-all text-2xl font-medium active:scale-95"
                  >
                    +
                  </button>
               </div>
            </div>

            <button 
              onClick={() => {
                if (qty === 0) {
                   updateItem(p.id, {
                     productName: p.name,
                     productImage: p.images?.[0],
                     variantId: firstVariant?.id,
                     variantLabel: firstVariant?.attributeValues?.map((av: any) => av.attributeValue?.value).join(' / '),
                     price: parseFloat(String(firstVariant?.price || p.salePrice || p.basePrice || p.price || 0)),
                     maxStock: firstVariant?.stock ?? p.stock ?? 999,
                     quantity: 1,
                   });
                }
                document.getElementById('checkout')?.scrollIntoView({ behavior: 'smooth' });
              }}
              className="w-full bg-[var(--brand-primary,#4f46e5)] text-white font-extrabold py-5 rounded-2xl text-xl hover:brightness-90 transition-all shadow-[0_10px_30px_rgba(79,70,229,0.3)] hover:-translate-y-1"
            >
              Order Now 🚀
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

export function CheckoutFormSection({ section }: SectionProps) {
  const [step, setStep] = useState<"form" | "submitting" | "success" | "error">("form");
  const [errorMsg, setErrorMsg] = useState("");
  const [phoneRaw, setPhoneRaw] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const isValidPhone = phoneRaw.length === 11 && phoneRaw.startsWith("01");
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
    const phone = phoneRaw;
    const address = (form.elements.namedItem("address") as HTMLTextAreaElement).value;
    const payment = (form.elements.namedItem("payment") as HTMLInputElement).value;
    const couponCode = (form.elements.namedItem("couponCode") as HTMLInputElement)?.value || undefined;

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
      shippingCharge: deliveryZone.charge,
      paymentOptionType: payment === "cod" ? "CASH_ON_DELIVERY" : "FULL_PAYMENT",
      gatewayCode: payment === "cod" ? "cash" : payment,
      couponCode,
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
    <section id="checkout" className="py-20 md:py-32 bg-gray-50 relative">
      <div className="max-w-xl mx-auto px-6">
        <div className="bg-white rounded-[32px] shadow-[0_20px_60px_rgb(0,0,0,0.06)] border border-gray-100 p-6 md:p-10 relative overflow-hidden">
          {/* Subtle top gradient glow inside the card */}
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-transparent via-[var(--brand-primary,#4f46e5)] to-transparent opacity-50"></div>
          
          <h2 className="text-3xl md:text-4xl font-extrabold text-center text-gray-900 mb-3">{section.title || "Order Now"}</h2>
          <p className="text-gray-500 text-center mb-8 font-medium">Fill in your details to place your order securely</p>

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

        <form onSubmit={handleSubmit} className="space-y-5" onBlur={() => {
          if (typeof window !== "undefined" && (window as any).EcoMate?.track) {
            const form = document.querySelector('form');
            if (form) {
              const name = (form.elements.namedItem("name") as HTMLInputElement)?.value;
              const phone = (form.elements.namedItem("phone") as HTMLInputElement)?.value;
              if (name || phone) {
                (window as any).EcoMate.track('IncompleteOrder', { name, phone });
              }
            }
          }
        }}>
          <div className="space-y-4">
            <input type="text" name="name" placeholder="Your Full Name" required
              className="w-full px-5 py-4 rounded-2xl border border-gray-200 bg-gray-50/50 focus:bg-white focus:border-[var(--brand-primary,#4f46e5)] focus:ring-4 focus:ring-[var(--brand-primary,#4f46e5)]/10 outline-none transition-all text-sm md:text-base font-medium placeholder:font-normal" />
            <div className="relative">
              <input type="tel" name="phone" placeholder="Phone Number (11 digits)" required
                onChange={(e) => setPhoneRaw(e.target.value.replace(/[^0-9]/g, '').slice(0, 11))}
                value={phoneRaw}
                className="w-full px-5 py-4 rounded-2xl border border-gray-200 bg-gray-50/50 focus:bg-white focus:border-[var(--brand-primary,#4f46e5)] focus:ring-4 focus:ring-[var(--brand-primary,#4f46e5)]/10 outline-none transition-all text-sm md:text-base font-medium placeholder:font-normal" />
              {isValidPhone && (
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-green-500 text-xl bg-white rounded-full leading-none shadow-sm">✅</span>
              )}
            </div>
            <textarea name="address" placeholder="Full Delivery Address" required rows={3}
              className="w-full px-5 py-4 rounded-2xl border border-gray-200 bg-gray-50/50 focus:bg-white focus:border-[var(--brand-primary,#4f46e5)] focus:ring-4 focus:ring-[var(--brand-primary,#4f46e5)]/10 outline-none transition-all text-sm md:text-base resize-none font-medium placeholder:font-normal" />
          </div>

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
                      ? 'bg-[var(--brand-primary,#4f46e5)] text-white border-[var(--brand-primary,#4f46e5)]'
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
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: "cod", label: "Cash on Delivery", icon: "💵" },
                { id: "bkash", label: "bKash", icon: "💳" },
                { id: "nagad", label: "Nagad", icon: "💳" }
              ].map(method => (
                <label key={method.id} className="relative block cursor-pointer">
                  <input type="radio" name="payment" value={method.id} className="peer sr-only" defaultChecked={method.id === "cod"} />
                  <div className="px-3 py-3 rounded-xl border border-gray-200 bg-white text-sm transition-all peer-checked:border-[var(--brand-primary,#4f46e5)] peer-checked:bg-indigo-50 peer-checked:ring-1 peer-checked:ring-[var(--brand-primary,#4f46e5)] flex items-center gap-2 hover:border-indigo-400">
                    <span className="text-xl">{method.icon}</span>
                    <span className="font-medium text-gray-700 peer-checked:text-indigo-900">{method.label}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs text-gray-500 font-medium">Coupon Code (Optional)</p>
            <input type="text" name="couponCode" placeholder="Enter code"
              className="w-full px-4 py-3.5 rounded-xl border border-gray-300 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all text-sm bg-white" />
          </div>

          <p className="text-center text-xs text-gray-400">১-৩ কর্মদিবসে ডেলিভারি</p>

          <button
            type="submit"
            disabled={step === "submitting"}
            className="w-full bg-[var(--brand-primary,#4f46e5)] text-white font-bold py-4 rounded-xl text-lg hover:brightness-90 transition-all disabled:opacity-70 disabled:cursor-not-allowed shadow-lg flex items-center justify-center gap-2"
          >
            {step === "submitting" ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Placing Order...</span>
              </>
            ) : (
              section.submitText || "Place Order"
            )}
          </button>
        </form>
        </div>
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
    <section className="py-16 bg-white border-y border-gray-100">
      <div className="max-w-5xl mx-auto px-6">
        <h3 className="text-center text-gray-400 text-sm font-bold uppercase tracking-[0.2em] mb-10">{section.title || "Why Shop With Us"}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {badges.map((b: any, i: number) => (
            <div key={i} className="bg-gray-50/50 rounded-2xl p-6 text-center hover:-translate-y-1 transition-transform duration-300 border border-gray-100/50">
              <div className="text-3xl mb-3">{b.icon}</div>
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
    <section className="py-20 bg-gradient-to-r from-[var(--brand-primary,#4f46e5)] to-purple-600 text-white">
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
            className="inline-block bg-white text-[color:var(--brand-primary,#4f46e5)] font-bold px-10 py-4 rounded-full text-lg hover:bg-gray-100 transition-all transform hover:scale-105 shadow-2xl"
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
        <div className="w-full max-w-4xl mx-auto mb-6 aspect-video bg-black rounded-3xl overflow-hidden shadow-2xl relative">
          <Image src={images[active]} alt="Gallery Image" fill className="object-cover" sizes="100vw" />
        </div>
        {images.length > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4">
            {images.map((_: string, i: number) => (
              <button key={i} onClick={() => setActive(i)}
                className={`w-2.5 h-2.5 rounded-full transition-colors ${i === active ? 'bg-[var(--brand-primary,#4f46e5)]' : 'bg-gray-300'}`}
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
                <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-[color:var(--brand-primary,#4f46e5)] font-bold">{t.name?.[0] || '?'}</div>
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

function ProductInfoSection({ section }: SectionProps) {
  const points = section.items || [];
  if (points.length === 0) return null;
  return (
    <section className="py-16 md:py-24 bg-white relative">
      <div className="max-w-4xl mx-auto px-6">
        {section.title && <h2 className="text-3xl md:text-4xl font-extrabold text-center text-gray-900 mb-12">{section.title}</h2>}
        <div className="bg-gray-50/50 rounded-3xl p-8 md:p-12 border border-gray-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
          <ul className="space-y-6">
            {points.map((point: any, i: number) => (
              <li key={i} className="flex items-start gap-4">
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-[var(--brand-primary,#4f46e5)]/10 flex items-center justify-center text-[var(--brand-primary,#4f46e5)] mt-1">
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
                </div>
                <div>
                  {point.title && <h4 className="text-xl font-bold text-gray-900 mb-2">{point.title}</h4>}
                  {point.text && <p className="text-gray-600 leading-relaxed font-medium">{point.text}</p>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function ReviewSliderSection({ section }: SectionProps) {
  const items = section.items || [];
  if (items.length === 0) return null;
  return (
    <section className="py-16 md:py-24 bg-gray-50 overflow-hidden">
      <div className="max-w-6xl mx-auto px-6">
        {section.title && <h2 className="text-3xl md:text-4xl font-extrabold text-center text-gray-900 mb-12">{section.title}</h2>}
        
        {/* Horizontal Scrollable Container */}
        <div className="flex overflow-x-auto gap-6 pb-8 snap-x snap-mandatory scrollbar-hide" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
          {items.map((review: any, i: number) => (
            <div key={i} className="snap-center shrink-0 w-[85vw] md:w-[400px] bg-white rounded-3xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-gray-100 flex flex-col">
              {review.image && (
                <div className="relative w-full aspect-[4/3] bg-gray-100 border-b border-gray-100">
                  <Image src={review.image} alt="Review screenshot" fill className="object-cover" sizes="(max-width: 768px) 85vw, 400px" />
                </div>
              )}
              <div className="p-6 md:p-8 flex-1 flex flex-col">
                {review.title && <h4 className="text-lg font-bold text-gray-900 mb-3">{review.title}</h4>}
                {review.text && <p className="text-gray-600 text-sm leading-relaxed mb-4 flex-1">{review.text}</p>}
                {review.rating && (
                  <div className="flex text-amber-500 text-lg">
                    {'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}
                  </div>
                )}
              </div>
            </div>
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
      quantity: products?.length === 1 ? 1 : 0,
      price: parseFloat(String(firstVariant?.price || p.salePrice || p.basePrice || p.price || 0)),
      maxStock: firstVariant?.stock ?? p.stock ?? 999,
    };
  });

  const renderSection = (section: any, i: number) => {
    const sectionProps = { section, index: i, products };
    switch (section.type) {
      case "hero": return <HeroSection key={i} {...sectionProps} />;
      case "features": return <FeaturesSection key={i} {...sectionProps} />;
      case "product-info": return <ProductInfoSection key={i} {...sectionProps} />;
      case "featured-grid": return <DynamicProductSection key={i} {...sectionProps} />;
      case "checkout-form": return <CheckoutFormSection key={i} {...sectionProps} />;
      case "trust-badges": return <TrustBadgesSection key={i} {...sectionProps} />;
      case "cta-footer": return <CTASection key={i} {...sectionProps} />;
      case "image-gallery": return <ImageGallerySection key={i} {...sectionProps} />;
      case "video-embed": return <VideoEmbedSection key={i} {...sectionProps} />;
      case "testimonials": return <TestimonialsSection key={i} {...sectionProps} />;
      case "review-slider": return <ReviewSliderSection key={i} {...sectionProps} />;
      case "faq": return <FAQSection key={i} {...sectionProps} />;
      default: return null;
    }
  };

  return (
    <LandingOrderProvider initialItems={initialItems}>
      <div className="min-h-screen font-sans antialiased pb-24 md:pb-0"
        style={primaryColor ? { '--brand-primary': primaryColor } as React.CSSProperties : undefined}>
        
        {sections.map(renderSection)}

        {/* Mobile Sticky Order Button */}
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
          <p className="text-lg font-bold text-[color:var(--brand-primary,#4f46e5)]">৳{total.toLocaleString()}</p>
        </div>
        <a
          href="#checkout"
          className="bg-[var(--brand-primary,#4f46e5)] text-white font-bold px-6 py-2.5 rounded-lg text-sm hover:brightness-90 transition-colors"
        >
          Order Now
        </a>
      </div>
    </div>
  );
}
