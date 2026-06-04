"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, ChevronRight, Package, Home, Truck, ShoppingBag, AlertTriangle, Clock, XCircle, Ban } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useStorefrontConfig } from '@/context/StorefrontConfigContext';
import { trackEvent } from '@/lib/tracking';
import { ResumePaymentButton } from '@/components/ThankYou/ResumePaymentButton';
import { PaymentProofUpload } from '@/components/ThankYou/PaymentProofUpload';
import { CancelOrderButton } from '@/components/ThankYou/CancelOrderButton';
import { motion } from 'motion/react';

export type PaymentStatus = 'paid' | 'pending' | 'partial' | 'failed' | 'cancelled';

export interface ThankYouContentProps {
  order: any;
  orderId: string | null;
  token: string | null;
  paymentStatus: PaymentStatus;
  errorMessage?: string;
}

const nn = (v: number | string | undefined | null) => {
  if (v === undefined || v === null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

const fmt = (v: number | string | undefined | null) => nn(v).toFixed(2);

export default function ThankYouContent({
  order,
  orderId,
  token,
  paymentStatus,
  errorMessage,
}: ThankYouContentProps) {
  const router = useRouter();
  const { clearCart } = useCart();
  const { config } = useStorefrontConfig();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!order) return;
    clearCart();

    if (typeof window === 'undefined') return;
    const sessionKey = `tracked_order_${order.id}`;
    if (sessionStorage.getItem(sessionKey)) return;

    const itemsList = (order.items as any[]) || [];
    const totalValue = Number(order.total || order.subtotal || 0);
    trackEvent(
      'Purchase',
      {
        value: totalValue,
        currency: config.currency.code,
        content_ids: itemsList.map((i: any) => i.productId || i.comboId || ''),
        num_items: itemsList.reduce((s: number, i: any) => s + (i.quantity || 0), 0),
        order_id: order.id,
        contents: itemsList.map((i: any) => ({
          id: i.productId || i.comboId || '',
          quantity: i.quantity,
          item_price: Number(i.price),
        })),
      },
      {
        phone: order.shippingAddress?.phone || order.guestPhone || '',
        name: order.shippingAddress?.name || order.guestName || '',
        city: order.shippingAddress?.city || '',
        country: 'BD',
      },
    );
    sessionStorage.setItem(sessionKey, 'true');
  }, [order, clearCart, config.currency.code]);

  if (!orderId || (!order && !errorMessage)) {
    return (
      <div className="bg-[#f2f4f8] min-h-screen flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl shadow-sm p-8 text-center max-w-md w-full"
        >
          <div className="w-16 h-16 bg-amber-100 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <Package size={32} />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">No order found</h2>
          <p className="text-gray-500 mb-6">We could not find an order to confirm.</p>
          <button
            onClick={() => router.push('/')}
            className="w-full bg-brand-blue text-white px-6 py-3 rounded-lg font-bold text-[14px] uppercase tracking-wider hover:bg-brand-blue/90 transition-colors"
          >
            Go Home
          </button>
        </motion.div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="bg-[#f2f4f8] min-h-screen flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl shadow-sm p-8 text-center max-w-md w-full"
        >
          <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <XCircle size={32} />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">Order not found</h2>
          <p className="text-gray-500 mb-6">
            {errorMessage || 'The link may be invalid or expired. Please contact support if you need help.'}
          </p>
          <button
            onClick={() => router.push('/')}
            className="w-full bg-brand-blue text-white px-6 py-3 rounded-lg font-bold text-[14px] uppercase tracking-wider hover:bg-brand-blue/90 transition-colors"
          >
            Go Home
          </button>
        </motion.div>
      </div>
    );
  }

  const shippingAddress = order.shippingAddress || {};
  const hasDeliveryArea = shippingAddress?.district || shippingAddress?.thana;
  const statusName = String(order.status?.name || '');
  const paymentMethod = String(order.paymentMethod || '');
  const paymentMode = String(order.paymentMode || '');
  const isPendingStatus = statusName === 'Pending';
  const isCancellable = paymentStatus === 'pending' && isPendingStatus;
  const verifiedPayments = (order.payments || []).filter((p: any) => p.status === 'verified');
  const totalPaid = verifiedPayments.reduce((s: number, p: any) => s + nn(p.amount), 0);
  const orderTotal = nn(order.total);
  const remaining = Math.max(0, orderTotal - totalPaid);
  const isBkas = paymentMethod === 'bkash' || paymentMethod === 'online';
  const isManual = paymentMethod === 'manual' || paymentMethod === 'send-money' || paymentMethod === 'send_money';
  const isCod = paymentMethod === 'cod' || (!paymentMethod && paymentMode === 'cod');

  const headerBg = paymentStatus === 'paid' ? 'bg-green-100' : paymentStatus === 'cancelled' ? 'bg-red-100' : 'bg-amber-100';
  const headerIconColor =
    paymentStatus === 'paid' ? 'text-green-500' : paymentStatus === 'cancelled' ? 'text-red-500' : 'text-amber-500';
  const HeaderIcon = paymentStatus === 'paid' ? ShieldCheck : paymentStatus === 'cancelled' ? Ban : Clock;

  const headerTitle =
    paymentStatus === 'paid'
      ? 'Order Placed Successfully!'
      : paymentStatus === 'partial'
        ? 'Partially Paid'
        : paymentStatus === 'failed'
          ? 'Payment Failed'
          : paymentStatus === 'cancelled'
            ? 'Order Cancelled'
            : 'Order Placed — Payment Pending';

  const headerMessage =
    paymentStatus === 'paid'
      ? 'Thank you for shopping with us. Your order has been received and is being processed.'
      : paymentStatus === 'partial'
        ? `You have paid ${config.currency.symbol}${fmt(totalPaid)} so far. Please pay the remaining ${config.currency.symbol}${fmt(remaining)} to confirm your order.`
        : paymentStatus === 'failed'
          ? 'Your last payment attempt did not complete. Please try again to confirm your order.'
          : paymentStatus === 'cancelled'
            ? 'This order has been cancelled. You can place a new order anytime.'
            : 'Your order has been saved. Please complete the payment to confirm your order. Our team will contact you shortly if you need assistance.';

  const headerBadgeText =
    paymentStatus === 'paid'
      ? 'Processing'
      : paymentStatus === 'cancelled'
        ? 'Cancelled'
        : paymentStatus === 'partial'
          ? 'Partial'
          : paymentStatus === 'failed'
            ? 'Failed'
            : 'Payment Pending';

  const headerBadgeColor =
    paymentStatus === 'paid' || paymentStatus === 'partial'
      ? 'text-green-600'
      : paymentStatus === 'cancelled' || paymentStatus === 'failed'
        ? 'text-red-500'
        : 'text-amber-500';

  return (
    <div className="bg-[#f2f4f8] min-h-screen pb-32 font-sans">
      <div className="bg-white border-b border-gray-100 py-4 md:py-6">
        <div className="max-w-screen-xl mx-auto px-4">
          <nav className="flex items-center justify-center gap-2 text-[11px] md:text-[13px] text-gray-400 font-medium">
            <button onClick={() => router.push('/')} className="hover:text-brand-blue flex items-center gap-1">
              <Home size={14} /> Home
            </button>
            <ChevronRight size={14} />
            <button onClick={() => router.push('/checkout')} className="hover:text-brand-blue">Checkout</button>
            <ChevronRight size={14} />
            <span className="text-gray-600">
              {paymentStatus === 'paid' ? 'Order Confirmed' : paymentStatus === 'cancelled' ? 'Order Cancelled' : 'Payment Pending'}
            </span>
          </nav>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="bg-white rounded-2xl shadow-sm p-6 md:p-8 text-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 20, delay: 0.2 }}
              className={`w-20 h-20 ${headerBg} rounded-full flex items-center justify-center mx-auto mb-6`}
            >
              <HeaderIcon size={40} className={headerIconColor} />
            </motion.div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">{headerTitle}</h1>
            <p className="text-gray-500 mb-6">{headerMessage}</p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-gray-600 mb-6">
              <div className="bg-gray-50 px-4 py-2 rounded-full border border-gray-100 flex items-center gap-2">
                <span className="font-medium text-gray-400">Order ID:</span>
                <span className="font-bold text-gray-800">{order.displayId || order.id}</span>
              </div>
              <div className="bg-gray-50 px-4 py-2 rounded-full border border-gray-100 flex items-center gap-2">
                <span className="font-medium text-gray-400">Status:</span>
                <span className={`font-bold ${headerBadgeColor}`}>{headerBadgeText}</span>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => router.push('/orders')}
                className="bg-white border-2 border-brand-blue text-brand-blue px-6 py-2.5 rounded-lg font-bold text-[13px] uppercase tracking-wider hover:bg-brand-blue/5 transition-colors"
              >
                View Order
              </button>
              <button
                onClick={() => router.push('/')}
                className="bg-brand-blue text-white px-6 py-2.5 rounded-lg font-bold text-[13px] uppercase tracking-wider hover:bg-brand-blue/90 transition-colors"
              >
                Continue Shopping
              </button>
            </div>
          </motion.div>

          {(paymentStatus === 'pending' || paymentStatus === 'partial' || paymentStatus === 'failed') && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="bg-white rounded-2xl shadow-sm p-6 md:p-8"
            >
              <h2 className="text-lg font-bold text-gray-800 mb-4">
                {paymentStatus === 'failed' ? 'Try Payment Again' : 'Complete Your Payment'}
              </h2>

              {isBkas && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">
                    {paymentStatus === 'partial'
                      ? `Pay the remaining ${config.currency.symbol}${fmt(remaining)} with bKash.`
                      : 'Pay the order total with bKash. You will be redirected to the secure bKash page.'}
                  </p>
                  <ResumePaymentButton
                    orderId={order.id}
                    partialAmount={paymentStatus === 'partial' ? remaining : undefined}
                    label={paymentStatus === 'partial' ? `Pay ${config.currency.symbol}${fmt(remaining)} with bKash` : 'Pay with bKash'}
                  />
                </div>
              )}

              {isManual && (
                <PaymentProofUpload
                  orderId={order.id}
                  amount={paymentStatus === 'partial' ? remaining : orderTotal}
                />
              )}

              {isCod && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-start gap-3">
                  <Truck className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-blue-900">Cash on Delivery</p>
                    <p className="text-blue-800 text-xs mt-1">
                      Pay {config.currency.symbol}
                      {fmt(orderTotal)} in cash when your order is delivered.
                    </p>
                  </div>
                </div>
              )}

              {!isBkas && !isManual && !isCod && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <p className="text-sm text-gray-600">
                    Payment method: <span className="font-medium">{paymentMethod || 'Not specified'}</span>
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Our team will contact you to confirm payment. You can also call us for assistance.
                  </p>
                </div>
              )}
            </motion.div>
          )}

          {isCancellable && orderId && token && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
            >
              <CancelOrderButton orderId={orderId} token={token} />
            </motion.div>
          )}

          {!hasDeliveryArea && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.25 }}
              className="bg-amber-50 border border-amber-200 rounded-2xl p-6"
            >
              <div className="flex gap-3">
                <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-amber-800 text-sm">Delivery Area Not Selected</h3>
                  <p className="text-amber-700 text-[13px] mt-1">
                    You did not select a delivery district/area. Your bill shows the total without delivery charge.
                    Our call center will contact you to confirm your delivery area and add the applicable charge.
                    Please keep your phone handy.
                  </p>
                </div>
              </div>
            </motion.div>
          )}

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="bg-white rounded-2xl shadow-sm p-6 md:p-8"
          >
            <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
              <ShoppingBag size={20} className="text-brand-blue" />
              What happens next?
            </h2>
            <div className="space-y-4">
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center shrink-0 text-sm font-bold">1</div>
                <div>
                  <h3 className="text-[14px] font-bold text-gray-800">Order Confirmation</h3>
                  <p className="text-[13px] text-gray-500">You will receive an order confirmation email and SMS shortly with your order details.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center shrink-0 text-sm font-bold">2</div>
                <div>
                  <h3 className="text-[14px] font-bold text-gray-800">Processing & Shipping</h3>
                  <p className="text-[13px] text-gray-500">Our team is preparing your items. Once shipped, you will receive a tracking code.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="w-8 h-8 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center shrink-0 text-sm font-bold">3</div>
                <div>
                  <h3 className="text-[14px] font-bold text-gray-800">Delivery</h3>
                  <p className="text-[13px] text-gray-500">Your parcel will be delivered to your doorstep. Please keep the exact amount ready if Cash on Delivery.</p>
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        <div className="space-y-6">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="bg-white rounded-2xl shadow-sm p-6"
          >
            <h2 className="text-base font-bold text-gray-800 mb-4 border-b pb-2">Order Summary</h2>

            {order.items && (
              <div className="space-y-3 mb-4 max-h-48 overflow-y-auto pr-1">
                {(order.items as any[]).map((item: any, idx: number) => (
                  <div key={idx} className="flex gap-3 text-sm">
                    <div className="w-10 h-10 bg-gray-50 rounded border flex items-center justify-center shrink-0">
                      {item.product?.images?.[0] ? (
                        <img
                          src={item.product.images[0]}
                          alt=""
                          className="w-full h-full object-cover rounded"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).src = '/placeholder.svg';
                          }}
                        />
                      ) : (
                        <Package size={16} className="text-gray-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[12px] font-medium text-gray-800 truncate">{item.product?.name || item.combo?.name || 'Product'}</p>
                      <p className="text-[11px] text-gray-400">Qty: {item.quantity}</p>
                    </div>
                    <div className="text-[12px] font-bold text-gray-800">
                      {config.currency.symbol}
                      {fmt(nn(item.price) * item.quantity)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t pt-3 space-y-2 text-[12px]">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal</span>
                <span>
                  {config.currency.symbol}
                  {fmt(order.subtotal)}
                </span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Shipping</span>
                <span>
                  {hasDeliveryArea
                    ? `${config.currency.symbol}${fmt(order.shippingCharge)}`
                    : <span className="text-amber-500">To be determined</span>}
                </span>
              </div>
              {nn(order.discount) > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Discount</span>
                  <span>
                    -{config.currency.symbol}
                    {fmt(order.discount)}
                  </span>
                </div>
              )}
              <div className="flex justify-between font-bold text-[14px] text-gray-900 pt-2 border-t mt-2">
                <span>Total</span>
                <span className="text-brand-blue">
                  {config.currency.symbol}
                  {fmt(order.total || order.subtotal)}
                </span>
              </div>
              {paymentStatus === 'partial' && (
                <div className="flex justify-between text-amber-600 text-[12px] pt-1">
                  <span>Remaining</span>
                  <span>
                    {config.currency.symbol}
                    {fmt(remaining)}
                  </span>
                </div>
              )}
            </div>

            {order.payments && (order.payments as any[]).length > 0 && (
              <div className="border-t mt-4 pt-4">
                <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Payment</h3>
                {(order.payments as any[]).map((p: any, i: number) => (
                  <div key={i} className="flex justify-between text-[12px]">
                    <span className="text-gray-500 capitalize">{p.method}</span>
                    <span
                      className={`font-bold ${
                        p.status === 'verified' ? 'text-green-600' : p.status === 'pending' ? 'text-amber-500' : 'text-gray-500'
                      }`}
                    >
                      {p.status === 'verified' ? 'Paid' : p.status === 'pending' ? 'Pending' : p.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="bg-white rounded-2xl shadow-sm p-6"
          >
            <h2 className="text-base font-bold text-gray-800 mb-3 border-b pb-2">Shipping Details</h2>
            <div className="text-[13px] text-gray-600 space-y-1">
              <p className="font-bold text-gray-800">{order.guestName || shippingAddress.name || 'Customer'}</p>
              {shippingAddress.district && (
                <p>
                  District: {shippingAddress.district}
                  {shippingAddress.thana ? `, ${shippingAddress.thana}` : ''}
                </p>
              )}
              {shippingAddress.addressLine && <p>{shippingAddress.addressLine}</p>}
              <p className="pt-1 flex items-center gap-1.5">
                <Truck size={14} className="text-gray-400" /> {order.guestPhone || shippingAddress.phone}
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
