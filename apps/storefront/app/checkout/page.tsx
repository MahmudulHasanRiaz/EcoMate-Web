"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ShieldCheck, ChevronRight, X, Minus, Plus, Package2, Loader2, CreditCard, Banknote, ArrowLeft, ExternalLink, CheckCircle, AlertTriangle } from 'lucide-react';
import { PaymentLogo } from '@/components/PaymentLogo';
import Image from 'next/image';
import Link from 'next/link';
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

interface SearchableSelectProps {
  id?: string;
  placeholder: string;
  options: Array<{ name: string; nameBn?: string }>;
  value: string;
  onChange: (val: string) => void;
  error?: boolean;
}

function SearchableSelect({
  id,
  placeholder,
  options,
  value,
  onChange,
  error,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const containerRef = React.useRef<HTMLDivElement>(null);

  const currentValueLabel = React.useMemo(() => {
    if (!value) return '';
    const found = options.find((opt) => opt.name === value);
    if (!found) return value;
    return found.nameBn ? `${found.name}-${found.nameBn}` : found.name;
  }, [value, options]);

  const filteredOptions = React.useMemo(() => {
    if (!search) return options;
    const q = search.toLowerCase();
    return options.filter((opt) => {
      const en = opt.name.toLowerCase();
      const bn = opt.nameBn ? opt.nameBn.toLowerCase() : '';
      return en.includes(q) || bn.includes(q);
    });
  }, [search, options]);

  React.useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="relative">
        <input
          id={id}
          type="text"
          placeholder={placeholder}
          value={isOpen ? search : currentValueLabel}
          onFocus={() => {
            setIsOpen(true);
            setSearch('');
          }}
          onChange={(e) => {
            setSearch(e.target.value);
            setIsOpen(true);
          }}
          className={`w-full h-11 border rounded-md pl-3.5 pr-10 text-xs outline-none bg-white font-medium transition-all focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/10 ${
            error ? 'border-red-400' : 'border-gray-250'
          }`}
          autoComplete="off"
        />
        <ChevronDown
          size={14}
          className={`absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </div>

      {isOpen && (
        <div className="absolute z-[110] left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg py-1">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((opt) => {
              const label = opt.nameBn ? `${opt.name}-${opt.nameBn}` : opt.name;
              return (
                <button
                  key={opt.name}
                  type="button"
                  onClick={() => {
                    onChange(opt.name);
                    setIsOpen(false);
                    setSearch('');
                  }}
                  className={`w-full text-left px-4 py-2 text-xs font-medium hover:bg-brand-blue/5 hover:text-brand-blue transition-colors ${
                    value === opt.name ? 'bg-brand-blue/10 text-brand-blue font-bold' : 'text-gray-700'
                  }`}
                >
                  {label}
                </button>
              );
            })
          ) : (
            <div className="px-4 py-2.5 text-xs text-muted-foreground italic">No results found</div>
          )}
        </div>
      )}
    </div>
  );
}

function CheckoutItemRow({ item, removeFromCart, updateQuantity, currencySymbol }: any) {
  const s = currencySymbol || '৳';
  const key = getItemKey(item);
  return (
    <div className="flex gap-3 py-3.5 border-b border-gray-100 last:border-0 items-start">
      {/* Thumbnail with Badge */}
      <div className="relative flex-shrink-0">
        <div className="w-14 h-14 border border-gray-200 rounded-md flex items-center justify-center p-1 bg-white">
          <Image src={item.image || '/placeholder.svg'} alt={item.name} width={56} height={56} className="w-full h-full object-contain rounded"
            onError={(e) => { e.currentTarget.src = '/placeholder.svg'; }} />
        </div>
        <span className="absolute -top-1.5 -right-1.5 bg-gray-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-[10px] font-bold shadow-sm border border-white">
          {item.quantity}
        </span>
      </div>

      {/* Item Details */}
      <div className="flex-1 min-w-0">
        <h3 className="text-xs font-bold text-gray-800 leading-snug break-words">
          {item.name}
        </h3>
        
        {/* Attributes or Sub items */}
        {item.isCombo ? (
          item.comboItems && (
            <div className="mt-1 space-y-0.5">
              {item.comboItems.map((sub: any, idx: number) => {
                const selAttrs = item.comboSelectionAttributes?.[sub.productId];
                const selLabel = item.comboSelectionLabels?.[sub.productId];
                const subAttrText = formatAttributes(selAttrs, selLabel);
                return (
                  <div key={idx} className="text-[10px] text-gray-400 leading-tight">
                    • {sub.productName} &times; {sub.quantity} {subAttrText && `(${subAttrText})`}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          (() => {
            const attrText = formatAttributes(item.variantAttributes, item.variantLabel);
            if (attrText) {
              return (
                <span className="block text-[10px] text-gray-400 mt-0.5 font-medium leading-tight">
                  {attrText}
                </span>
              );
            }
            return null;
          })()
        )}

        {/* Quantity Controls & Remove */}
        <div className="flex items-center gap-2 mt-1.5">
          <div className="flex items-center h-5.5 border border-gray-200 rounded bg-[#f9fafb] overflow-hidden">
            <button onClick={() => updateQuantity(key, item.quantity - 1)} className="w-5 h-full flex items-center justify-center text-gray-500 hover:bg-gray-100 cursor-pointer"><Minus size={9} /></button>
            <span className="w-7 h-full flex items-center justify-center bg-white text-[10px] font-bold text-gray-800">{item.quantity}</span>
            <button onClick={() => updateQuantity(key, item.quantity + 1)} className="w-5 h-full flex items-center justify-center text-brand-blue hover:bg-gray-100 cursor-pointer"><Plus size={9} /></button>
          </div>
          <button onClick={() => removeFromCart(key)} className="text-[10px] text-red-500 hover:text-red-650 font-bold ml-1 transition-colors cursor-pointer">Remove</button>
        </div>
      </div>

      {/* Price */}
      <div className="text-xs font-bold text-gray-800 shrink-0 self-start mt-0.5">
        {s}{(item.price * item.quantity).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
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
                <PaymentLogo method={selectedGw.code} size="md" />
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
            return (
              <button
                key={gw.id}
                onClick={() => handleSelectGateway(gw)}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-gray-200 hover:border-brand-blue hover:bg-brand-blue/5 transition-all"
              >
                <PaymentLogo method={gw.code} size="md" />
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

  const [mounted, setMounted] = useState(false);
  const [districts, setDistricts] = useState<any[]>([]);
  const [thanas, setThanas] = useState<any[]>([]);
  const [district, setDistrict] = useState('');
  const [thana, setThana] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [customerNotes, setCustomerNotes] = useState('');
  const [isNotesExpanded, setIsNotesExpanded] = useState(false);
  const [isCouponExpanded, setIsCouponExpanded] = useState(false);
  const [isItemsExpanded, setIsItemsExpanded] = useState(false);
  const [isMobileSummaryOpen, setIsMobileSummaryOpen] = useState(false);
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
    const notes = readStorage('checkout_notes', '');
    setDistrict(readStorage('checkout_district', ''));
    setThana(readStorage('checkout_thana', ''));
    setAddressLine(readStorage('checkout_address', ''));
    setCustomerNotes(notes);
    if (notes.trim().length > 0) {
      setIsNotesExpanded(true);
    }
    setGuestName(readStorage('checkout_guestName', ''));
    setGuestPhone(readStorage('checkout_guestPhone', ''));
    setPaymentOptionType((readStorage('checkout_paymentOptionType', 'CASH_ON_DELIVERY') as 'FULL_PAYMENT' | 'PARTIAL_PAYMENT' | 'CASH_ON_DELIVERY'));
    setMounted(true);
  }, []);

  const checkoutCfg = config.checkout;

  const [gateways, setGateways] = useState<any[]>([]);
  useEffect(() => {
    getGateways().then(list => setGateways(list)).catch(() => {});
  }, []);
  const hasCodGateway = gateways.some(g => g.code === 'cash' && g.enabled) && (checkoutCfg?.paymentOptions?.CASH_ON_DELIVERY !== false);
  const hasFullPayment = (checkoutCfg?.paymentOptions?.FULL_PAYMENT !== false) && gateways.some(g => g.code !== 'cash' && g.enabled);
  const hasPartialPayment = (checkoutCfg?.paymentOptions?.PARTIAL_PAYMENT !== false) && gateways.some(g => g.code !== 'cash' && g.enabled);

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
        phone: user?.phoneNumber || '',
        name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || '',
      });
      initiatedRef.current = true;
    }
  }, [items, config.currency.code, user]);

  const getLeadData = useCallback(() => {
    const rawPhone = guestPhone || user?.phoneNumber || '';
    const phone = normalizePhone(rawPhone);
    const name = guestName || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || '';
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

  const leadDataRef = useRef(getLeadData());
  leadDataRef.current = getLeadData();

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
      const data = leadDataRef.current;
      if (data) navigator.sendBeacon(beaconUrl, new Blob([JSON.stringify(data)], { type: 'application/json' }));
    };
    window.addEventListener('beforeunload', sendLead);
    return () => {
      window.removeEventListener('beforeunload', sendLead);
      if (leadTimer.current) clearTimeout(leadTimer.current);
      sendLead();
    };
  }, []);

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
    
    const errorKeys = Object.keys(errors);
    if (errorKeys.length > 0) {
      // Find the first error in visual order: Phone -> Name -> District -> Thana -> Address Detail
      const visualOrder = ['guestPhone', 'guestName', 'district', 'thana', 'addressLine', 'shippingOption'];
      const firstErrorField = visualOrder.find(k => k in errors);
      if (firstErrorField) {
        setTimeout(() => {
          const element = document.getElementById(`checkout-${firstErrorField}`);
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.focus();
          }
        }, 80);
      }
    }

    return errorKeys.length === 0;
  };

  const handlePlaceOrder = async () => {
    if (items.length === 0) {
      toast.error('Your cart is empty. Please add items to your cart.');
      return;
    }
    if (submitting) return;
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

  const renderCartItems = () => {
    if (items.length === 0) {
      return <p className="text-gray-400 text-xs py-2">Your cart is empty.</p>;
    }
    
    const maxVisible = 2;
    const hasMore = items.length > maxVisible;
    const visibleItems = isItemsExpanded ? items : items.slice(0, maxVisible);
    
    return (
      <div className="divide-y divide-gray-100">
        {visibleItems.map(item => (
          <CheckoutItemRow
            key={getItemKey(item)}
            item={item}
            removeFromCart={removeFromCart}
            updateQuantity={updateQuantity}
            currencySymbol={s}
          />
        ))}
        {hasMore && (
          <button
            onClick={() => setIsItemsExpanded(!isItemsExpanded)}
            className="w-full text-center py-2.5 text-xs text-brand-blue font-bold hover:underline flex items-center justify-center gap-1 mt-1 cursor-pointer"
          >
            {isItemsExpanded ? 'Show less' : `+ Show ${items.length - maxVisible} more item${items.length - maxVisible > 1 ? 's' : ''}`}
            <ChevronDown size={12} className={`transform transition-transform ${isItemsExpanded ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>
    );
  };

  const renderCouponSection = () => {
    return (
      <div className="space-y-2.5">
        {appliedCoupon?.valid ? (
          <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-md px-3.5 py-2">
            <div>
              <span className="text-xs font-bold text-green-700">{appliedCoupon.coupon.code}</span>
              <span className="text-[10px] text-green-600 ml-2">
                ({appliedCoupon.coupon.type === 'percentage' ? `${appliedCoupon.coupon.value}% off` : `${s}${appliedCoupon.coupon.value} off`})
              </span>
            </div>
            <button onClick={handleRemoveCoupon} className="text-red-500 hover:text-red-700 text-xs font-bold cursor-pointer">Remove</button>
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              type="text"
              value={couponInput}
              onChange={e => setCouponInput(e.target.value)}
              placeholder="Discount code or gift voucher"
              className="flex-1 border border-gray-250 rounded-md px-3.5 py-2.5 text-xs outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/10 bg-white transition-all"
            />
            <button
              onClick={handleApplyCoupon}
              disabled={couponLoading}
              className="bg-brand-blue text-white px-5 py-2.5 rounded-md text-xs font-bold uppercase transition-all hover:bg-brand-blue/90 disabled:opacity-50 cursor-pointer active:scale-[0.98] shadow-xs"
            >
              {couponLoading ? '...' : 'Apply'}
            </button>
          </div>
        )}
        {couponError && <p className="text-red-500 text-[11px] font-medium">{couponError}</p>}
      </div>
    );
  };

  const renderPricingBreakdown = () => {
    return (
      <div className="space-y-3.5 text-xs">
        <div className="flex justify-between items-center text-gray-500">
          <span>Subtotal</span>
          <span className="font-bold text-gray-800">{s}{cartTotal.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
        </div>
        <div className="flex justify-between items-center text-gray-500">
          <span>Shipping</span>
          <span className="font-bold text-gray-800">
            {config.shippingMode === 'options' ? (
              selectedShippingOptionId ? (
                deliveryCharge === 0 ? 'Free' : `${s}${deliveryCharge.toLocaleString('en-US', {minimumFractionDigits: 2})}`
              ) : (
                <span className="text-gray-400 italic font-normal">Select shipping option</span>
              )
            ) : (
              district ? (
                deliveryCharge === 0 ? 'Free' : `${s}${deliveryCharge.toLocaleString('en-US', {minimumFractionDigits: 2})}`
              ) : (
                <span className="text-gray-400 italic font-normal">Calculated in next step</span>
              )
            )}
          </span>
        </div>
        {appliedCoupon?.valid && discountAmount > 0 && (
          <div className="flex justify-between items-center text-green-600">
            <span>Discount ({appliedCoupon.coupon.code})</span>
            <span className="font-bold text-green-700">-{s}{discountAmount.toFixed(2)}</span>
          </div>
        )}
        {paymentOptionType === 'PARTIAL_PAYMENT' && partialAmount && parseFloat(partialAmount) > 0 && (
          <div className="flex justify-between items-center text-gray-500">
            <span>Paid Online</span>
            <span className="font-bold text-green-600">-{s}{parseFloat(partialAmount).toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
          </div>
        )}
        <div className="flex justify-between items-center pt-3.5 border-t border-gray-200 mt-2">
          <span className="text-sm font-bold text-gray-850">Total</span>
          <span className="text-base font-black text-gray-900 flex items-baseline gap-1">
            <span className="text-[10px] text-gray-450 font-normal">{config.currency.code}</span>
            {s}{totalWithDelivery.toLocaleString('en-US', {minimumFractionDigits: 2})}
          </span>
        </div>
      </div>
    );
  };

  const renderPaymentSection = () => {
    return (
      <div className="space-y-4">
        <h2 className="text-base font-bold text-gray-805">Payment</h2>
        
        <div className="space-y-3">
          {hasCodGateway && (
            <label
              className={`flex items-center justify-between p-4 rounded-lg cursor-pointer transition-all border ${
                paymentOptionType === 'CASH_ON_DELIVERY'
                  ? 'border-brand-blue bg-brand-blue/[0.015] shadow-xs'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="paymentOption"
                  value="CASH_ON_DELIVERY"
                  checked={paymentOptionType === 'CASH_ON_DELIVERY'}
                  onChange={() => setPaymentOptionType('CASH_ON_DELIVERY')}
                  className="accent-brand-blue h-4 w-4"
                />
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-gray-805">Cash on Delivery</span>
                  <span className="text-[10px] text-gray-400 mt-0.5 font-medium">Pay with cash upon delivery</span>
                </div>
              </div>
              <Banknote size={16} className={paymentOptionType === 'CASH_ON_DELIVERY' ? 'text-brand-blue' : 'text-gray-400'} />
            </label>
          )}

          {hasFullPayment && (
            <label
              className={`flex items-center justify-between p-4 rounded-lg cursor-pointer transition-all border ${
                paymentOptionType === 'FULL_PAYMENT'
                  ? 'border-brand-blue bg-brand-blue/[0.015] shadow-xs'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="paymentOption"
                  value="FULL_PAYMENT"
                  checked={paymentOptionType === 'FULL_PAYMENT'}
                  onChange={() => setPaymentOptionType('FULL_PAYMENT')}
                  className="accent-brand-blue h-4 w-4"
                />
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-gray-805">Pay Online (Full)</span>
                  <span className="text-[10px] text-gray-400 mt-0.5 font-medium">Pay the full amount online</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <PaymentLogo method="bkash" size="sm" />
                <PaymentLogo method="nagad" size="sm" />
                <PaymentLogo method="rocket" size="sm" />
                <CreditCard size={16} className={paymentOptionType === 'FULL_PAYMENT' ? 'text-brand-blue ml-1' : 'text-gray-400 ml-1'} />
              </div>
            </label>
          )}

          {hasPartialPayment && (
            <label
              className={`flex items-center justify-between p-4 rounded-lg cursor-pointer transition-all border ${
                paymentOptionType === 'PARTIAL_PAYMENT'
                  ? 'border-brand-blue bg-brand-blue/[0.015] shadow-xs'
                  : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50/50'
              }`}
            >
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="paymentOption"
                  value="PARTIAL_PAYMENT"
                  checked={paymentOptionType === 'PARTIAL_PAYMENT'}
                  onChange={() => setPaymentOptionType('PARTIAL_PAYMENT')}
                  className="accent-brand-blue h-4 w-4"
                />
                <div className="flex flex-col">
                  <span className="text-xs font-bold text-gray-805">Pay Partial Online</span>
                  <span className="text-[10px] text-gray-400 mt-0.5 font-medium">Pay a deposit online, rest on delivery</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <PaymentLogo method="bkash" size="sm" />
                <PaymentLogo method="nagad" size="sm" />
                <PaymentLogo method="rocket" size="sm" />
                <CreditCard size={16} className={paymentOptionType === 'PARTIAL_PAYMENT' ? 'text-brand-blue ml-1' : 'text-gray-400 ml-1'} />
              </div>
            </label>
          )}
        </div>

        {paymentOptionType === 'PARTIAL_PAYMENT' && (
          <div className="bg-[#fafafa] border border-gray-200 rounded-lg p-4 space-y-2 mt-2">
            <label className="text-xs text-gray-500 font-bold uppercase tracking-wide block">Partial Payment Amount ({s})</label>
            <input
              type="number"
              value={partialAmount}
              onChange={e => setPartialAmount(e.target.value)}
              placeholder="Enter amount to pay now"
              max={totalWithDelivery}
              className="w-full border border-gray-200 rounded-md px-3.5 py-2 text-xs outline-none focus:border-brand-blue bg-white font-semibold"
            />
            <p className="text-[11px] text-gray-500">
              Remaining <span className="font-bold text-gray-850">{s}{Math.max(0, totalWithDelivery - (parseFloat(partialAmount) || 0)).toLocaleString('en-US', {minimumFractionDigits: 2})}</span> will be collected on delivery
            </p>
          </div>
        )}
      </div>
    );
  };

  if (!mounted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-brand-blue animate-spin" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl border border-gray-150 max-w-md w-full text-center space-y-6 shadow-2xs">
          <div className="w-16 h-16 bg-brand-blue/10 rounded-full flex items-center justify-center mx-auto text-brand-blue">
            <Package2 size={32} />
          </div>
          <h1 className="text-xl font-bold text-gray-805">Your cart is empty</h1>
          <p className="text-xs text-gray-500 font-medium">
            You don't have any items in your shopping cart. Please add some products to checkout.
          </p>
          <Link
            href="/"
            className="block w-full bg-brand-blue hover:bg-brand-blue/95 text-white font-bold py-3.5 px-6 rounded-md text-xs uppercase tracking-wider transition-all duration-200 active:scale-[0.99] text-center shadow-md shadow-brand-blue/10"
          >
            Go Shopping
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white font-sans text-gray-700 antialiased">
      {/* Mobile Header (Logo & Back link) */}
      <div className="bg-white border-b border-gray-100 py-3 lg:hidden">
        <div className="max-w-screen-xl mx-auto px-4 flex justify-between items-center">
          <Link href="/" className="hover:text-brand-blue transition-colors flex items-center">
            {config.branding?.storeLogo ? (
              <img src={config.branding.storeLogo} alt={config.store?.name || 'EcoMate'} className="h-6 w-auto object-contain" />
            ) : (
              <span className="text-base font-black tracking-tight text-gray-805">
                {config.store?.name || 'EcoMate'}
              </span>
            )}
          </Link>
          <Link href="/cart" className="text-xs font-semibold text-brand-blue hover:underline flex items-center gap-1">
            <ArrowLeft size={12} /> Back
          </Link>
        </div>
      </div>

      {/* Mobile Sticky Summary Header */}
      <div className="bg-white/80 backdrop-blur-md border-b border-gray-200/80 py-3 sticky top-0 z-30 lg:hidden shadow-xs">
        <div className="max-w-screen-xl mx-auto px-4 flex justify-between items-center">
          <button
            onClick={() => setIsMobileSummaryOpen(!isMobileSummaryOpen)}
            className="flex items-center gap-2 text-xs font-bold text-gray-805 outline-none cursor-pointer"
          >
            <Package2 size={16} className="text-gray-600" />
            <span className="text-brand-blue">{isMobileSummaryOpen ? 'Hide order summary' : 'Show order summary'}</span>
            <ChevronDown size={12} className={`text-brand-blue transform transition-transform duration-200 ${isMobileSummaryOpen ? 'rotate-180' : ''}`} />
          </button>
          <div className="text-sm font-black text-gray-800">
            {s}{totalWithDelivery.toLocaleString('en-US', {minimumFractionDigits: 2})}
          </div>
        </div>
      </div>

      {/* Mobile Summary Expandable Panel */}
      <AnimatePresence>
        {isMobileSummaryOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden bg-[#fafafa] border-b border-gray-200 lg:hidden"
          >
            <div className="px-4 py-5 space-y-4">
              {/* Product List */}
              {renderCartItems()}
              
              {/* Coupon Section */}
              <div className="border-t border-gray-200 pt-4">
                {renderCouponSection()}
              </div>

              {/* Pricing Breakdown */}
              <div className="border-t border-gray-200 pt-4">
                {renderPricingBreakdown()}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Container */}
      <div className="max-w-screen-xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-screen">
          
          {/* Left Column - Forms (Contact, Shipping, Payment) */}
          <div className="lg:col-span-7 px-4 pt-6 pb-28 md:py-10 lg:pr-12 xl:pr-16 space-y-8 bg-white">
            
            {/* Header / Shop Title */}
            <div className="hidden lg:flex justify-between items-baseline border-b border-gray-100 pb-4 mb-2">
              <Link href="/" className="hover:text-brand-blue transition-colors flex items-center">
                {config.branding?.storeLogo ? (
                  <img src={config.branding.storeLogo} alt={config.store?.name || 'EcoMate'} className="h-8 w-auto object-contain" />
                ) : (
                  <span className="text-xl font-black tracking-tight text-gray-800">
                    {config.store?.name || 'EcoMate'}
                  </span>
                )}
              </Link>
              <Link href="/cart" className="text-xs font-semibold text-brand-blue hover:underline flex items-center gap-1">
                <ArrowLeft size={12} /> Back to Cart
              </Link>
            </div>

            {/* Contact Information */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-base font-bold text-gray-800">Contact</h2>
                {!user && (
                  <span className="text-xs text-gray-500 font-medium">
                    Already have an account?{" "}
                    <Link href="/account?redirect=/checkout" className="text-brand-blue font-bold hover:underline cursor-pointer">
                      Log in
                    </Link>
                  </span>
                )}
              </div>

              {!user && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Name Input (Second on Mobile, First on Desktop) */}
                  <div className="order-2 md:order-1">
                    <input
                      id="checkout-guestName"
                      type="text"
                      value={guestName}
                      onChange={e => { setGuestName(e.target.value); clearFieldError('guestName'); scheduleLeadCapture(); }}
                      placeholder="Your Full Name *"
                      className={`w-full h-11 border rounded-md px-3.5 text-xs outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/10 transition-all bg-white ${fieldErrors.guestName ? 'border-red-400' : 'border-gray-250'}`}
                    />
                    {fieldErrors.guestName && <p className="text-red-500 text-[10px] mt-1 font-semibold">{fieldErrors.guestName}</p>}
                  </div>
                  
                  {/* Phone Input (First on Mobile, Second on Desktop) */}
                  <div className="order-1 md:order-2">
                    <div className={`flex items-stretch h-11 rounded-md bg-white border transition-all focus-within:border-brand-blue focus-within:ring-2 focus-within:ring-brand-blue/10 ${showPhoneError || fieldErrors.guestPhone ? 'border-red-400' : 'border-gray-250'}`}>
                      <div className="px-3.5 bg-[#f8f9fa] text-gray-500 font-semibold text-xs border-r border-gray-200 flex items-center shrink-0 rounded-l-md">+880</div>
                      <input
                        id="checkout-guestPhone"
                        type="tel"
                        value={guestPhone}
                        onChange={e => { setGuestPhone(e.target.value); clearFieldError('guestPhone'); scheduleLeadCapture(); }}
                        placeholder="1X XXXX XXXX *"
                        className="w-full px-3.5 py-2 text-xs outline-none bg-transparent text-gray-800 font-medium placeholder-gray-400"
                      />
                    </div>
                    {fieldErrors.guestPhone && <p className="text-red-500 text-[10px] mt-1 font-semibold">{fieldErrors.guestPhone}</p>}
                    {showPhoneError && <p className="text-red-500 text-[10px] mt-1 font-semibold">Please enter a valid Bangladeshi phone number</p>}
                  </div>
                </div>
              )}

              {user && (
                <div className="bg-[#f9fafb] rounded-lg p-3 border border-gray-100 flex items-center justify-between">
                  <div className="text-xs">
                    <p className="font-bold text-gray-855">{[user.firstName, user.lastName].filter(Boolean).join(' ') || 'Logged in user'}</p>
                    <p className="text-gray-400 font-medium mt-0.5">{user.phoneNumber || user.email}</p>
                  </div>
                  <span className="text-[10px] bg-green-50 text-green-600 font-bold border border-green-200 rounded px-1.5 py-0.5">Verified</span>
                </div>
              )}
            </div>

            {/* Shipping Address */}
            <div className="space-y-4">
              <h2 className="text-base font-bold text-gray-800">Delivery address</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {checkoutCfg?.districtEnabled !== false && (
                  <div className="space-y-1">
                    <SearchableSelect
                      id="checkout-district"
                      placeholder={checkoutCfg?.districtRequired ? 'Select District *' : 'Select District (Optional)'}
                      options={districts}
                      value={district}
                      onChange={(val) => { setDistrict(val); setThana(''); clearFieldError('district'); scheduleLeadCapture(); }}
                      error={!!fieldErrors.district}
                    />
                    {fieldErrors.district && <p className="text-red-500 text-[10px] mt-0.5 font-semibold">{fieldErrors.district}</p>}
                  </div>
                )}

                {checkoutCfg?.thanaEnabled !== false && district && (
                  <div className="space-y-1">
                    <SearchableSelect
                      id="checkout-thana"
                      placeholder={checkoutCfg?.thanaRequired ? 'Select Thana/Upazila *' : 'Select Thana/Upazila (Optional)'}
                      options={thanas}
                      value={thana}
                      onChange={(val) => { setThana(val); clearFieldError('thana'); scheduleLeadCapture(); }}
                      error={!!fieldErrors.thana}
                    />
                    {fieldErrors.thana && <p className="text-red-500 text-[10px] mt-0.5 font-semibold">{fieldErrors.thana}</p>}
                  </div>
                )}

                <div className="md:col-span-2">
                  <textarea
                    id="checkout-addressLine"
                    value={addressLine}
                    onChange={e => { setAddressLine(e.target.value); clearFieldError('addressLine'); }}
                    placeholder="Address detail (apartment, suite, unit, building, street) *"
                    rows={2}
                    className={`w-full border rounded-md px-3.5 py-2.5 text-xs outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/10 resize-none bg-white transition-all ${fieldErrors.addressLine ? 'border-red-400' : 'border-gray-250'}`}
                  />
                  {fieldErrors.addressLine && <p className="text-red-500 text-[10px] mt-0.5 font-semibold">{fieldErrors.addressLine}</p>}
                </div>
              </div>

              {config.shippingMode === 'options' && config.shippingOptions?.length > 0 && (
                <div className="space-y-2 pt-2">
                  <label className="text-xs font-bold text-gray-600 uppercase tracking-wide">Shipping Method</label>
                  <div className="border border-gray-200 rounded-lg overflow-hidden bg-white">
                    {config.shippingOptions.map(opt => (
                      <label key={opt.id} className={`flex items-center justify-between p-3.5 border-b border-gray-200 last:border-0 cursor-pointer transition-colors ${selectedShippingOptionId === opt.id ? 'bg-brand-blue/5' : 'hover:bg-gray-50'}`}>
                        <div className="flex items-center gap-3">
                          <input
                            type="radio"
                            name="shippingOption"
                            value={opt.id}
                            checked={selectedShippingOptionId === opt.id}
                            onChange={() => { setSelectedShippingOptionId(opt.id); clearFieldError('shippingOption'); }}
                            className="accent-brand-blue"
                          />
                          <span className="text-xs font-medium text-gray-800">{opt.name}</span>
                        </div>
                        <span className="text-xs font-bold text-gray-800">{s}{opt.amount}</span>
                      </label>
                    ))}
                  </div>
                  {fieldErrors.shippingOption && <p className="text-red-500 text-[10px] mt-1">{fieldErrors.shippingOption}</p>}
                </div>
              )}

              {config.shippingMode !== 'options' && district && deliveryCharge > 0 && !noDeliveryError && (
                <p className="text-[10px] text-gray-400">
                  Delivery cost for {district}: <span className="font-bold text-gray-600">{s}{deliveryCharge}</span>
                  {cartTotal >= config.delivery.freeDeliveryMin && (
                    <span className="text-green-600 ml-2 font-bold">(Free shipping on orders above {s}{config.delivery.freeDeliveryMin})</span>
                  )}
                </p>
              )}

              {noDeliveryError && (
                <div className="flex items-center gap-2 text-red-600 bg-red-50 border border-red-200 rounded-md px-3.5 py-2.5 text-xs font-medium">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{noDeliveryError}</span>
                </div>
              )}
            </div>

            {/* Payment Options */}
            {renderPaymentSection()}

            {/* Notes */}
            <div className="space-y-2">
              {!isNotesExpanded ? (
                <button
                  type="button"
                  onClick={() => setIsNotesExpanded(true)}
                  className="text-xs font-semibold text-brand-blue hover:text-brand-blue/80 transition-colors flex items-center gap-1 cursor-pointer outline-none"
                >
                  <Plus size={14} /> Add delivery instructions / order notes (optional)
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <h2 className="text-xs font-bold text-gray-805 uppercase tracking-wider">Order notes</h2>
                    <button
                      type="button"
                      onClick={() => { setIsNotesExpanded(false); setCustomerNotes(''); }}
                      className="text-xs font-medium text-red-500 hover:text-red-600 flex items-center gap-0.5 cursor-pointer outline-none"
                    >
                      Cancel
                    </button>
                  </div>
                  <textarea
                    value={customerNotes}
                    onChange={e => setCustomerNotes(e.target.value)}
                    placeholder="Notes about your order, e.g. special instructions for delivery."
                    rows={2}
                    className="w-full border border-gray-250 rounded-md px-3.5 py-2.5 text-xs outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/10 resize-none bg-white transition-all"
                    maxLength={90}
                  />
                  <div className="text-[10px] text-gray-450 text-right">{customerNotes.length} / 90 characters</div>
                </div>
              )}
            </div>

            {/* Checkout Action Button */}
            <div className="space-y-4 pt-2 border-t border-gray-100">
              <div className="flex items-start gap-2.5">
                <div className="w-4 h-4 rounded-full bg-brand-blue/10 flex items-center justify-center shrink-0 mt-0.5">
                  <ShieldCheck size={10} className="text-brand-blue" />
                </div>
                <p className="text-[10px] text-gray-400 leading-normal">
                  By placing order, you agree to EcoMate's{" "}
                  <Link href="/terms-conditions" className="text-brand-blue hover:underline font-bold">Terms & Conditions</Link>,{" "}
                  <Link href="/privacy-policy" className="text-brand-blue hover:underline font-bold">Privacy Policy</Link>, and{" "}
                  <Link href="/refund-policy" className="text-brand-blue hover:underline font-bold">Return Policy</Link>.
                </p>
              </div>

              {paymentOptionType === 'CASH_ON_DELIVERY' && (
                <button
                  onClick={handlePlaceOrder}
                  disabled={submitting}
                  className="hidden lg:block w-full text-white font-bold h-12 rounded-md text-sm uppercase tracking-wider transition-all duration-250 active:scale-[0.99] cursor-pointer shadow-md outline-none bg-brand-blue hover:bg-brand-blue/95 hover:shadow-lg hover:shadow-brand-blue/15 shadow-brand-blue/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Placing Order...' : 'Complete Order'}
                </button>
              )}
              
              {(paymentOptionType === 'FULL_PAYMENT' || paymentOptionType === 'PARTIAL_PAYMENT') && (
                <button
                  onClick={handlePayNow}
                  disabled={submitting}
                  className="hidden lg:block w-full text-white font-bold h-12 rounded-md text-sm uppercase tracking-wider transition-all duration-250 active:scale-[0.99] cursor-pointer shadow-md outline-none bg-amber-500 hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-500/15 shadow-amber-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Processing...' : `Pay ${s}${(paymentOptionType === 'PARTIAL_PAYMENT' && partialAmount ? parseFloat(partialAmount) : totalWithDelivery).toLocaleString('en-US', {minimumFractionDigits: 2})}`}
                </button>
              )}
            </div>

          </div>

          {/* Right Column - Desktop Order Summary (Items list, Coupon, Totals) */}
          <div className="hidden lg:col-span-5 lg:block bg-[#fafafa] border-l border-gray-200 px-8 py-10">
            <div className="sticky top-6 space-y-6 max-w-[450px]">
              
              {/* Product List */}
              <div className="border-b border-gray-200/80 pb-6">
                {renderCartItems()}
              </div>

              {/* Coupon Section */}
              <div className="border-b border-gray-200/80 pb-6">
                {renderCouponSection()}
              </div>

              {/* Cost Summary */}
              <div className="pt-2">
                {renderPricingBreakdown()}
              </div>

            </div>
          </div>

        </div>
      </div>

      {/* Mobile Sticky Bottom CTA Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-white/90 backdrop-blur-md border-t border-gray-200/80 px-4 py-3 flex items-center justify-between lg:hidden shadow-[0_-4px_12px_rgba(0,0,0,0.05)]">
        <div className="flex flex-col">
          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total</span>
          <span className="text-sm font-black text-gray-805">
            {s}{totalWithDelivery.toLocaleString('en-US', {minimumFractionDigits: 2})}
          </span>
        </div>
        
        <div className="w-3/5">
          {paymentOptionType === 'CASH_ON_DELIVERY' && (
            <button
              onClick={handlePlaceOrder}
              disabled={submitting}
              className="w-full text-white font-bold h-10.5 rounded-md text-[11px] uppercase tracking-wider transition-all duration-200 active:scale-[0.99] cursor-pointer shadow-md outline-none bg-brand-blue hover:bg-brand-blue/95 shadow-brand-blue/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Placing...' : 'Complete Order'}
            </button>
          )}
          
          {(paymentOptionType === 'FULL_PAYMENT' || paymentOptionType === 'PARTIAL_PAYMENT') && (
            <button
              onClick={handlePayNow}
              disabled={submitting}
              className="w-full text-white font-bold h-10.5 rounded-md text-[11px] uppercase tracking-wider transition-all duration-200 active:scale-[0.99] cursor-pointer shadow-md outline-none bg-amber-500 hover:bg-amber-600 shadow-amber-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Processing...' : `Pay ${s}${(paymentOptionType === 'PARTIAL_PAYMENT' && partialAmount ? parseFloat(partialAmount) : totalWithDelivery).toLocaleString('en-US', {minimumFractionDigits: 2})}`}
            </button>
          )}
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
