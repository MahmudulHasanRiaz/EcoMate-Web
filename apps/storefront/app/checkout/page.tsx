"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ShieldCheck, ChevronRight, X, Minus, Plus, Package2, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useCart } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { createOrder } from '@/lib/api/orders';
import { saveCheckoutLead } from '@/lib/api/checkout-leads';
import { normalizePhone } from '@/lib/phone-utils';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { trackEvent } from '@/lib/tracking';
import { getPixelIds } from '@/components/TrackingScripts';

function simpleFingerprint(phone: string, items: any[]) {
  const itemStr = items.map(i => `${i.id}:${i.quantity}`).sort().join(',');
  return `${phone}:${itemStr}`.replace(/\s/g, '');
}

function CheckoutItemRow({ item, removeFromCart, updateQuantity }: any) {
  return (
    <div className="flex gap-4">
      <div className="w-[60px] h-[60px] md:w-[80px] md:h-[80px] border border-gray-100 rounded-lg flex-shrink-0 flex items-center justify-center p-1.5 bg-[#fcfcfc]">
        <img src={item.image || undefined} alt={item.name} className="w-full h-full object-contain" />
      </div>
      <div className="flex-1">
        <div className="flex justify-between items-start mb-2 pr-1">
          <h3 className="text-[13px] md:text-[14px] font-bold text-gray-800 leading-snug max-w-[240px]">{item.name}</h3>
          <button onClick={() => removeFromCart(item.id)} className="text-red-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-full">
            <X size={18} />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center h-8 md:h-9 border border-gray-200 rounded-md bg-[#f8f9fa] overflow-hidden">
            <button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="w-8 h-full flex items-center justify-center text-gray-500 hover:bg-gray-100"><Minus size={14} /></button>
            <span className="w-10 h-full flex items-center justify-center border-x border-gray-200 bg-white text-[13px] font-black text-gray-800">{item.quantity}</span>
            <button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="w-8 h-full flex items-center justify-center text-brand-blue hover:bg-gray-100"><Plus size={14} /></button>
          </div>
          <div className="font-black text-[15px] text-gray-800">
            ৳{(item.price * item.quantity).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  const { items, cartTotal, clearCart, updateQuantity, removeFromCart } = useCart();
  const { user } = useAuth();
  const router = useRouter();

  const readStorage = (key: string, fallback: string) => {
    if (typeof window === 'undefined') return fallback;
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  };

  const [district, setDistrict] = useState(() => readStorage('checkout_district', ''));
  const [thana, setThana] = useState(() => readStorage('checkout_thana', ''));
  const [isCouponExpanded, setIsCouponExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [guestName, setGuestName] = useState(() => readStorage('checkout_guestName', ''));
  const [guestPhone, setGuestPhone] = useState(() => readStorage('checkout_guestPhone', ''));
  const [paymentMethod, setPaymentMethod] = useState(() => readStorage('checkout_paymentMethod', 'cod'));
  const leadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasSubmitted = useRef(false);

  const validPhone = !user ? normalizePhone(guestPhone) : true
  const showPhoneError = !user && guestPhone.length > 0 && !validPhone
  const canSubmit = items.length > 0 && !submitting && (user || (guestName.length > 0 && (!guestPhone || validPhone)))

  useEffect(() => { localStorage.setItem('checkout_guestName', guestName) }, [guestName]);
  useEffect(() => { localStorage.setItem('checkout_guestPhone', guestPhone) }, [guestPhone]);
  useEffect(() => { localStorage.setItem('checkout_district', district) }, [district]);
  useEffect(() => { localStorage.setItem('checkout_thana', thana) }, [thana]);
  useEffect(() => { localStorage.setItem('checkout_paymentMethod', paymentMethod) }, [paymentMethod]);

  useEffect(() => {
    window.scrollTo(0, 0);
    const ids = getPixelIds();
    if (ids.metaId || ids.tiktokCode) {
      const value = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
      trackEvent('InitiateCheckout', { value, currency: 'BDT', content_ids: items.map(i => i.id), num_items: items.reduce((s, i) => s + i.quantity, 0) });
    }
  }, []);

  const getLeadData = useCallback(() => {
    const rawPhone = guestPhone || user?.phone || '';
    const phone = normalizePhone(rawPhone);
    const name = guestName || user?.name || '';
    if (!phone || !name || wasSubmitted.current) return null;
    return {
      phone, name,
      address: { district, thana },
      items: items.map(i => ({
        id: i.id, name: i.name, price: i.price, quantity: i.quantity,
        image: i.image, isCombo: i.isCombo, comboId: i.comboId,
      })),
      paymentMethod,
      fingerprint: simpleFingerprint(phone, items),
    };
  }, [guestPhone, guestName, items, district, thana, paymentMethod, user]);

  const captureLead = useCallback(() => {
    const data = getLeadData();
    if (data) saveCheckoutLead(data);
  }, [getLeadData]);

  const scheduleLeadCapture = useCallback(() => {
    if (leadTimer.current) clearTimeout(leadTimer.current);
    leadTimer.current = setTimeout(captureLead, 2000);
  }, [captureLead]);

  useEffect(() => {
    const beaconUrl = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api'}/checkout-leads`;
    const sendLead = () => {
      const data = getLeadData();
      if (data) navigator.sendBeacon(beaconUrl, new Blob([JSON.stringify(data)], { type: 'application/json' }));
    };
    window.addEventListener('beforeunload', sendLead);
    return () => {
      window.removeEventListener('beforeunload', sendLead);
      if (leadTimer.current) clearTimeout(leadTimer.current);
      sendLead();
    };
  }, [getLeadData]);

  const handlePlaceOrder = async () => {
    if (items.length === 0 || submitting) return;
    if (!user) {
      if (!guestName) { toast.error('Please enter your name.'); return }
      if (!guestPhone) { toast.error('Please enter your phone number.'); return }
      if (!normalizePhone(guestPhone)) {
        toast.error('Please enter a valid Bangladeshi phone number (e.g. 01XXXXXXXXX or +8801XXXXXXXXX).')
        return
      }
    }
    setSubmitting(true);

    try {
      const orderItems = items.map((item) => {
        if (item.isCombo) {
          return {
            comboId: item.comboId,
            quantity: item.quantity,
            price: item.price,
          };
        }
        return {
          productId: item.id,
          quantity: item.quantity,
          price: item.price,
        };
      });

      wasSubmitted.current = true;

      const order = await createOrder({
        customerId: user?.id,
        items: orderItems as any,
        shippingCharge: 0,
        shippingAddress: {
          district,
          thana,
        },
        guestName: user ? undefined : guestName,
        guestPhone: user ? undefined : (normalizePhone(guestPhone) || undefined),
        paymentMethod: user ? (paymentMethod === 'cod' ? 'cod' : paymentMethod) : paymentMethod,
      });

      trackEvent('Purchase', { value: cartTotal, currency: 'BDT', content_ids: items.map(i => i.id), num_items: items.reduce((s, i) => s + i.quantity, 0) });

      clearCart();
      try { ['checkout_guestName','checkout_guestPhone','checkout_district','checkout_thana','checkout_paymentMethod'].forEach(k => localStorage.removeItem(k)) } catch {}
      router.push(`/checkout/thank-you?orderId=${order.id}`);
    } catch (err: any) {
      const message = err?.response?.data?.message || 'Failed to place order. Please try again.';
      toast.error(message);
      if (message.includes('no longer exist')) {
        clearCart();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="bg-[#f2f4f8] min-h-screen pb-20 md:pb-12 font-sans">
      <div className="bg-white md:bg-[#f8f9fa] border-b border-gray-100 py-6 md:py-10">
        <div className="max-w-screen-xl mx-auto px-4 text-center">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">Checkout</h1>
          <nav className="flex items-center justify-center gap-2 text-[11px] md:text-[13px] text-gray-400 font-medium">
            <button onClick={() => router.push('/')} className="hover:text-brand-blue">Home</button>
            <ChevronRight size={14} />
            <span className="text-gray-600">Checkout</span>
          </nav>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 md:py-8">
        {!user && (
          <div className="bg-white rounded-lg border border-gray-100 p-3 md:p-4 mb-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-[14px] md:text-[15px] text-gray-700 font-medium">Have an account? Login for faster checkout</p>
            <div className="flex gap-2 w-full md:w-auto">
              <button onClick={() => router.push('/account?redirect=/checkout')} className="flex-1 md:flex-none border border-gray-200 text-gray-700 px-6 py-2 rounded-[4px] text-[13px] font-bold uppercase transition-colors hover:bg-gray-50">Login</button>
              <button onClick={() => router.push('/account?redirect=/checkout')} className="flex-1 md:flex-none bg-brand-blue text-white px-6 py-2 rounded-[4px] text-[13px] font-bold uppercase transition-colors hover:bg-brand-blue/90">Register</button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 space-y-6">
            <div className="bg-white rounded-lg border border-gray-100 relative shadow-sm overflow-hidden">
              <div className="p-4 md:p-6">
                <div className="flex items-center gap-2 mb-6 border-l-4 border-brand-blue pl-3">
                  <h2 className="text-[16px] md:text-[18px] font-bold text-gray-800">Contact Information</h2>
                </div>
                  {!user && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <input type="text" value={guestName} onChange={e => { setGuestName(e.target.value); scheduleLeadCapture(); }} placeholder="Your Full Name *" className="w-full border border-gray-200 rounded-md px-4 py-3 text-[14px] outline-none focus:border-brand-blue transition-all bg-[#fcfcfc]" />
                      <div className="flex">
                        <div className={`border border-r-0 rounded-l-md px-4 py-3 bg-[#f8f9fa] text-gray-600 font-bold text-[14px] transition-colors ${showPhoneError ? 'border-red-400' : 'border-gray-200'}`}>+880</div>
                        <input type="tel" value={guestPhone} onChange={e => { setGuestPhone(e.target.value); scheduleLeadCapture(); }} placeholder="1X XXXX XXXX"
                          className={`w-full rounded-r-md px-4 py-3 text-[14px] outline-none transition-all bg-[#fcfcfc] ${showPhoneError ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-brand-blue'}`} />
                      </div>
                      {showPhoneError && <p className="text-red-500 text-[12px] mt-1.5">Please enter a valid Bangladeshi phone number</p>}
                    </div>
                  )}
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-100 relative shadow-sm overflow-hidden">
              <div className="p-4 md:p-6">
                <div className="flex items-center gap-2 mb-6 border-l-4 border-brand-blue pl-3">
                  <h2 className="text-[16px] md:text-[18px] font-bold text-gray-800">Order review</h2>
                </div>
                <div className="space-y-6">
                  {items.length === 0 ? (
                    <p className="text-gray-500 text-sm py-4">Your cart is empty.</p>
                  ) : (
                    items.map(item => (
                      <div key={item.id} className="border border-gray-100 rounded-xl p-4 transition-colors hover:bg-[#fcfcfc]">
                        {item.isCombo ? (
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 bg-brand-blue/5 px-2 py-1 rounded">
                                <span className="text-[14px] font-bold text-gray-800">{item.name}</span>
                              </div>
                              <button onClick={() => removeFromCart(item.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded-full transition-colors"><X size={18} /></button>
                            </div>
                            {item.comboItems && (
                              <div className="space-y-3">
                                {item.comboItems.map((sub: any, idx: number) => (
                                  <div key={idx} className="flex items-center justify-between text-[13px] pl-4">
                                    <div className="flex items-center gap-3">
                                      <span className="text-gray-600 font-medium">{sub.productName} <span className="text-gray-400 ml-1">&times; {sub.quantity}</span></span>
                                    </div>
                                    {idx === 0 && <span className="text-[#2ecc71] font-bold">Included</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center justify-between pt-3 border-t border-gray-50">
                              <span className="text-[12px] text-gray-400 font-bold uppercase">Combo Total</span>
                              <span className="text-[15px] font-black text-brand-blue">৳{item.price.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
                            </div>
                          </div>
                        ) : (
                          <CheckoutItemRow item={item} removeFromCart={removeFromCart} updateQuantity={updateQuantity} />
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-100 relative shadow-sm overflow-hidden">
              <div className="p-4 md:p-6">
                <div className="flex items-center gap-2 mb-6 border-l-4 border-brand-blue pl-3">
                  <h2 className="text-[16px] md:text-[18px] font-bold text-gray-800">Shipping Address</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {user && (
                    <>
                      <input type="text" placeholder="Your Full Name *" className="w-full border border-gray-200 rounded-md px-4 py-3 text-[14px] outline-none focus:border-brand-blue transition-all bg-[#fcfcfc]" />
                      <div className="flex">
                        <div className="border border-gray-200 border-r-0 rounded-l-md px-4 py-3 bg-[#f8f9fa] text-gray-600 font-bold text-[14px]">+880</div>
                        <input type="tel" placeholder="01X XXXXXXXX" className="w-full border border-gray-200 rounded-r-md px-4 py-3 text-[14px] outline-none focus:border-brand-blue transition-all bg-[#fcfcfc]" />
                      </div>
                    </>
                  )}
                  <div className="relative">
                    <select value={district} onChange={(e) => { setDistrict(e.target.value); scheduleLeadCapture(); }}
                      className="w-full border border-gray-200 rounded-md px-4 py-3 text-[14px] outline-none focus:border-brand-blue appearance-none bg-[#fcfcfc] text-gray-600 font-medium">
                      <option value="" disabled>Select District</option>
                      <option value="dhaka">Dhaka</option>
                    </select>
                    <ChevronDown size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                  <div className="relative">
                    <select value={thana} onChange={(e) => { setThana(e.target.value); scheduleLeadCapture(); }}
                      className="w-full border border-gray-200 rounded-md px-4 py-3 text-[14px] outline-none focus:border-brand-blue appearance-none bg-[#fcfcfc] text-gray-600 font-medium">
                      <option value="" disabled>Select Thana (Optional)</option>
                      <option value="gulshan">Gulshan</option>
                    </select>
                    <ChevronDown size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                  <div className="md:col-span-2">
                    <textarea placeholder="ex: House no. / building / street / area" rows={2}
                      className="w-full border border-gray-200 rounded-md px-4 py-3 text-[14px] outline-none focus:border-brand-blue resize-none bg-[#fcfcfc]" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white rounded-lg border border-gray-100 relative shadow-sm overflow-hidden">
              <div className="p-4 md:p-6">
                <div className="flex items-center gap-2 mb-6 border-l-4 border-brand-blue pl-3">
                  <h2 className="text-[16px] md:text-[18px] font-bold text-gray-800">Payment method</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                  {[
                    { key: 'cod', label: 'Cash On Delivery', icon: <Package2 size={20} className="text-brand-blue" />, bg: 'bg-gray-100' },
                    { key: 'bkash', label: 'bKash', icon: <span className="text-white font-bold text-[10px]">bkash</span>, bg: 'bg-[#e2136e]' },
                    { key: 'nagad', label: 'Nagad', icon: <span className="text-white font-bold text-[10px]">NAGAD</span>, bg: 'bg-[#f5821f]' },
                    { key: 'rocket', label: 'Rocket', icon: <span className="text-white font-bold text-[10px]">Rocket</span>, bg: 'bg-[#981ceb]' },
                  ].map(pm => (
                    <div key={pm.key} onClick={() => { setPaymentMethod(pm.key); scheduleLeadCapture(); }}
                      className={`rounded-lg p-3 flex items-center justify-between cursor-pointer transition-all ${paymentMethod === pm.key ? 'border-2 border-brand-blue bg-brand-blue/5' : 'border border-gray-100 bg-[#fcfcfc] hover:border-brand-blue'}`}>
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 ${pm.bg} rounded-md flex items-center justify-center`}>{pm.icon}</div>
                        <span className="text-[13px] text-gray-800 font-bold">{pm.label}</span>
                      </div>
                      {paymentMethod === pm.key && (
                        <div className="w-5 h-5 rounded-full bg-brand-blue flex items-center justify-center"><ShieldCheck size={14} className="text-white" /></div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden divide-y divide-gray-50">
              <button onClick={() => setIsCouponExpanded(!isCouponExpanded)}
                className="w-full p-4 md:p-6 flex justify-between items-center cursor-pointer group text-left outline-none">
                <span className="text-[14px] md:text-[15px] font-bold text-gray-700 group-hover:text-brand-blue transition-colors">Have any coupon or gift voucher?</span>
                <motion.div animate={{ rotate: isCouponExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                  <ChevronDown size={20} className="text-brand-blue" />
                </motion.div>
              </button>
              <AnimatePresence>
                {isCouponExpanded && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3 }} className="overflow-hidden bg-[#fcfcfc]">
                    <div className="p-4 md:p-6 pt-0 md:pt-0">
                      <div className="flex gap-2">
                        <input type="text" placeholder="Enter Coupon" className="flex-1 border border-gray-200 rounded-md px-4 py-2 text-[14px] outline-none focus:border-brand-blue bg-white" />
                        <button className="bg-brand-blue text-white px-4 py-2 rounded-md text-[13px] font-bold uppercase transition-colors hover:bg-brand-blue/90">Apply</button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="p-4 md:p-6 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[14px] text-gray-500 font-medium">Sub total</span>
                  <span className="text-[14px] text-gray-800 font-black">{cartTotal.toLocaleString('en-US', {minimumFractionDigits: 2})} BDT</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[14px] text-gray-500 font-medium">Delivery cost</span>
                  <span className="text-[14px] text-gray-800 font-black">0 BDT</span>
                </div>
                <div className="flex justify-between items-center pt-4 mt-4 border-t-2 border-dashed border-gray-100">
                  <span className="text-[16px] font-black text-gray-900">Total</span>
                  <span className="text-[16px] font-black text-gray-900">৳{cartTotal.toLocaleString('en-US', {minimumFractionDigits: 2})} BDT</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-4 md:p-6">
                <div className="flex items-center gap-2 mb-4 border-l-4 border-brand-blue pl-3">
                  <h2 className="text-[15px] font-bold text-gray-800">Special notes <span className="font-normal text-[12px] text-gray-400 ml-1">(Optional)</span></h2>
                </div>
                <textarea className="w-full border border-gray-100 rounded-lg px-4 py-3 text-[14px] outline-none focus:border-brand-blue resize-none h-24 bg-[#fcfcfc]" maxLength={90} />
                <div className="text-[11px] text-gray-400 mt-1 text-right">0 / 90 characters</div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="flex items-start gap-3 px-2">
                <div className="w-5 h-5 rounded-full bg-brand-blue flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                  <ShieldCheck size={12} className="text-white" />
                </div>
                <p className="text-[12px] md:text-[13px] text-gray-500 leading-relaxed">
                  I have read and agree to the <span className="text-brand-blue font-bold cursor-pointer hover:underline">Terms and Conditions</span>, <span className="text-brand-blue font-bold cursor-pointer hover:underline">Privacy Policy</span> & <span className="text-brand-blue font-bold cursor-pointer hover:underline">Refund and Return Policy</span>.
                </p>
              </div>
              <button onClick={handlePlaceOrder} disabled={!canSubmit}
                className={`w-full text-white font-black h-14 rounded-lg text-[16px] uppercase tracking-widest shadow-lg transition-all active:scale-[0.98] ${canSubmit ? 'bg-brand-blue hover:bg-brand-blue/90 shadow-brand-blue/20' : 'bg-gray-400 cursor-not-allowed'}`}>
                {submitting ? 'PLACING ORDER...' : 'PLACE ORDER'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
