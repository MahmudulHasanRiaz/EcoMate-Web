"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ShieldCheck, ChevronRight, X, Minus, Plus, Package2, Loader2, CreditCard, Banknote, ArrowLeft, ExternalLink, CheckCircle, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useCart, getItemKey, VariantAttribute } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { useStorefrontConfig } from '@/context/StorefrontConfigContext';
import { createOrder } from '@/lib/api/orders';
import { getDistricts, getThanas, getGateways } from '@/lib/api/delivery-areas';
import { saveCheckoutLead } from '@/lib/api/checkout-leads';
import { submitPayment } from '@/lib/api/payments';
import { normalizePhone } from '@/lib/phone-utils';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { trackEvent } from '@/lib/tracking';

function simpleFingerprint(phone: string, items: any[]) {
  const itemStr = items.map(i => `${i.id}:${i.quantity}`).sort().join(',');
  return `${phone}:${itemStr}`.replace(/\s/g, '');
}

function formatAttributes(attrs: VariantAttribute[] | undefined, fallback?: string): string | null {
  if (attrs && attrs.length > 0) {
    return attrs.map((a) => `${a.name}: ${a.value}`).join(', ');
  }
  if (fallback && fallback.trim()) return fallback;
  return null;
}

function CheckoutItemRow({ item, removeFromCart, updateQuantity, currencySymbol }: any) {
  const s = currencySymbol || '৳';
  const key = getItemKey(item);
  return (
    <div className="flex gap-4">
      <div className="w-[60px] h-[60px] md:w-[80px] md:h-[80px] border border-gray-100 rounded-lg flex-shrink-0 flex items-center justify-center p-1.5 bg-[#fcfcfc]">
        <img src={item.image || '/placeholder.svg'} alt={item.name} className="w-full h-full object-contain"
          onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/placeholder.svg'; }} />
      </div>
      <div className="flex-1">
        <div className="flex justify-between items-start mb-2 pr-1">
          <div className="min-w-0">
            <h3 className="text-[13px] md:text-[14px] font-bold text-gray-800 leading-snug break-words">
              {item.name}
            </h3>
            {(() => {
              const attrText = formatAttributes(item.variantAttributes, item.variantLabel);
              if (attrText) {
                return (
                  <span className="block text-[11px] text-gray-500 font-normal mt-0.5">
                    {attrText}
                  </span>
                );
              }
              if (item.variantId) {
                return (
                  <span className="block text-[11px] text-gray-400 font-normal mt-0.5">Variant selected</span>
                );
              }
              return null;
            })()}
          </div>
          <button onClick={() => removeFromCart(key)} className="text-red-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-full">
            <X size={18} />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center h-8 md:h-9 border border-gray-200 rounded-md bg-[#f8f9fa] overflow-hidden">
            <button onClick={() => updateQuantity(key, item.quantity - 1)} className="w-8 h-full flex items-center justify-center text-gray-500 hover:bg-gray-100"><Minus size={14} /></button>
            <span className="w-10 h-full flex items-center justify-center border-x border-gray-200 bg-white text-[13px] font-black text-gray-800">{item.quantity}</span>
            <button onClick={() => updateQuantity(key, item.quantity + 1)} className="w-8 h-full flex items-center justify-center text-brand-blue hover:bg-gray-100"><Plus size={14} /></button>
          </div>
          <div className="font-black text-[15px] text-gray-800">
            {s}{(item.price * item.quantity).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
          </div>
        </div>
      </div>
    </div>
  );
}

function PaymentPopup({ orderId, total, guestPhone, guestName, viewToken, onClose, onSuccess }: {
  orderId: string;
  total: number;
  guestPhone?: string;
  guestName?: string;
  viewToken?: string;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [gateways, setGateways] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedGw, setSelectedGw] = useState<any | null>(null);
  const [senderPhone, setSenderPhone] = useState(guestPhone || '');
  const [trxId, setTrxId] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const router = useRouter();

  useEffect(() => {
    getGateways().then(list => {
      setGateways(list.filter(g => g.enabled && g.code !== 'cash'));
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSelectGateway = (gw: any) => {
    if (gw.code === 'bkash_pgw') {
      initiateBkashPgw();
    } else {
      setSelectedGw(gw);
    }
  };

  const initiateBkashPgw = async () => {
    try {
      const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
      const res = await fetch(`${api}/payments/bkash/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: total,
          orderId,
          invoiceNo: `INV-${orderId.slice(0, 8)}`,
        }),
      });
      const data = await res.json();
      if (data.redirectURL) {
        onSuccess?.();
        window.location.href = data.redirectURL;
      } else if (data.bkashURL) {
        onSuccess?.();
        window.location.href = data.bkashURL;
      } else {
        toast.error('Payment initiation failed. Order saved as pending.');
        onClose();
      }
    } catch {
      toast.error('Payment gateway error. Order saved as pending.');
      onClose();
    }
  };

  const handleSubmitPayment = async () => {
    if (!trxId.trim()) {
      toast.error('Please enter your transaction ID (TrxID).');
      return;
    }
    setSubmittingPayment(true);
    try {
      await submitPayment(orderId, {
        gatewayCode: selectedGw.code,
        amount: total,
        transactionId: trxId.trim(),
        notes: senderPhone ? `Sent from: ${senderPhone}` : undefined,
      });
      onSuccess?.();
      setSubmitted(true);
      toast.success('Payment info submitted! Awaiting verification.');
    } catch {
      toast.error('Failed to submit payment. Please try again.');
    } finally {
      setSubmittingPayment(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl p-8 max-w-sm w-full text-center" onClick={e => e.stopPropagation()}>
          <Loader2 className="animate-spin mx-auto mb-4 text-brand-blue" size={32} />
          <p className="text-gray-500">Loading payment options...</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden p-8 text-center" onClick={e => e.stopPropagation()}>
          <CheckCircle size={48} className="mx-auto mb-4 text-green-500" />
          <h3 className="text-lg font-bold text-gray-800 mb-2">Payment Submitted!</h3>
          <p className="text-sm text-gray-500 mb-6">Your payment info has been received. We will verify it shortly.</p>
          <button onClick={() => router.push(`/checkout/thank-you?orderId=${orderId}&t=${viewToken || ''}&pending=true`)}
            className="w-full bg-brand-blue text-white font-bold py-3 rounded-lg hover:bg-brand-blue/90 transition-colors">
            View Order Status
          </button>
        </div>
      </div>
    );
  }

  if (selectedGw) {
    const gwName = selectedGw.name || selectedGw.code;
    const gwIcon = gwName.slice(0, 2).toUpperCase();
    const modeLabel = selectedGw.mode === 'agent' ? 'Agent' : selectedGw.mode === 'merchant' ? 'Merchant' : 'Personal';
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
        <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedGw(null)} className="text-gray-400 hover:text-gray-600 p-1">
                <ArrowLeft size={20} />
              </button>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold bg-gray-500 text-white">
                  {gwIcon}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-800">{gwName}</h3>
                  <p className="text-xs text-gray-400">{modeLabel} Account</p>
                </div>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-5">
            <div className="bg-blue-50 rounded-xl p-4 space-y-2">
              <p className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <ExternalLink size={16} className="text-brand-blue" />
                Send Money to This Number
              </p>
              <p className="text-2xl font-black text-center text-brand-blue tracking-wide">
                {selectedGw.phoneNumber || 'Not set'}
              </p>
              <p className="text-xs text-gray-500 text-center">
                Amount: <span className="font-bold text-gray-800">BDT {total.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
              </p>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Your Phone Number (Sent From)</label>
                <input type="tel" value={senderPhone} onChange={e => setSenderPhone(e.target.value)}
                  placeholder="01XXXXXXXXX"
                  className="w-full border border-gray-200 rounded-lg px-4 py-3 text-[14px] outline-none focus:border-brand-blue bg-[#fcfcfc]" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Transaction ID (TrxID)</label>
                <input type="text" value={trxId} onChange={e => setTrxId(e.target.value)}
                  placeholder="e.g. TrxID8A7B3C"
                  className="w-full border border-gray-200 rounded-lg px-4 py-3 text-[14px] outline-none focus:border-brand-blue bg-[#fcfcfc]" />
              </div>
            </div>

            <button onClick={handleSubmitPayment} disabled={submittingPayment}
              className={`w-full text-white font-bold py-3.5 rounded-lg text-[15px] transition-all active:scale-[0.98] ${submittingPayment ? 'bg-gray-400 cursor-not-allowed' : 'bg-brand-blue hover:bg-brand-blue/90 shadow-lg shadow-brand-blue/20'}`}>
              {submittingPayment ? <Loader2 className="animate-spin mx-auto" size={20} /> : 'I Have Sent the Money'}
            </button>

            <p className="text-[11px] text-gray-400 text-center leading-relaxed">
              After sending the money, enter your TrxID above and click submit. Our team will verify your payment within 24 hours.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-800">Complete Payment</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
              <X size={20} />
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-1">Pay {(total).toLocaleString('en-US', {minimumFractionDigits: 2})} BDT</p>
        </div>
        <div className="p-6 space-y-3">
          {gateways.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">No online payment gateways available. Your order has been saved as pending.</p>
          )}
          {gateways.map(gw => {
            const gwName = gw.name || gw.code;
            const gwIcon = gwName.slice(0, 2).toUpperCase();
            return (
              <button
                key={gw.id}
                onClick={() => handleSelectGateway(gw)}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-gray-200 hover:border-brand-blue hover:bg-brand-blue/5 transition-all"
              >
                <div className="w-12 h-12 rounded-lg flex items-center justify-center text-sm font-bold bg-gray-500 text-white">
                  {gwIcon}
                </div>
                <div className="flex-1 text-left">
                  <p className="font-bold text-gray-800">{gwName}</p>
                  {gw.phoneNumber && <p className="text-xs text-gray-400">{gw.phoneNumber}</p>}
                </div>
                <ChevronRight size={20} className="text-gray-300" />
              </button>
            );
          })}
        </div>
        <div className="px-6 pb-6">
          <button onClick={onClose} className="w-full py-2.5 text-sm text-gray-500 hover:text-gray-700 font-medium">
            Pay Later — Order Saved
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  const { items, cartTotal, clearCart, updateQuantity, removeFromCart } = useCart();
  const { user } = useAuth();
  const { config } = useStorefrontConfig();
  const router = useRouter();

  const readStorage = (key: string, fallback: string) => {
    if (typeof window === 'undefined') return fallback;
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  };

  const [districts, setDistricts] = useState<any[]>([]);
  const [thanas, setThanas] = useState<any[]>([]);
  const [district, setDistrict] = useState('');
  const [thana, setThana] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [isCouponExpanded, setIsCouponExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [paymentOptionType, setPaymentOptionType] = useState<'FULL_PAYMENT' | 'PARTIAL_PAYMENT' | 'CASH_ON_DELIVERY'>('CASH_ON_DELIVERY');
  const [partialAmount, setPartialAmount] = useState('');
  const [paymentPopup, setPaymentPopup] = useState<{ orderId: string; total: number; viewToken?: string } | null>(null);
  const paymentSuccessCallback = useRef<(() => void) | null>(null);
  const [selectedShippingOptionId, setSelectedShippingOptionId] = useState('')
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);
  const [couponError, setCouponError] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const leadTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const wasSubmitted = useRef(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const clearFieldError = useCallback((field: string) => {
    setFieldErrors(prev => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }, []);

  useEffect(() => {
    setDistrict(readStorage('checkout_district', ''));
    setThana(readStorage('checkout_thana', ''));
    setAddressLine(readStorage('checkout_address', ''));
    setCustomerNotes(readStorage('checkout_notes', ''));
    setGuestName(readStorage('checkout_guestName', ''));
    setGuestPhone(readStorage('checkout_guestPhone', ''));
    setPaymentOptionType((readStorage('checkout_paymentOptionType', 'CASH_ON_DELIVERY') as 'FULL_PAYMENT' | 'PARTIAL_PAYMENT' | 'CASH_ON_DELIVERY'));
  }, []);

  const checkoutCfg = config.checkout;

  const [gateways, setGateways] = useState<any[]>([]);
  useEffect(() => {
    getGateways().then(list => setGateways(list)).catch(() => {});
  }, []);
  const hasCodGateway = gateways.some(g => g.code === 'cash' && g.enabled);
  const hasFullPayment = gateways.some(g => g.paymentOptionType === 'FULL_PAYMENT' && g.enabled);
  const hasPartialPayment = gateways.some(g => g.paymentOptionType === 'PARTIAL_PAYMENT' && g.enabled);

  let deliveryCharge = 0;
  let noDeliveryError = '';

  if (config.shippingMode === 'options') {
    if (selectedShippingOptionId) {
      const opt = config.shippingOptions?.find(o => o.id === selectedShippingOptionId);
      deliveryCharge = opt?.amount ?? 0;
    }
  } else {
    if (district) {
      const zoneGroup = config.shippingZones?.find(z => z.districts.includes(district));
      if (zoneGroup?.type === 'no_delivery') {
        noDeliveryError = 'এই এলাকায় ডেলিভারি সম্ভব না';
        deliveryCharge = 0;
      } else if (zoneGroup?.type === 'custom_amount') {
        deliveryCharge = zoneGroup.amount ?? config.delivery.charge;
      } else {
        deliveryCharge = config.delivery.charge;
      }
      if (cartTotal >= config.delivery.freeDeliveryMin) {
        deliveryCharge = 0;
      }
    }
  }
  const discountAmount = appliedCoupon?.valid && appliedCoupon.coupon
    ? (appliedCoupon.coupon.type === 'percentage'
      ? (cartTotal * Number(appliedCoupon.coupon.value)) / 100
      : Number(appliedCoupon.coupon.value))
    : 0;
  const totalWithDelivery = cartTotal + deliveryCharge - discountAmount;

  useEffect(() => {
    getDistricts().then(setDistricts).catch(() => {});
  }, []);

  useEffect(() => {
    if (district) {
      getThanas(district).then(setThanas).catch(() => setThanas([]));
    } else {
      setThanas([]);
    }
  }, [district]);

  const validPhone = !user ? normalizePhone(guestPhone) : true;
  const showPhoneError = !user && guestPhone.length > 0 && !validPhone;
  const phoneOk = !user ? (guestPhone.length === 0 || validPhone) : true;
  const canSubmit = items.length > 0 && !submitting && (user || (guestName.length > 0 && phoneOk)) && !noDeliveryError && Object.keys(fieldErrors).length === 0;

  useEffect(() => { localStorage.setItem('checkout_guestName', guestName); }, [guestName]);
  useEffect(() => { localStorage.setItem('checkout_guestPhone', guestPhone); }, [guestPhone]);
  useEffect(() => { localStorage.setItem('checkout_district', district); }, [district]);
  useEffect(() => { localStorage.setItem('checkout_thana', thana); }, [thana]);
  useEffect(() => { localStorage.setItem('checkout_address', addressLine); }, [addressLine]);
  useEffect(() => { localStorage.setItem('checkout_notes', customerNotes); }, [customerNotes]);
  useEffect(() => { localStorage.setItem('checkout_paymentOptionType', paymentOptionType); }, [paymentOptionType]);

  useEffect(() => {
    if (paymentOptionType === 'CASH_ON_DELIVERY' && !hasCodGateway) {
      if (hasFullPayment) {
        setPaymentOptionType('FULL_PAYMENT');
      } else if (hasPartialPayment) {
        setPaymentOptionType('PARTIAL_PAYMENT');
      } else {
        setPaymentOptionType('CASH_ON_DELIVERY');
      }
    }
  }, [hasCodGateway, hasFullPayment, hasPartialPayment, paymentOptionType]);

  const initiatedRef = useRef(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (items.length > 0 && !initiatedRef.current) {
      const value = items.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
      trackEvent('InitiateCheckout', {
        value,
        currency: config.currency.code,
        content_ids: items.map(i => i.id),
        num_items: items.reduce((s, i) => s + i.quantity, 0),
        contents: items.map(i => ({ id: i.id, quantity: i.quantity, item_price: i.price })),
      }, {
        phone: user?.phone || '',
        name: user?.name || '',
      });
      initiatedRef.current = true;
    }
  }, [items, config.currency.code, user]);

  const getLeadData = useCallback(() => {
    const rawPhone = guestPhone || user?.phone || '';
    const phone = normalizePhone(rawPhone);
    const name = guestName || user?.name || '';
    if (!phone || !name || wasSubmitted.current) return null;
    return {
      phone, name,
      address: { district, thana, addressLine },
      items: items.map(i => ({
        id: i.id, name: i.name, price: i.price, quantity: i.quantity,
        image: i.image, isCombo: i.isCombo, comboId: i.comboId,
      })),
      paymentMethod: paymentOptionType,
      fingerprint: simpleFingerprint(phone, items),
    };
  }, [guestPhone, guestName, items, district, thana, addressLine, paymentOptionType, user]);

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

  const buildOrderPayload = () => {
    const orderItems = items.map((item) => {
      if (item.isCombo) {
        return { comboId: item.comboId, comboSelection: item.comboSelections, quantity: item.quantity, price: item.price };
      }
      return { productId: item.id, variantId: item.variantId, quantity: item.quantity, price: item.price };
    });

    const payload: any = {
      customerId: user?.id,
      items: orderItems,
      shippingCharge: deliveryCharge,
      shippingAddress: { district, thana, addressLine },
      guestName: user ? undefined : guestName,
      guestPhone: user ? undefined : (normalizePhone(guestPhone) || undefined),
      paymentOptionType,
      gatewayCode: paymentOptionType === 'CASH_ON_DELIVERY' ? 'cash' : undefined,
      district: district || undefined,
      thana: thana || undefined,
      selectedShippingOptionId: config.shippingMode === 'options' ? (selectedShippingOptionId || null) : undefined,
    };

    const isOnlinePayment = paymentOptionType === 'FULL_PAYMENT' || paymentOptionType === 'PARTIAL_PAYMENT';
    if (paymentOptionType === 'PARTIAL_PAYMENT' && partialAmount) {
      payload.partialAmount = parseFloat(partialAmount) || 0;
    }

    if (appliedCoupon?.valid) {
      payload.couponCode = appliedCoupon.coupon.code;
    }

    return { orderItems, payload, isOnlinePayment };
  };

  const handleApplyCoupon = async () => {
    const code = couponInput.trim();
    if (!code) return;
    setCouponLoading(true);
    setCouponError('');
    setAppliedCoupon(null);
    try {
      const { validateCoupon } = await import('@/lib/api/orders');
      const result = await validateCoupon(code);
      if (result?.valid) {
        setAppliedCoupon(result);
        toast.success(`Coupon "${code}" applied!`);
      } else {
        setCouponError(result?.message || 'Invalid coupon');
        toast.error(result?.message || 'Invalid coupon');
      }
    } catch {
      setCouponError('Failed to validate coupon');
      toast.error('Failed to validate coupon');
    } finally {
      setCouponLoading(false);
    }
  };

  const handleRemoveCoupon = () => {
    setAppliedCoupon(null);
    setCouponInput('');
    setCouponError('');
  };

  const validateShipping = (): boolean => {
    const errors: Record<string, string> = {};
    const districtReq = checkoutCfg?.districtRequired !== false;
    if (districtReq && !district.trim()) {
      errors.district = 'Please select a district';
    }
    const thanaReq = checkoutCfg?.thanaRequired !== false;
    if (thanaReq && district.trim() && !thana.trim()) {
      errors.thana = 'Please select a thana/upazila';
    }
    if (!addressLine.trim() || addressLine.trim().length < 5) {
      errors.addressLine = 'Address must be at least 5 characters';
    }
    if (config.shippingMode === 'options' && !selectedShippingOptionId) {
      errors.shippingOption = 'Please select a delivery option';
    }
    if (!user) {
      if (!guestName.trim()) {
        errors.guestName = 'Please enter your name';
      }
      if (!guestPhone.trim()) {
        errors.guestPhone = 'Please enter your phone number';
      } else if (!normalizePhone(guestPhone)) {
        errors.guestPhone = 'Please enter a valid Bangladeshi phone number';
      }
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handlePlaceOrder = async () => {
    if (items.length === 0 || submitting) return;
    if (!validateShipping()) {
      toast.error('Please fill in all required fields');
      return;
    }
    if (!user) {
      if (!guestName) { toast.error('Please enter your name.'); return }
      if (!guestPhone) { toast.error('Please enter your phone number.'); return }
      if (!normalizePhone(guestPhone)) {
        toast.error('Please enter a valid Bangladeshi phone number (e.g. 01XXXXXXXXX or +8801XXXXXXXXX).');
        return;
      }
    }
    setSubmitting(true);

    try {
      const { orderItems, payload, isOnlinePayment } = buildOrderPayload();

      wasSubmitted.current = true;

      if (isOnlinePayment && gateways.length > 0) {
        const selectedGw = gateways.find(g =>
          g.paymentOptionType === paymentOptionType && g.enabled
        );
        if (selectedGw) {
          payload.gatewayCode = selectedGw.code;
        }
      }
      const order = await createOrder(payload);

      if (isOnlinePayment) {
        paymentSuccessCallback.current = () => {
          clearCart();
          try {
            ['checkout_guestName','checkout_guestPhone','checkout_district','checkout_thana',
             'checkout_address','checkout_notes','checkout_paymentOptionType'].forEach(k => localStorage.removeItem(k));
          } catch {}
        };
        setPaymentPopup({ orderId: order.id, total: totalWithDelivery, viewToken: order.viewToken });
      } else {
        clearCart();
        try {
          ['checkout_guestName','checkout_guestPhone','checkout_district','checkout_thana',
           'checkout_address','checkout_notes','checkout_paymentOptionType'].forEach(k => localStorage.removeItem(k));
        } catch {}
        router.push(`/checkout/thank-you?orderId=${order.id}&t=${order.viewToken || ''}`);
      }
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

  const handlePayNow = handlePlaceOrder;

  const s = config.currency.symbol || '৳';

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
            {/* Contact Information */}
            <div className="bg-white rounded-lg border border-gray-100 relative shadow-sm overflow-hidden">
              <div className="p-4 md:p-6">
                <div className="flex items-center gap-2 mb-6 border-l-4 border-brand-blue pl-3">
                  <h2 className="text-[16px] md:text-[18px] font-bold text-gray-800">Contact Information</h2>
                </div>
                {!user && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                    <input type="text" value={guestName} onChange={e => { setGuestName(e.target.value); clearFieldError('guestName'); scheduleLeadCapture(); }} placeholder="Your Full Name *" className="w-full border border-gray-200 rounded-md px-4 py-3 text-[14px] outline-none focus:border-brand-blue transition-all bg-[#fcfcfc]" />
                    {fieldErrors.guestName && <p className="text-red-500 text-xs mt-1">{fieldErrors.guestName}</p>}
                    <div className="flex">
                      <div className={`border border-r-0 rounded-l-md px-4 py-3 bg-[#f8f9fa] text-gray-600 font-bold text-[14px] transition-colors ${showPhoneError ? 'border-red-400' : 'border-gray-200'}`}>+880</div>
                      <input type="tel" value={guestPhone} onChange={e => { setGuestPhone(e.target.value); clearFieldError('guestPhone'); scheduleLeadCapture(); }} placeholder="1X XXXX XXXX"
                        className={`w-full rounded-r-md px-4 py-3 text-[14px] outline-none transition-all bg-[#fcfcfc] ${showPhoneError ? 'border-red-400 focus:border-red-500' : 'border-gray-200 focus:border-brand-blue'}`} />
                    </div>
                    {fieldErrors.guestPhone && <p className="text-red-500 text-xs mt-1">{fieldErrors.guestPhone}</p>}
                    {showPhoneError && <p className="text-red-500 text-[12px] mt-1.5">Please enter a valid Bangladeshi phone number</p>}
                  </div>
                )}
              </div>
            </div>

            {/* Order Review */}
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
                      <div key={getItemKey(item)} className="border border-gray-100 rounded-xl p-4 transition-colors hover:bg-[#fcfcfc]">
                        {item.isCombo ? (
                          <div className="space-y-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 bg-brand-blue/5 px-2 py-1 rounded">
                                <span className="text-[14px] font-bold text-gray-800">{item.name}</span>
                              </div>
                              <button onClick={() => removeFromCart(getItemKey(item))} className="text-red-500 hover:bg-red-50 p-1.5 rounded-full transition-colors"><X size={18} /></button>
                            </div>
                            {item.comboItems && (
                              <div className="space-y-2">
                                {item.comboItems.map((sub: any, idx: number) => {
                                  const selAttrs = item.comboSelectionAttributes?.[sub.productId];
                                  const selLabel = item.comboSelectionLabels?.[sub.productId];
                                  const subAttrText = formatAttributes(selAttrs, selLabel);
                                  return (
                                    <div key={idx} className="flex items-baseline text-[13px] pl-4 gap-2">
                                      <span className="text-gray-600 font-medium break-words">{sub.productName}</span>
                                      <span className="text-gray-400 shrink-0">&times;{sub.quantity}</span>
                                      {subAttrText && <span className="text-brand-blue shrink-0">({subAttrText})</span>}
                                      {idx === 0 && <span className="text-[#2ecc71] font-bold shrink-0 ml-auto">Included</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            <div className="flex items-center justify-between pt-3 border-t border-gray-50">
                              <span className="text-[12px] text-gray-400 font-bold uppercase">Combo Total</span>
                              <span className="text-[15px] font-black text-brand-blue">{s}{item.price.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
                            </div>
                          </div>
                        ) : (
                          <CheckoutItemRow item={item} removeFromCart={removeFromCart} updateQuantity={updateQuantity} currencySymbol={s} />
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Shipping Address */}
            <div className="bg-white rounded-lg border border-gray-100 relative shadow-sm overflow-hidden">
              <div className="p-4 md:p-6">
                <div className="flex items-center gap-2 mb-6 border-l-4 border-brand-blue pl-3">
                  <h2 className="text-[16px] md:text-[18px] font-bold text-gray-800">Shipping Address</h2>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {checkoutCfg?.districtEnabled !== false && (
                    <>
                      <div className="relative">
                        <select value={district} onChange={(e) => { setDistrict(e.target.value); setThana(''); clearFieldError('district'); scheduleLeadCapture(); }}
                          className={`w-full border rounded-md px-4 py-3 text-[14px] outline-none appearance-none bg-[#fcfcfc] font-medium transition-all focus:border-brand-blue ${checkoutCfg?.districtRequired ? 'border-gray-200' : 'border-gray-200'}`}>
                          <option value="">{checkoutCfg?.districtRequired ? 'Select District *' : 'Select District (Optional)'}</option>
                          {districts.map(d => (
                            <option key={d.name} value={d.name}>{d.nameBn || d.name}</option>
                          ))}
                        </select>
                        <ChevronDown size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      </div>
                      {fieldErrors.district && <p className="text-red-500 text-xs mt-1">{fieldErrors.district}</p>}
                    </>
                  )}
                  {checkoutCfg?.thanaEnabled !== false && district && (
                    <>
                      <div className="relative">
                        <select value={thana} onChange={(e) => { setThana(e.target.value); clearFieldError('thana'); scheduleLeadCapture(); }}
                          className={`w-full border rounded-md px-4 py-3 text-[14px] outline-none appearance-none bg-[#fcfcfc] font-medium transition-all focus:border-brand-blue ${checkoutCfg?.thanaRequired ? 'border-gray-200' : 'border-gray-200'}`}>
                          <option value="">{checkoutCfg?.thanaRequired ? 'Select Thana/Upazila *' : 'Select Thana/Upazila (Optional)'}</option>
                          {thanas.map(t => (
                            <option key={t.name} value={t.name}>{t.nameBn || t.name}</option>
                          ))}
                        </select>
                        <ChevronDown size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                      </div>
                      {fieldErrors.thana && <p className="text-red-500 text-xs mt-1">{fieldErrors.thana}</p>}
                    </>
                  )}
                  <div className="md:col-span-2">
                    <textarea value={addressLine} onChange={e => { setAddressLine(e.target.value); clearFieldError('addressLine'); }}
                      placeholder="ex: House no. / building / street / area" rows={2}
                      className="w-full border border-gray-200 rounded-md px-4 py-3 text-[14px] outline-none focus:border-brand-blue resize-none bg-[#fcfcfc]" />
                    {fieldErrors.addressLine && <p className="text-red-500 text-xs mt-1">{fieldErrors.addressLine}</p>}
                  </div>
                </div>
                {config.shippingMode === 'options' && config.shippingOptions?.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <label className="text-sm font-bold text-gray-700">Delivery Option</label>
                    {config.shippingOptions.map(opt => (
                      <label key={opt.id} className={`flex items-center justify-between p-3 border rounded-lg cursor-pointer transition-colors ${selectedShippingOptionId === opt.id ? 'border-brand-blue bg-brand-blue/5' : 'border-gray-200 hover:border-gray-300'}`}>
                        <div className="flex items-center gap-3">
                          <input type="radio" name="shippingOption" value={opt.id} checked={selectedShippingOptionId === opt.id} onChange={() => { setSelectedShippingOptionId(opt.id); clearFieldError('shippingOption'); }} className="accent-brand-blue" />
                          <span className="text-sm font-medium text-gray-800">{opt.name}</span>
                        </div>
                        <span className="text-sm font-bold text-gray-800">{s}{opt.amount}</span>
                      </label>
                    ))}
                  </div>
                )}
                {fieldErrors.shippingOption && <p className="text-red-500 text-xs mt-1">{fieldErrors.shippingOption}</p>}
                {config.shippingMode !== 'options' && district && deliveryCharge > 0 && !noDeliveryError && (
                  <div className="mt-3 text-xs text-gray-400">
                    Delivery charge for {district}: <span className="font-bold text-gray-600">{s}{deliveryCharge}</span>
                    {cartTotal >= config.delivery.freeDeliveryMin && <span className="text-green-600 ml-2">(Free delivery on orders over {s}{config.delivery.freeDeliveryMin})</span>}
                  </div>
                )}
                {noDeliveryError && (
                  <div className="mt-2 flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-sm">
                    <AlertTriangle className="h-4 w-4 flex-shrink-0" />
                    <span>{noDeliveryError}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Right sidebar */}
          <div className="lg:col-span-5 space-y-6">
            {/* Payment Mode */}
            <div className="bg-white rounded-lg border border-gray-100 relative shadow-sm overflow-hidden">
              <div className="p-4 md:p-6">
                <div className="flex items-center gap-2 mb-6 border-l-4 border-brand-blue pl-3">
                  <h2 className="text-[16px] md:text-[18px] font-bold text-gray-800">Payment</h2>
                </div>

                {/* Payment Mode Selection */}
                <div className="space-y-2 mb-4">
                  {hasCodGateway && (
                    <div onClick={() => setPaymentOptionType('CASH_ON_DELIVERY')}
                      className={`rounded-lg p-3 flex items-center justify-between cursor-pointer transition-all ${paymentOptionType === 'CASH_ON_DELIVERY' ? 'border-2 border-brand-blue bg-brand-blue/5' : 'border border-gray-100 bg-[#fcfcfc] hover:border-brand-blue'}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gray-100 rounded-md flex items-center justify-center">
                          <Banknote size={20} className="text-brand-blue" />
                        </div>
                        <span className="text-[13px] text-gray-800 font-bold">Cash On Delivery</span>
                      </div>
                      {paymentOptionType === 'CASH_ON_DELIVERY' && <div className="w-5 h-5 rounded-full bg-brand-blue flex items-center justify-center"><ShieldCheck size={14} className="text-white" /></div>}
                    </div>
                  )}

                  {hasFullPayment && (
                    <div onClick={() => setPaymentOptionType('FULL_PAYMENT')}
                      className={`rounded-lg p-3 flex items-center justify-between cursor-pointer transition-all ${paymentOptionType === 'FULL_PAYMENT' ? 'border-2 border-brand-blue bg-brand-blue/5' : 'border border-gray-100 bg-[#fcfcfc] hover:border-brand-blue'}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-brand-blue rounded-md flex items-center justify-center">
                          <CreditCard size={20} className="text-white" />
                        </div>
                        <span className="text-[13px] text-gray-800 font-bold">Pay Online (Full)</span>
                      </div>
                      {paymentOptionType === 'FULL_PAYMENT' && <div className="w-5 h-5 rounded-full bg-brand-blue flex items-center justify-center"><ShieldCheck size={14} className="text-white" /></div>}
                    </div>
                  )}

                  {hasPartialPayment && (
                    <div onClick={() => setPaymentOptionType('PARTIAL_PAYMENT')}
                      className={`rounded-lg p-3 flex items-center justify-between cursor-pointer transition-all ${paymentOptionType === 'PARTIAL_PAYMENT' ? 'border-2 border-brand-blue bg-brand-blue/5' : 'border border-gray-100 bg-[#fcfcfc] hover:border-brand-blue'}`}>
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-[#f59e0b] rounded-md flex items-center justify-center">
                          <CreditCard size={20} className="text-white" />
                        </div>
                        <span className="text-[13px] text-gray-800 font-bold">Pay Partial Online</span>
                      </div>
                      {paymentOptionType === 'PARTIAL_PAYMENT' && <div className="w-5 h-5 rounded-full bg-brand-blue flex items-center justify-center"><ShieldCheck size={14} className="text-white" /></div>}
                    </div>
                  )}

                  {paymentOptionType === 'PARTIAL_PAYMENT' && (
                    <div className="mt-3">
                      <label className="text-xs text-gray-500 font-medium mb-1 block">Partial Payment Amount ({s})</label>
                      <input type="number" value={partialAmount} onChange={e => setPartialAmount(e.target.value)}
                        placeholder="Enter amount to pay now"
                        max={totalWithDelivery}
                        className="w-full border border-gray-200 rounded-md px-4 py-2.5 text-[14px] outline-none focus:border-brand-blue bg-[#fcfcfc]" />
                      <p className="text-xs text-gray-400 mt-1">Remaining {s}{Math.max(0, totalWithDelivery - (parseFloat(partialAmount) || 0)).toLocaleString('en-US', {minimumFractionDigits: 2})} will be collected on delivery</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Order Summary */}
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
                    <div className="p-4 md:p-6 pt-0 md:pt-0 space-y-3">
                      {appliedCoupon?.valid ? (
                        <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-md px-4 py-2.5">
                          <div>
                            <span className="text-sm font-bold text-green-700">{appliedCoupon.coupon.code}</span>
                            <span className="text-xs text-green-600 ml-2">
                              ({appliedCoupon.coupon.type === 'percentage' ? `${appliedCoupon.coupon.value}% off` : `${s}${appliedCoupon.coupon.value} off`})
                            </span>
                          </div>
                          <button onClick={handleRemoveCoupon} className="text-red-500 hover:text-red-700 text-sm font-bold">Remove</button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <input type="text" value={couponInput} onChange={e => setCouponInput(e.target.value)}
                            placeholder="Enter Coupon" className="flex-1 border border-gray-200 rounded-md px-4 py-2 text-[14px] outline-none focus:border-brand-blue bg-white" />
                          <button onClick={handleApplyCoupon} disabled={couponLoading}
                            className="bg-brand-blue text-white px-4 py-2 rounded-md text-[13px] font-bold uppercase transition-colors hover:bg-brand-blue/90 disabled:opacity-50">
                            {couponLoading ? '...' : 'Apply'}
                          </button>
                        </div>
                      )}
                      {couponError && <p className="text-red-500 text-xs">{couponError}</p>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="p-4 md:p-6 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[14px] text-gray-500 font-medium">Sub total</span>
                  <span className="text-[14px] text-gray-800 font-black">{s}{cartTotal.toLocaleString('en-US', {minimumFractionDigits: 2})} {config.currency.code}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[14px] text-gray-500 font-medium">Delivery cost</span>
                  <span className="text-[14px] text-gray-800 font-black">
                    {config.shippingMode === 'options' ? (
                      selectedShippingOptionId ? (
                        deliveryCharge === 0 ? `${s}0 (Free)` : `${s}${deliveryCharge.toLocaleString('en-US', {minimumFractionDigits: 2})}`
                      ) : (
                        <span className="text-gray-400 italic">Select option</span>
                      )
                    ) : (
                      district ? (
                        deliveryCharge === 0 ? `${s}0 (Free)` : `${s}${deliveryCharge.toLocaleString('en-US', {minimumFractionDigits: 2})}`
                      ) : (
                        <span className="text-gray-400 italic">Not selected</span>
                      )
                    )}
                  </span>
                </div>
                {appliedCoupon?.valid && discountAmount > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span className="text-[14px] font-medium">Discount ({appliedCoupon.coupon.code})</span>
                    <span className="text-[14px] font-black">-{s}{discountAmount.toFixed(2)}</span>
                  </div>
                )}
                {paymentOptionType === 'PARTIAL_PAYMENT' && partialAmount && parseFloat(partialAmount) > 0 && (
                  <div className="flex justify-between items-center">
                    <span className="text-[14px] text-gray-500 font-medium">Paid Online</span>
                    <span className="text-[14px] text-green-600 font-black">-{s}{parseFloat(partialAmount).toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-4 mt-4 border-t-2 border-dashed border-gray-100">
                  <span className="text-[16px] font-black text-gray-900">Total</span>
                  <span className="text-[16px] font-black text-gray-900">{s}{totalWithDelivery.toLocaleString('en-US', {minimumFractionDigits: 2})} {config.currency.code}</span>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-4 md:p-6">
                <div className="flex items-center gap-2 mb-4 border-l-4 border-brand-blue pl-3">
                  <h2 className="text-[15px] font-bold text-gray-800">Special notes <span className="font-normal text-[12px] text-gray-400 ml-1">(Optional)</span></h2>
                </div>
                <textarea value={customerNotes} onChange={e => setCustomerNotes(e.target.value)}
                  className="w-full border border-gray-100 rounded-lg px-4 py-3 text-[14px] outline-none focus:border-brand-blue resize-none h-24 bg-[#fcfcfc]" maxLength={90} />
                <div className="text-[11px] text-gray-400 mt-1 text-right">{customerNotes.length} / 90 characters</div>
              </div>
            </div>

            {/* Submit */}
            <div className="space-y-4">
              <div className="flex items-start gap-3 px-2">
                <div className="w-5 h-5 rounded-full bg-brand-blue flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                  <ShieldCheck size={12} className="text-white" />
                </div>
                <p className="text-[12px] md:text-[13px] text-gray-500 leading-relaxed">
                  I have read and agree to the <span className="text-brand-blue font-bold cursor-pointer hover:underline">Terms and Conditions</span>, <span className="text-brand-blue font-bold cursor-pointer hover:underline">Privacy Policy</span> & <span className="text-brand-blue font-bold cursor-pointer hover:underline">Refund and Return Policy</span>.
                </p>
              </div>
              {paymentOptionType === 'CASH_ON_DELIVERY' && (
                <button onClick={handlePlaceOrder} disabled={!canSubmit}
                  className={`w-full text-white font-black h-14 rounded-lg text-[16px] uppercase tracking-widest shadow-lg transition-all active:scale-[0.98] ${canSubmit ? 'bg-brand-blue hover:bg-brand-blue/90 shadow-brand-blue/20' : 'bg-gray-400 cursor-not-allowed'}`}>
                  {submitting ? 'PLACING ORDER...' : 'PLACE ORDER'}
                </button>
              )}
              {(paymentOptionType === 'FULL_PAYMENT' || paymentOptionType === 'PARTIAL_PAYMENT') && (
                <button onClick={handlePayNow} disabled={!canSubmit}
                  className={`w-full text-white font-black h-14 rounded-lg text-[16px] uppercase tracking-widest shadow-lg transition-all active:scale-[0.98] ${canSubmit ? 'bg-[#f59e0b] hover:bg-[#d97706] shadow-amber-500/20' : 'bg-gray-400 cursor-not-allowed'}`}>
                  {submitting ? 'PROCESSING...' : `PAY ${s}${(paymentOptionType === 'PARTIAL_PAYMENT' && partialAmount ? parseFloat(partialAmount) : totalWithDelivery).toLocaleString('en-US', {minimumFractionDigits: 2})}`}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {paymentPopup && (
        <PaymentPopup
          orderId={paymentPopup.orderId}
          total={paymentPopup.total}
          viewToken={paymentPopup.viewToken}
          guestPhone={guestPhone}
          guestName={guestName}
          onSuccess={() => paymentSuccessCallback.current?.()}
          onClose={() => {
            paymentSuccessCallback.current = null;
            setPaymentPopup(null);
            router.push(`/checkout/thank-you?orderId=${paymentPopup.orderId}&t=${paymentPopup.viewToken}&pending=true`);
          }}
        />
      )}
    </div>
  );
}
