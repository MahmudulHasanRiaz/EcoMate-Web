"use client";

// P5 (JS diet): extracted verbatim from checkout/page.tsx (pure code
// organization — no behaviour, state-shape, or order-of-operations change).
// The popup only renders after an order has been placed and a payment is
// due, so the checkout page loads it with next/dynamic (ssr: false) and it
// no longer ships in the checkout route's initial bundle.

import React, { useState, useEffect } from 'react';
import { Loader2, CheckCircle, ArrowLeft, ExternalLink, X, ShieldCheck } from 'lucide-react';
import { PaymentLogo } from '@/components/PaymentLogo';
import { BankAccountInstructions } from '@/components/BankAccountInstructions';
import { getGateways } from '@/lib/api/delivery-areas';
import { submitPayment } from '@/lib/api/payments';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

export function PaymentPopup({ orderId, total, guestPhone, guestName, viewToken, onClose, onSuccess, isBuyNow }: {
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
