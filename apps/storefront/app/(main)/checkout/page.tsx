"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, ShieldCheck, X, Minus, Plus, Package2, Loader2, CreditCard, Banknote, ArrowLeft, ExternalLink, CheckCircle, AlertTriangle } from 'lucide-react';
import { PaymentLogo } from '@/components/PaymentLogo';
import { BankAccountInstructions } from '@/components/BankAccountInstructions';
import { BlockedPhoneDialog } from '@/components/BlockedPhoneDialog';
import { checkPhoneBlocked } from '@/lib/api/blocked-entries';
import Image from 'next/image';
import Link from 'next/link';
import { motion, AnimatePresence } from 'motion/react';
import { useCart, getItemKey, VariantAttribute } from '@/context/CartContext';
import { useAuth } from '@/context/AuthContext';
import { useStorefrontConfig } from '@/context/StorefrontConfigContext';
import { createOrder } from '@/lib/api/orders';
import { useAutoDiscounts } from '@/hooks/useAutoDiscounts';
import { resolveDeliveryCharge } from '@/lib/shipping-charge';
import { getDistricts, getThanas, getGateways } from '@/lib/api/delivery-areas';
import { submitPayment } from '@/lib/api/payments';
import { normalizePhone } from '@/lib/phone-utils';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { trackEvent, getCookie, isSyntheticEmail } from '@/lib/tracking';
import { computeCartSignature } from '@/lib/cart-signature';
import { cartLineTotal } from '@/lib/customization';
import { getOrCreateCtxId } from '@/lib/tracking-client';
import { getLandingAttribution, clearLandingAttribution } from '@/lib/attribution';
import { collectDeviceContext } from '@/lib/device-context';

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
    
    const normalizeBengali = (str: string) => {
      return str
        .replace(/\u09AF\u09BC/g, '\u09DF') // য + ় -> য়
        .replace(/\u09A1\u09BC/g, '\u09DC') // ড + ় -> ড়
        .replace(/\u09A2\u09BC/g, '\u09DD') // ঢ + ় -> ঢ়
        // Now remove all remaining Nuktas so that exact matches aren't strict on dots
        .replace(/\u09BC/g, '')
        // Convert য় to য, ড় to ড, ঢ় to ঢ for fuzzy matching
        .replace(/\u09DF/g, '\u09AF') // য় -> য
        .replace(/\u09DC/g, '\u09A1') // ড় -> ড
        .replace(/\u09DD/g, '\u09A2') // ঢ় -> ঢ
        .replace(/\u0981/g, '') // remove candrabindu
        .toLowerCase();
    };

    const q = normalizeBengali(search);
    return options.filter((opt) => {
      const en = opt.name.toLowerCase();
      const bn = opt.nameBn ? normalizeBengali(opt.nameBn) : '';
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
  const [imgError, setImgError] = React.useState(false);
  const [imgFallbackError, setImgFallbackError] = React.useState(false);
  const resolvedImg = imgError
    ? (!imgFallbackError && item.productImage ? item.productImage : '/placeholder.svg')
    : (item.image || '/placeholder.svg');
  return (
    <div className="flex gap-3 py-3.5 border-b border-gray-100 last:border-0 items-start">
      {/* Thumbnail with Badge */}
      <div className="relative flex-shrink-0">
        <div className="w-14 h-14 border border-gray-200 rounded-md flex items-center justify-center p-1 bg-white">
          {imgError ? (
            <div className="w-full h-full flex items-center justify-center bg-gray-100 rounded">
              <Package2 size={20} className="text-gray-300" />
            </div>
          ) : (
            <Image
              src={resolvedImg}
              alt={item.name}
              width={56}
              height={56}
              className="w-full h-full object-contain rounded"
              onError={() => {
                if (!imgError) setImgError(true);
                else if (item.productImage) setImgFallbackError(true);
              }}
            />
          )}
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

        {item.customization && item.customization.lines.length > 0 && (
          <div className="mt-1 space-y-0.5">
            <span className="inline-block text-[9px] font-semibold uppercase tracking-wide text-brand-blue border border-brand-blue/40 rounded-sm px-1 py-px">Customized</span>
            {item.customization.lines.map((l: { label: string; value: string }, idx: number) => (
              <div key={idx} className="text-[10px] text-gray-500 leading-tight">
                {l.label}: {l.value}
              </div>
            ))}
          </div>
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
        {s}{cartLineTotal(item).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
      </div>
    </div>
  );
}


function GatewayChips({ gateways }: { gateways: any[] }) {
  const online = gateways.filter(g => g.enabled && g.code !== 'cash').slice(0, 4);
  if (online.length === 0) return null;
  return (
    <span className="flex items-center gap-1.5">
      {online.map(gw => gw.logoUrl ? (
        <img key={gw.id} src={gw.logoUrl} alt={gw.name || gw.code} className="h-6 w-8 rounded object-contain" />
      ) : (
        <PaymentLogo key={gw.id} method={gw.code} size="sm" />
      ))}
    </span>
  );
}

function PaymentPopup({ orderId, total, guestPhone, guestName, viewToken, onClose, onSuccess, isBuyNow }: {
  orderId: string;
  total: number;
  guestPhone?: string;
  guestName?: string;
  viewToken?: string;
  onClose: () => void;
  onSuccess?: () => void;
  isBuyNow?: boolean;
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
      const api = process.env.NEXT_PUBLIC_API_URL || '/api';
      const res = await fetch(`${api}/payments/bkash/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          invoiceNo: `INV-${orderId.slice(0, 8)}`,
          ...(viewToken ? { token: viewToken } : {}),
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
      toast.error(selectedGw?.code === 'bank' ? 'Please enter your transaction / reference ID.' : 'Please enter your transaction ID (TrxID).');
      return;
    }
    setSubmittingPayment(true);
    try {
      await submitPayment(orderId, {
        gatewayCode: selectedGw.code,
        amount: total,
        transactionId: trxId.trim(),
        notes: senderPhone ? `Sent from: ${senderPhone}` : undefined,
        ...(viewToken ? { token: viewToken } : {}),
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
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="payment-pop-in bg-white rounded-2xl p-8 max-w-sm w-full text-center" onClick={e => e.stopPropagation()}>
          <Loader2 className="animate-spin mx-auto mb-4 text-brand-blue" size={32} />
          <p className="text-gray-500">Loading payment options...</p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="payment-pop-in bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden p-8 text-center" onClick={e => e.stopPropagation()}>
          <CheckCircle size={48} className="mx-auto mb-4 text-green-500" />
          <h3 className="text-lg font-bold text-gray-800 mb-2">Payment Submitted!</h3>
          <p className="text-sm text-gray-500 mb-6">Your payment info has been received. We will verify it shortly.</p>
          <button onClick={() => router.push(`/checkout/thank-you?orderId=${orderId}&t=${viewToken || ''}&pending=true${isBuyNow ? '&mode=buynow' : ''}`)}
            className="w-full bg-brand-blue text-white font-bold py-3 rounded-lg hover:bg-brand-blue/90 transition-colors">
            View Order Status
          </button>
        </div>
      </div>
    );
  }

  if (selectedGw) {
    const gwName = selectedGw.name || selectedGw.code;
    const isBank = selectedGw.code === 'bank';
    const modeLabel = isBank ? 'Bank Transfer' : selectedGw.mode === 'agent' ? 'Agent' : selectedGw.mode === 'merchant' ? 'Merchant' : 'Personal';
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="payment-pop-in bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
          <div className="p-6 border-b border-gray-100">
            <div className="flex items-center gap-3">
              <button onClick={() => setSelectedGw(null)} className="text-gray-400 hover:text-gray-600 p-1">
                <ArrowLeft size={20} />
              </button>
              <div className="flex items-center gap-3">
                <span className="flex h-11 w-12 items-center justify-center rounded-lg border border-gray-100 bg-gray-50/60 px-1.5">
                  {selectedGw.logoUrl ? (
                    <img src={selectedGw.logoUrl} alt={gwName} className="max-h-9 w-auto max-w-full object-contain" />
                  ) : (
                    <PaymentLogo method={selectedGw.code} size="md" />
                  )}
                </span>
                <div>
                  <h3 className="text-lg font-bold text-gray-800">{gwName}</h3>
                  <p className="text-xs text-gray-400">{modeLabel} Account</p>
                </div>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-5">
            {isBank ? (
              <div className="space-y-2">
                <p className="text-sm font-bold text-gray-800 flex items-center gap-2">
                  <ExternalLink size={16} className="text-brand-blue" />
                  Transfer to This Bank Account
                </p>
                <BankAccountInstructions accounts={selectedGw.bankAccounts || []} />
                <p className="text-xs text-gray-500 text-center">
                  Amount: <span className="font-bold text-gray-800">BDT {total.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
                </p>
              </div>
            ) : (
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
            )}

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">{isBank ? 'Your Bank Account Number (Sent From)' : 'Your Phone Number (Sent From)'}</label>
                <input type={isBank ? 'text' : 'tel'} value={senderPhone} onChange={e => setSenderPhone(e.target.value)}
                  placeholder={isBank ? 'Your bank account number' : '01XXXXXXXXX'}
                  className="w-full border border-gray-200 rounded-lg px-4 py-3 text-[14px] outline-none focus:border-brand-blue bg-[#fcfcfc]" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">{isBank ? 'Transaction / Reference ID' : 'Transaction ID (TrxID)'}</label>
                <input type="text" value={trxId} onChange={e => setTrxId(e.target.value)}
                  placeholder="e.g. TrxID8A7B3C"
                  className="w-full border border-gray-200 rounded-lg px-4 py-3 text-[14px] outline-none focus:border-brand-blue bg-[#fcfcfc]" />
              </div>
            </div>

            <button onClick={handleSubmitPayment} disabled={submittingPayment}
              className={`w-full text-white font-bold py-3.5 rounded-lg text-[15px] transition-all active:scale-[0.98] ${submittingPayment ? 'bg-gray-400 cursor-not-allowed' : 'bg-brand-blue hover:bg-brand-blue/90 shadow-lg shadow-brand-blue/20'}`}>
              {submittingPayment ? <Loader2 className="animate-spin mx-auto" size={20} /> : isBank ? 'I Have Transferred the Money' : 'I Have Sent the Money'}
            </button>

            <p className="text-[11px] text-gray-400 text-center leading-relaxed">
              {isBank ? 'After transferring the money, enter your transaction / reference ID above and click submit. Our team will verify your payment within 24 hours.' : 'After sending the money, enter your TrxID above and click submit. Our team will verify your payment within 24 hours.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="payment-pop-in bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-gray-100">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-gray-800">Complete Payment</h3>
            <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 p-1">
              <X size={20} />
            </button>
          </div>
          <p className="text-sm text-gray-500 mt-1">Pay {(total).toLocaleString('en-US', {minimumFractionDigits: 2})} BDT</p>
        </div>
        <div className="p-6">
          {gateways.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">No online payment gateways available. Your order has been saved as pending.</p>
          )}
          <div className={`grid gap-2.5 ${gateways.length <= 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {gateways.map(gw => {
              const gwName = gw.name || gw.code;
              return (
                <button
                  key={gw.id}
                  onClick={() => handleSelectGateway(gw)}
                  className="flex flex-col items-center justify-center gap-1.5 rounded-xl border border-gray-200 bg-white px-2 py-3.5 transition-all hover:border-brand-blue hover:bg-brand-blue/[0.03] hover:shadow-sm active:scale-[0.97]"
                >
                  <span className="flex h-10 items-center justify-center">
                    {gw.logoUrl ? (
                      <img src={gw.logoUrl} alt={gwName} className="max-h-10 w-auto max-w-[76px] object-contain" />
                    ) : (
                      <PaymentLogo method={gw.code} size="md" />
                    )}
                  </span>
                  <span className="w-full truncate text-center text-[11px] font-semibold leading-tight text-gray-700">{gwName}</span>
                </button>
              );
            })}
          </div>
          <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-[11px] text-gray-400">
            <ShieldCheck size={13} className="text-gray-300" />
            Your order is saved — you can also pay later from the order page.
          </p>
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
  const { items, cartTotal, clearCart, updateQuantity, removeFromCart, buyNowItem, updateBuyNowQuantity, removeBuyNow, clearBuyNow } = useCart();

  // Buy Now single-item mode: when a Buy Now item is pending, the checkout
  // bills ONLY that one item (exactly the quantity the shopper chose with
  // +/- here) — the shared cart is neither read nor modified.
  const isBuyNow = !!buyNowItem;
  const coItems = isBuyNow && buyNowItem ? [buyNowItem] : items;
  const coTotal = isBuyNow && buyNowItem ? cartLineTotal(buyNowItem) : cartTotal;
  // Coupon state lives above the discount hook: the applied code must
  // flow into the evaluation, or a non-combining rule would keep showing
  // after a coupon is applied while order creation suppresses it.
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<any>(null);
  const [couponError, setCouponError] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  // D19: automatic campaign discounts (display only — the backend
  // recomputes them at order creation, so this can never overcharge).
  const { autoDiscount, byDiscount } = useAutoDiscounts(
    coItems,
    appliedCoupon?.valid ? appliedCoupon.coupon.code : undefined,
  );
  const coUpdateQuantity = (key: string, qty: number) => {
    if (isBuyNow) updateBuyNowQuantity(qty);
    else updateQuantity(key, qty);
  };
  const coRemoveItem = (key: string) => {
    if (isBuyNow) removeBuyNow();
    else removeFromCart(key);
  };
  const coClear = () => {
    if (isBuyNow) clearBuyNow();
    else clearCart();
  };
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
  const [guestEmail, setGuestEmail] = useState('');
  const [paymentOptionType, setPaymentOptionType] = useState<'FULL_PAYMENT' | 'PARTIAL_PAYMENT' | 'CASH_ON_DELIVERY'>('CASH_ON_DELIVERY');
  const [partialAmount, setPartialAmount] = useState('');
  const [paymentPopup, setPaymentPopup] = useState<{ orderId: string; total: number; viewToken?: string } | null>(null);
  // True from the moment a successful checkout starts clearing the cart
  // until the thank-you navigation lands. While true, the empty-cart guard
  // below must NOT paint: without this, the cleared cart re-renders into
  // the empty-cart page for a beat before the new route arrives (the
  // post-deploy flash customers saw after paying). The page unmounts on
  // navigation, so the flag is never cleared.
  const [isRedirectingToThankYou, setIsRedirectingToThankYou] = useState(false);
  const [blockedPhoneOpen, setBlockedPhoneOpen] = useState(false);
  const phoneCheckTimer = useRef<any>(null);
  const paymentSuccessCallback = useRef<(() => void) | null>(null);
  const [selectedShippingOptionId, setSelectedShippingOptionId] = useState('')
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
    setGuestEmail(readStorage('checkout_guestEmail', ''));
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

  const { charge: deliveryCharge, noDeliveryError } = resolveDeliveryCharge({
    shippingMode: config.shippingMode,
    shippingOptions: config.shippingOptions,
    selectedShippingOptionId,
    district,
    shippingZones: config.shippingZones,
    districtCharges: config.districtCharges,
    defaultCharge: config.delivery.charge,
    freeDeliveryMin: config.delivery.freeDeliveryMin,
    subtotal: coTotal,
  });
  // D19: coupon percentages/flats are computed on the post-automatic
  // subtotal, matching the backend stacking order (automatic first, then
  // coupon). With no automatic discount this is identical to before.
  const couponBase = Math.max(0, coTotal - autoDiscount);
  const discountAmount = appliedCoupon?.valid && appliedCoupon.coupon
    ? (appliedCoupon.coupon.type === 'percentage'
      ? (couponBase * Number(appliedCoupon.coupon.value)) / 100
      : Math.min(Number(appliedCoupon.coupon.value), couponBase))
    : 0;
  const totalWithDelivery = coTotal + deliveryCharge - autoDiscount - discountAmount;

  useEffect(() => {
    getDistricts().then(setDistricts).catch(() => {});
  }, []);

  useEffect(() => {
    if (config.shippingMode === 'options' && config.shippingOptions?.length > 0 && !selectedShippingOptionId) {
      const highest = [...config.shippingOptions].sort((a, b) => Number(b.amount) - Number(a.amount))[0];
      setSelectedShippingOptionId(highest.id);
    }
  }, [config.shippingMode, config.shippingOptions, selectedShippingOptionId]);

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
  const canSubmit = coItems.length > 0 && !submitting && (user || (guestName.length > 0 && phoneOk)) && !noDeliveryError && Object.keys(fieldErrors).length === 0;

  useEffect(() => { localStorage.setItem('checkout_guestName', guestName); }, [guestName]);
  useEffect(() => { localStorage.setItem('checkout_guestPhone', guestPhone); }, [guestPhone]);
  useEffect(() => { localStorage.setItem('checkout_guestEmail', guestEmail); }, [guestEmail]);
  useEffect(() => { localStorage.setItem('checkout_district', district); }, [district]);
  useEffect(() => { localStorage.setItem('checkout_thana', thana); }, [thana]);
  useEffect(() => { localStorage.setItem('checkout_address', addressLine); }, [addressLine]);
  useEffect(() => { localStorage.setItem('checkout_notes', customerNotes); }, [customerNotes]);
  useEffect(() => { localStorage.setItem('checkout_paymentOptionType', paymentOptionType); }, [paymentOptionType]);

  useEffect(() => {
    if (!hasCodGateway) {
      setPaymentOptionType((current) => {
        if (current !== 'CASH_ON_DELIVERY') return current;
        if (hasFullPayment) return 'FULL_PAYMENT';
        if (hasPartialPayment) return 'PARTIAL_PAYMENT';
        return current; // no-op: same reference, React bails out
      });
    }
  }, [hasCodGateway, hasFullPayment, hasPartialPayment]);

  /**
   * Material cart signature (spec §8): a stable fingerprint of the logical
   * checkout contents — the content_ids set/order, per-item quantities, and the
   * effective subtotal. React re-renders produce identical signatures and must NOT
   * re-fire InitiateCheckout; a material change (add/remove/qty/value shift)
   * produces a new signature and MUST re-fire with a fresh event_id so the
   * payload never goes stale (D1 fix).
   */
  const cartSignature = React.useMemo(() => computeCartSignature(coItems), [coItems]);

  /**
   * Per-attempt event id (spec §8 / D1 correction). The explicit override path
   * of `trackEvent` is used so a material cart mutation produces a genuinely
   * new event_id even within the same 5-second bucket. The id embeds:
   *  - cartSignature: content_ids + quantities + value (material dimensions)
   *  - ctxId hash: journey scope (unchanged across attempts)
   *  - 5s bucket: temporal dedup for rapid refresh of the SAME signature
   * Rapid refresh of an unchanged cart → identical signature + same bucket →
   * same event_id (dedup preserved). Material change → new signature → new id.
   */
  const cartAttemptId = React.useMemo(() => {
    const ctxId = getOrCreateCtxId();
    const bucket = Math.floor(Date.now() / 5000);
    return `initiate_checkout_${cartSignature}_${ctxId.slice(-8)}_${bucket}`;
  }, [cartSignature]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const lastSignatureRef = React.useRef<string>('');

  useEffect(() => {
    if (coItems.length > 0 && cartSignature !== lastSignatureRef.current) {
      const value = coItems.reduce((s, i) => s + (i.price || 0) * (i.quantity || 1), 0);
      const rawPhone = user?.phoneNumber || '';
      const normalizedPhone = rawPhone ? (normalizePhone(rawPhone) ?? '') : '';
      trackEvent('InitiateCheckout', {
        value,
        currency: config.currency.code,
        content_type: 'product',
        content_ids: coItems.map(i => i.catalogId || i.id),
        num_items: coItems.reduce((s, i) => s + i.quantity, 0),
        contents: coItems.map(i => ({ id: i.catalogId || i.id, quantity: i.quantity, item_price: i.price })),
        content_name: coItems[0]?.name,
        content_category: coItems[0]?.category,
      }, {
        phone: normalizedPhone || undefined,
        name: [user?.firstName, user?.lastName].filter(Boolean).join(' ') || undefined,
        // District the shopper selected — legitimate city-level signal the
        // form genuinely holds (no division/postcode fields exist to send).
        city: district || undefined,
        country: 'BD',
        email: user?.email || (guestEmail && !isSyntheticEmail(guestEmail) ? guestEmail.trim() : undefined),
      }, cartAttemptId);
      lastSignatureRef.current = cartSignature;
    }
  }, [coItems, cartSignature, cartAttemptId, config.currency.code, user, guestEmail]);

  const getLeadData = useCallback(() => {
    const rawPhone = guestPhone || user?.phoneNumber || '';
    const phone = normalizePhone(rawPhone);
    const name = guestName || [user?.firstName, user?.lastName].filter(Boolean).join(' ') || '';
    if (!phone || !name || wasSubmitted.current) return null;
    const landing = getLandingAttribution();
    return {
      phone, name,
      email: (guestEmail && !isSyntheticEmail(guestEmail)) ? guestEmail.trim() : undefined,
      address: { district, thana, addressLine },
      items: coItems.map(i => ({
        id: i.id, name: i.name, price: i.price, quantity: i.quantity,
        image: i.image, isCombo: i.isCombo, comboId: i.comboId,
      })),
      paymentMethod: paymentOptionType,
      fingerprint: simpleFingerprint(phone, coItems),
      fbp: getCookie('_fbp') || undefined,
      fbc: getCookie('_fbc') || undefined,
      // Landing signals ride with the abandoned checkout too: if staff later
      // convert this lead into an order, the order keeps its real source instead
      // of arriving blind. The journey session is a second (server-side) chance.
      attribution: landing
        ? {
            utmSource: landing.utmSource,
            utmMedium: landing.utmMedium,
            utmCampaign: landing.utmCampaign,
            utmContent: landing.utmContent,
            utmTerm: landing.utmTerm,
            referrer: landing.referrer,
            fbclid: landing.fbclid,
            gclid: landing.gclid,
            wbraid: landing.wbraid,
            gbraid: landing.gbraid,
            msclkid: landing.msclkid,
            ttclid: landing.ttclid,
            twclid: landing.twclid,
            igshid: landing.igshid,
            clickId: landing.clickId,
          }
        : undefined,
      device: collectDeviceContext(),
    };
  }, [guestPhone, guestName, guestEmail, coItems, district, thana, addressLine, paymentOptionType, user]);

  const leadDataRef = useRef(getLeadData());
  leadDataRef.current = getLeadData();

  useEffect(() => {
    const beaconUrl = `${process.env.NEXT_PUBLIC_API_URL || '/api'}/checkout-leads`;
    const sendLead = () => {
      const data = leadDataRef.current;
      if (!data || wasSubmitted.current) return;
      navigator.sendBeacon(beaconUrl, new Blob([JSON.stringify(data)], { type: 'application/json' }));
    };
    window.addEventListener('beforeunload', sendLead);
    return () => {
      window.removeEventListener('beforeunload', sendLead);
      sendLead();
    };
  }, []);

  const buildOrderPayload = () => {
    const orderItems = coItems.map((item) => {
      if (item.isCombo) {
        return { comboId: item.comboId, comboSelection: item.comboSelections, quantity: item.quantity, price: item.price };
      }
      return {
        productId: item.id,
        variantId: item.variantId,
        quantity: item.quantity,
        price: item.price,
        // Keys/text only — the backend re-resolves all customization
        // prices against the live product definition.
        ...(item.customization?.selection ? { customization: item.customization.selection } : {}),
      };
    });

    // Website attribution (spec §20-21): the storefront only COLLECTS the raw
    // landing signals (utm / click-id / referrer, captured once at landing and
    // persisted for the session); the backend resolves platform/type through a
    // single canonical resolver. An explicit source never gets overwritten here.
    const landingAttribution = getLandingAttribution();
    const attributionPayload = landingAttribution
      ? {
          utmSource: landingAttribution.utmSource,
          utmMedium: landingAttribution.utmMedium,
          utmCampaign: landingAttribution.utmCampaign,
          utmContent: landingAttribution.utmContent,
          utmTerm: landingAttribution.utmTerm,
          referrer: landingAttribution.referrer,
          // Every platform click id the resolver knows — dropping one drops the
          // platform for that order (Google Ads used to arrive as DIRECT).
          fbclid: landingAttribution.fbclid,
          gclid: landingAttribution.gclid,
          wbraid: landingAttribution.wbraid,
          gbraid: landingAttribution.gbraid,
          msclkid: landingAttribution.msclkid,
          ttclid: landingAttribution.ttclid,
          twclid: landingAttribution.twclid,
          igshid: landingAttribution.igshid,
          clickId: landingAttribution.clickId,
        }
      : undefined;

    const payload: any = {
      customerId: user?.id,
      trackingSessionId: getOrCreateCtxId(),
      items: orderItems,
      shippingCharge: deliveryCharge,
      shippingAddress: { district, thana, addressLine },
      guestName: user ? undefined : guestName,
      guestPhone: user ? undefined : (normalizePhone(guestPhone) || undefined),
      guestEmail: user
        ? undefined
        : guestEmail && !isSyntheticEmail(guestEmail)
          ? guestEmail.trim()
          : undefined,
      paymentOptionType,
      // Customer order note (90-char textarea below): must reach the backend
      // `customerNotes` field or the note is silently lost (admin shows empty).
      customerNotes: customerNotes.trim() || undefined,
      gatewayCode: paymentOptionType === 'CASH_ON_DELIVERY' ? 'cash' : undefined,
      district: district || undefined,
      thana: thana || undefined,
      salesChannel: 'WEBSITE',
      ...(attributionPayload ? { attribution: attributionPayload } : {}),
      // First-party device/technical context (analytics) — frozen onto the order
      // alongside the attribution signals so they stay readable from the order.
      device: collectDeviceContext(),
      // NOTE: sourceEntity is deliberately NOT set here. It means "the entity
      // that brought this order" (showroom/team/person) and is consumed as a
      // campaign key by the attribution resolver — sending the store name made
      // every website order resolve its campaign from the store name instead of
      // utm_campaign. Website identity is already in salesChannel. The platform
      // badge is derived from attribution instead.
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
    const districtReq = checkoutCfg?.districtRequired === true;
    if (districtReq && !district.trim()) {
      errors.district = 'Please select a district';
    }
    const thanaReq = checkoutCfg?.thanaRequired === true;
    if (thanaReq && district.trim() && !thana.trim()) {
      errors.thana = 'Please select a thana/upazila';
    }
    const emailEnabled = checkoutCfg?.emailEnabled !== false;
    const emailRequired = checkoutCfg?.emailRequired === true;
    if (!user && emailEnabled) {
      const email = (guestEmail || '').trim();
      if (emailRequired && !email) {
        errors.guestEmail = 'Please enter your email address';
      } else if (
        email &&
        (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
          isSyntheticEmail(email))
      ) {
        errors.guestEmail = 'Please enter a valid email address';
      }
    }
    if (!addressLine.trim() || addressLine.trim().length < 5) {
      errors.addressLine = 'Address must be at least 5 characters';
    }
    if (config.shippingMode === 'options' && config.shippingOptions?.length > 0 && !selectedShippingOptionId) {
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
      const visualOrder = ['guestPhone', 'guestName', 'guestEmail', 'district', 'thana', 'addressLine', 'shippingOption'];
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
    if (coItems.length === 0) {
      toast.error(isBuyNow ? 'No item to checkout. Please start a Buy Now again.' : 'Your cart is empty. Please add items to your cart.');
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
      if (checkoutCfg?.emailEnabled !== false && checkoutCfg?.emailRequired === true && !(guestEmail || '').trim()) {
        toast.error('Please enter your email address.');
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
      // A completed checkout consumes the captured landing attribution so a
      // later, separate order in the same session is not mis-attributed.
      clearLandingAttribution();

      if (isOnlinePayment) {
        // Manual-payment submit lands on thank-you from HERE, not from the
        // modal's submitted panel: clearing the cart re-renders the checkout
        // page into its empty-cart state, which unmounts the modal (and its
        // "View Order Status" button) before the user can ever see it — the
        // customer was left staring at an empty cart with a saved order and
        // a saved payment. Navigate in the same tick, mirroring the Pay
        // Later / modal-close path. This callback is invoked only by the
        // manual "I Have Sent the Money" submit (see PaymentPopup
        // onSuccess); PGW initiation redirects externally and never calls it.
        paymentSuccessCallback.current = () => {
          // Flag BEFORE clearing (see the state comment): the cleared cart
          // would otherwise paint the empty-cart guard before navigation.
          setIsRedirectingToThankYou(true);
          coClear();
          try {
            ['checkout_guestName','checkout_guestPhone','checkout_guestEmail','checkout_district','checkout_thana',
             'checkout_address','checkout_notes','checkout_paymentOptionType'].forEach(k => localStorage.removeItem(k));
          } catch {}
          router.push(`/checkout/thank-you?orderId=${order.id}&t=${order.viewToken || ''}&pending=true${isBuyNow ? '&mode=buynow' : ''}`);
        };
        // The modal's pay-now amount: for PARTIAL it is the deposit the
        // customer entered, not the full total — the modal header, the Send
        // Money form amount, AND the submitted payment amount all come from
        // this value, so sending the full total here recorded a ৳640 payment
        // for a ৳100 deposit.
        setPaymentPopup({ orderId: order.id, total: (paymentOptionType === 'PARTIAL_PAYMENT' && partialAmount ? parseFloat(partialAmount) : totalWithDelivery), viewToken: order.viewToken });
      } else {
        // Same flag-before-clear as the manual path (covers COD + Buy Now).
        setIsRedirectingToThankYou(true);
        coClear();
        try {
          ['checkout_guestName','checkout_guestPhone','checkout_guestEmail','checkout_district','checkout_thana',
           'checkout_address','checkout_notes','checkout_paymentOptionType'].forEach(k => localStorage.removeItem(k));
        } catch {}
        router.push(`/checkout/thank-you?orderId=${order.id}&t=${order.viewToken || ''}${isBuyNow ? '&mode=buynow' : ''}`);
      }
    } catch (err: any) {
      const message = err?.response?.data?.message || 'Failed to place order. Please try again.';
      if (message.includes('phone number has been blocked')) {
        setBlockedPhoneOpen(true);
      } else {
        toast.error(message);
      }
      if (message.includes('no longer exist')) {
        coClear();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handlePayNow = handlePlaceOrder;

  const handlePhoneBlur = () => {
    if (user) return;
    const normalized = normalizePhone(guestPhone);
    if (!normalized) return;
    if (phoneCheckTimer.current) clearTimeout(phoneCheckTimer.current);
    phoneCheckTimer.current = setTimeout(async () => {
      const blocked = await checkPhoneBlocked(normalized);
      if (blocked) setBlockedPhoneOpen(true);
    }, 400);
  };

  const s = config.currency.symbol || '৳';

  const renderCartItems = () => {
    if (coItems.length === 0) {
      return <p className="text-gray-400 text-xs py-2">Your cart is empty.</p>;
    }

    const maxVisible = 2;
    const hasMore = coItems.length > maxVisible;
    const visibleItems = isItemsExpanded ? coItems : coItems.slice(0, maxVisible);

    return (
      <div className="divide-y divide-gray-100">
        {visibleItems.map(item => (
          <CheckoutItemRow
            key={getItemKey(item)}
            item={item}
            removeFromCart={coRemoveItem}
            updateQuantity={coUpdateQuantity}
            currencySymbol={s}
          />
        ))}
        {hasMore && (
          <button
            onClick={() => setIsItemsExpanded(!isItemsExpanded)}
            className="w-full text-center py-2.5 text-xs text-brand-blue font-bold hover:underline flex items-center justify-center gap-1 mt-1 cursor-pointer"
          >
            {isItemsExpanded ? 'Show less' : `+ Show ${coItems.length - maxVisible} more item${coItems.length - maxVisible > 1 ? 's' : ''}`}
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
          <span className="font-bold text-gray-800">{s}{coTotal.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
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
        {autoDiscount > 0 && byDiscount.map((d) => (
          <div key={d.discountId} className="flex justify-between items-center text-green-600">
            <span>Automatic discount ({d.discountTitle})</span>
            <span className="font-bold text-green-700">-{s}{d.amount.toFixed(2)}</span>
          </div>
        ))}
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
                <GatewayChips gateways={gateways} />
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
                <GatewayChips gateways={gateways} />
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

  if (isRedirectingToThankYou) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 text-brand-blue animate-spin mx-auto" />
          <p className="text-xs text-gray-500 font-medium">Payment successful — taking you to your order…</p>
        </div>
      </div>
    );
  }

  if (coItems.length === 0) {
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
              <img src={config.branding.storeLogo} alt={config.store?.name || 'Store'} className="h-6 w-auto object-contain" />
            ) : (
              <span className="text-base font-black tracking-tight text-gray-805">
                {config.store?.name || 'Store'}
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
                  <img src={config.branding.storeLogo} alt={config.store?.name || 'Store'} className="h-8 w-auto object-contain" />
                ) : (
                  <span className="text-xl font-black tracking-tight text-gray-800">
                    {config.store?.name || 'Store'}
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
                      onChange={e => { setGuestName(e.target.value); clearFieldError('guestName'); }}
                      placeholder="আপনার পূর্ণ নাম লিখুন *"
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
                        onChange={e => { setGuestPhone(e.target.value); clearFieldError('guestPhone'); }}
                        onBlur={handlePhoneBlur}
                        placeholder="মোবাইল নম্বর দিন *"
                        className="w-full px-3.5 py-2 text-xs outline-none bg-transparent text-gray-800 font-medium placeholder-gray-400"
                      />
                    </div>
                    {fieldErrors.guestPhone && <p className="text-red-500 text-[10px] mt-1 font-semibold">{fieldErrors.guestPhone}</p>}
                    {showPhoneError && <p className="text-red-500 text-[10px] mt-1 font-semibold">Please enter a valid Bangladeshi phone number</p>}
                  </div>

                  {/* Email Input — shown only for guests when email collection is enabled */}
                  {checkoutCfg?.emailEnabled !== false && (
                    <div className="md:col-span-2 order-3">
                      <input
                        id="checkout-guestEmail"
                        type="email"
                        autoComplete="email"
                        inputMode="email"
                        value={guestEmail}
                        onChange={e => { setGuestEmail(e.target.value); clearFieldError('guestEmail'); }}
                        placeholder={checkoutCfg?.emailRequired ? 'ইমেইল ঠিকানা লিখুন *' : 'ইমেইল ঠিকানা লিখুন (ঐচ্ছিক)'}
                        className={`w-full h-11 border rounded-md px-3.5 text-xs outline-none focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/10 transition-all bg-white ${fieldErrors.guestEmail ? 'border-red-400' : 'border-gray-250'}`}
                      />
                      {fieldErrors.guestEmail && <p className="text-red-500 text-[10px] mt-1 font-semibold">{fieldErrors.guestEmail}</p>}
                    </div>
                  )}
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
                      placeholder={checkoutCfg?.districtRequired ? 'জেলা সিলেক্ট করুন *' : 'জেলা সিলেক্ট করুন (ঐচ্ছিক)'}
                      options={districts}
                      value={district}
                      onChange={(val) => { setDistrict(val); setThana(''); clearFieldError('district'); }}
                      error={!!fieldErrors.district}
                    />
                    {fieldErrors.district && <p className="text-red-500 text-[10px] mt-0.5 font-semibold">{fieldErrors.district}</p>}
                  </div>
                )}

                {checkoutCfg?.thanaEnabled !== false && district && (
                  <div className="space-y-1">
                    <SearchableSelect
                      id="checkout-thana"
                      placeholder={checkoutCfg?.thanaRequired ? 'থানা/উপজেলা সিলেক্ট করুন *' : 'থানা/উপজেলা সিলেক্ট করুন (ঐচ্ছিক)'}
                      options={thanas}
                      value={thana}
                      onChange={(val) => { setThana(val); clearFieldError('thana'); }}
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
                    placeholder="আপনার সম্পূর্ণ ঠিকানা লিখুন (যেমন: গ্রাম, ইউনিয়ন/ওয়ার্ড, সড়ক নং, বাসা/রুম নং) *"
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

              {config.shippingMode !== 'options' && deliveryCharge > 0 && !noDeliveryError && (
                <p className="text-[10px] text-gray-400">
                  Delivery cost{district ? ` for ${district}` : ''}: <span className="font-bold text-gray-600">{s}{deliveryCharge}</span>
                  {coTotal >= config.delivery.freeDeliveryMin ? (
                    <span className="text-green-600 ml-2 font-bold">(Free)</span>
                  ) : config.delivery.freeDeliveryMin > 0 && (
                    <span className="text-gray-400 ml-1">(Free above {s}{config.delivery.freeDeliveryMin})</span>
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
                  <Plus size={14} /> ডেলিভারি নির্দেশনা বা অর্ডার নোট যোগ করুন (ঐচ্ছিক)
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
                    placeholder="অর্ডার সম্পর্কে কোনো বিশেষ ডেলিভারি নির্দেশনা বা নোট থাকলে লিখুন (ঐচ্ছিক)..."
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
                  By placing order, you agree to {config.store?.name || 'Store'}'s{" "}
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
          isBuyNow={isBuyNow}
          onSuccess={() => paymentSuccessCallback.current?.()}
          onClose={() => {
            paymentSuccessCallback.current = null;
            setPaymentPopup(null);
            router.push(`/checkout/thank-you?orderId=${paymentPopup.orderId}&t=${paymentPopup.viewToken}&pending=true${isBuyNow ? '&mode=buynow' : ''}`);
          }}
        />
      )}

      <BlockedPhoneDialog
        open={blockedPhoneOpen}
        onClose={() => setBlockedPhoneOpen(false)}
        message={config.order?.blockedPhoneMessage || 'This phone number has been blocked. Please contact support.'}
        callNumber={config.order?.callNumber || config.store?.phone}
        whatsapp={config.order?.whatsapp}
      />
    </div>
  );
}
