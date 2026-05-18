"use client";

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShieldCheck, ChevronRight, Package, Home } from 'lucide-react';
import { useCart } from '@/context/CartContext';
import { getOrder } from '@/lib/api/orders';
import type { Order } from '@/lib/types';

export default function ThankYouContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { clearCart } = useCart();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  const orderId = searchParams.get('orderId');

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
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [orderId, clearCart]);

  if (!orderId) {
    return (
      <div className="bg-[#f2f4f8] min-h-screen flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-sm p-8 text-center max-w-md w-full">
          <div className="w-16 h-16 bg-amber-100 text-amber-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <Package size={32} />
          </div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">No order found</h2>
          <p className="text-gray-500 mb-6">We could not find an order to confirm.</p>
          <button onClick={() => router.push('/')} className="bg-brand-blue text-white px-6 py-3 rounded-lg font-bold text-[14px] uppercase tracking-wider hover:bg-brand-blue/90 transition-colors">Go Home</button>
        </div>
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
      <div className="bg-white border-b border-gray-100 py-6 md:py-10">
        <div className="max-w-screen-xl mx-auto px-4">
          <nav className="flex items-center justify-center gap-2 text-[11px] md:text-[13px] text-gray-400 font-medium mb-4">
            <button onClick={() => router.push('/')} className="hover:text-brand-blue flex items-center gap-1">
              <Home size={14} /> Home
            </button>
            <ChevronRight size={14} />
            <button onClick={() => router.push('/checkout')} className="hover:text-brand-blue">Checkout</button>
            <ChevronRight size={14} />
            <span className="text-gray-600">Order Confirmed</span>
          </nav>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 -mt-6">
        <div className="bg-white rounded-xl shadow-sm p-6 md:p-10 text-center">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
            <ShieldCheck size={40} className="text-green-500" />
          </div>

          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">Order Placed Successfully!</h1>
          <p className="text-gray-500 mb-8">Thank you for shopping with us.</p>

          {order && (
            <div className="bg-[#f8f9fa] rounded-xl p-6 text-left space-y-4 mb-8">
              <div className="flex items-center justify-between">
                <span className="text-[13px] text-gray-500 font-medium">Order ID</span>
                <span className="text-[14px] font-bold text-gray-800">{(order as any).displayId || order.id}</span>
              </div>
              {order.items && (
                <div className="border-t border-gray-200 pt-4">
                  <span className="text-[13px] text-gray-500 font-medium block mb-3">Items</span>
                  <div className="space-y-2">
                    {(order.items as any[]).map((item: any, idx: number) => (
                      <div key={idx} className="flex justify-between text-[13px]">
                        <span className="text-gray-700">{item.product?.name || item.combo?.name || 'Product'} <span className="text-gray-400">&times; {item.quantity}</span></span>
                        <span className="font-bold text-gray-800">৳{(Number(item.price) * item.quantity).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="border-t border-gray-200 pt-4 flex items-center justify-between">
                <span className="text-[15px] font-black text-gray-900">Total</span>
                <span className="text-[18px] font-black text-brand-blue">৳{Number((order as any).total || (order as any).subtotal || 0).toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
              </div>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button onClick={() => router.push('/orders')} className="bg-white border-2 border-brand-blue text-brand-blue px-8 py-3 rounded-lg font-bold text-[14px] uppercase tracking-wider hover:bg-brand-blue/5 transition-colors">
              View Order
            </button>
            <button onClick={() => router.push('/')} className="bg-brand-blue text-white px-8 py-3 rounded-lg font-bold text-[14px] uppercase tracking-wider hover:bg-brand-blue/90 transition-colors">
              Continue Shopping
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
