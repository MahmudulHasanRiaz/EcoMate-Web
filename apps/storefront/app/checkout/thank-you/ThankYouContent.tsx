"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShieldCheck, ChevronRight, Package, Home, Truck, ShoppingBag, AlertTriangle, Clock } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { useStorefrontConfig } from '@/context/StorefrontConfigContext';
import { getOrder } from '@/lib/api/orders';
import type { Order } from '@/lib/types';
import { motion } from "motion/react";
import { trackEvent } from '@/lib/tracking';

export default function ThankYouContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { clearCart } = useCart();
  const { config } = useStorefrontConfig();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  const orderId = searchParams.get('orderId');
  const isPending = searchParams.get('pending') === 'true';

  const nn = (v: number | string | undefined | null) => {
    if (v === undefined || v === null) return 0;
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  };

  const fmt = (v: number | string | undefined | null) => nn(v).toFixed(2);

  const shippingAddress = order ? (order as any).shippingAddress || {} : {};
  const hasDeliveryArea = shippingAddress?.district || shippingAddress?.thana;

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    getOrder(orderId)
      .then((res) => {
        setOrder(res);
        clearCart();

        const sessionKey = `tracked_order_${res.id}`;
        if (typeof window !== 'undefined' && !sessionStorage.getItem(sessionKey)) {
          const itemsList = res.items || [];
          const totalValue = res.total || res.subtotal || 0;

          trackEvent('Purchase', {
            value: Number(totalValue),
            currency: config.currency.code,
            content_ids: itemsList.map((i: any) => i.productId || i.comboId || ''),
            num_items: itemsList.reduce((s: number, i: any) => s + (i.quantity || 0), 0),
            order_id: res.id,
            contents: itemsList.map((i: any) => ({
              id: i.productId || i.comboId || '',
              quantity: i.quantity,
              item_price: Number(i.price)
            }))
          }, {
            phone: res.shippingAddress?.phone || res.guestPhone || '',
            name: res.shippingAddress?.name || res.guestName || '',
            city: res.shippingAddress?.city || '',
            country: 'BD'
          });

          sessionStorage.setItem(sessionKey, 'true');
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orderId, clearCart, config.currency.code]);

  if (!orderId) {
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
          <button onClick={() => router.push('/')} className="w-full bg-brand-blue text-white px-6 py-3 rounded-lg font-bold text-[14px] uppercase tracking-wider hover:bg-brand-blue/90 transition-colors">Go Home</button>
        </motion.div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="bg-[#f2f4f8] min-h-screen flex items-center justify-center p-4">
        <div className="animate-pulse space-y-4 w-full max-w-md">
          <div className="bg-gray-200 h-8 w-3/4 mx-auto rounded" />
          <div className="bg-gray-200 h-4 w-1/2 mx-auto rounded" />
          <div className="bg-gray-200 h-64 rounded-xl" />
        </div>
      </div>
    );
  }

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
            <span className="text-gray-600">{isPending ? 'Payment Pending' : 'Order Confirmed'}</span>
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
            {isPending ? (
              <>
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.2 }}
                  className="w-20 h-20 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-6"
                >
                  <Clock size={40} className="text-amber-500" />
                </motion.div>
                <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">Order Placed — Payment Pending</h1>
                <p className="text-gray-500 mb-6">
                  Your order has been saved. Please complete the payment to confirm your order.
                  Our team will contact you shortly if you need assistance.
                </p>
              </>
            ) : (
              <>
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.2 }}
                  className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6"
                >
                  <ShieldCheck size={40} className="text-green-500" />
                </motion.div>
                <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">Order Placed Successfully!</h1>
                <p className="text-gray-500 mb-6">Thank you for shopping with us. Your order has been received and is being processed.</p>
              </>
            )}

            {order && (
              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 text-sm text-gray-600 mb-6">
                <div className="bg-gray-50 px-4 py-2 rounded-full border border-gray-100 flex items-center gap-2">
                  <span className="font-medium text-gray-400">Order ID:</span>
                  <span className="font-bold text-gray-800">{(order as any).displayId || order.id}</span>
                </div>
                <div className="bg-gray-50 px-4 py-2 rounded-full border border-gray-100 flex items-center gap-2">
                  <span className="font-medium text-gray-400">Status:</span>
                  <span className={`font-bold ${isPending ? 'text-amber-500' : 'text-green-600'}`}>
                    {isPending ? 'Payment Pending' : 'Processing'}
                  </span>
                </div>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button onClick={() => router.push('/orders')} className="bg-white border-2 border-brand-blue text-brand-blue px-6 py-2.5 rounded-lg font-bold text-[13px] uppercase tracking-wider hover:bg-brand-blue/5 transition-colors">
                View Order
              </button>
              <button onClick={() => router.push('/')} className="bg-brand-blue text-white px-6 py-2.5 rounded-lg font-bold text-[13px] uppercase tracking-wider hover:bg-brand-blue/90 transition-colors">
                Continue Shopping
              </button>
            </div>
          </motion.div>

          {/* Delivery Area Warning */}
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
          {order && (
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
                          <img src={item.product.images[0]} alt="" className="w-full h-full object-cover rounded"
                            onError={(e) => { (e.currentTarget as HTMLImageElement).src = '/placeholder.svg'; }} />
                        ) : (
                          <Package size={16} className="text-gray-300" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-gray-800 truncate">{item.product?.name || item.combo?.name || 'Product'}</p>
                        <p className="text-[11px] text-gray-400">Qty: {item.quantity}</p>
                      </div>
                      <div className="text-[12px] font-bold text-gray-800">
                        {config.currency.symbol}{fmt(nn(item.price) * item.quantity)}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="border-t pt-3 space-y-2 text-[12px]">
                <div className="flex justify-between text-gray-500">
                  <span>Subtotal</span>
                  <span>{config.currency.symbol}{fmt(order.subtotal)}</span>
                </div>
                <div className="flex justify-between text-gray-500">
                  <span>Shipping</span>
                  <span>
                    {hasDeliveryArea
                      ? `${config.currency.symbol}${fmt((order as any).shippingCharge)}`
                      : <span className="text-amber-500">To be determined</span>
                    }
                  </span>
                </div>
                {nn((order as any).discount) > 0 && (
                  <div className="flex justify-between text-green-600">
                    <span>Discount</span>
                    <span>-{config.currency.symbol}{fmt((order as any).discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-[14px] text-gray-900 pt-2 border-t mt-2">
                  <span>Total</span>
                  <span className="text-brand-blue">{config.currency.symbol}{fmt((order as any).total || (order as any).subtotal)}</span>
                </div>
              </div>

              {(order as any).payments && (order as any).payments.length > 0 && (
                <div className="border-t mt-4 pt-4">
                  <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Payment</h3>
                  {(order as any).payments.map((p: any, i: number) => (
                    <div key={i} className="flex justify-between text-[12px]">
                      <span className="text-gray-500 capitalize">{p.method}</span>
                      <span className={`font-bold ${p.status === 'verified' ? 'text-green-600' : 'text-amber-500'}`}>
                        {p.status === 'verified' ? 'Paid' : p.status === 'pending' ? 'Pending' : p.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {order && shippingAddress && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="bg-white rounded-2xl shadow-sm p-6"
            >
              <h2 className="text-base font-bold text-gray-800 mb-3 border-b pb-2">Shipping Details</h2>
              <div className="text-[13px] text-gray-600 space-y-1">
                <p className="font-bold text-gray-800">{(order as any).guestName || shippingAddress.name || 'Customer'}</p>
                {shippingAddress.district && <p>District: {shippingAddress.district}{shippingAddress.thana ? `, ${shippingAddress.thana}` : ''}</p>}
                {shippingAddress.addressLine && <p>{shippingAddress.addressLine}</p>}
                <p className="pt-1 flex items-center gap-1.5"><Truck size={14} className="text-gray-400" /> {(order as any).guestPhone || shippingAddress.phone}</p>
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
