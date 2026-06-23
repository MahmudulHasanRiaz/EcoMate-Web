"use client";

import { useState, useEffect } from 'react';
import { ChevronLeft, Package, Loader2 } from 'lucide-react';
import { getMyOrderById } from '@/lib/api/orders';
import type { Order } from '@/lib/types';
import { useStorefrontConfig } from '@/context/StorefrontConfigContext';

export function OrderDetailSection({ orderId, onBack }: { orderId: string; onBack: () => void }) {
  const { config } = useStorefrontConfig();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getMyOrderById(orderId).then(setOrder).catch(() => setOrder(null)).finally(() => setLoading(false));
  }, [orderId]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-brand-blue" size={28} /></div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
        <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"><ChevronLeft size={16} /> Back</button>
        <p className="text-center text-gray-400 py-8">Order not found</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
      <button onClick={onBack} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"><ChevronLeft size={16} /> Back to Orders</button>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-gray-800">{order.displayId}</h3>
        {order.status && (
          <span className="text-xs font-semibold px-3 py-1.5 rounded-full"
            style={{ backgroundColor: order.status.color ? `${order.status.color}20` : '#f3f4f6', color: order.status.color || '#6b7280' }}>
            {order.status.name}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
        <div><span className="text-gray-500">Date:</span> <span className="font-medium ml-1">{new Date(order.createdAt).toLocaleDateString('bn-BD', { year: 'numeric', month: 'long', day: 'numeric' })}</span></div>
        <div><span className="text-gray-500">Total:</span> <span className="font-medium ml-1">{config.currency.symbol}{Number(order.total).toLocaleString()}</span></div>
      </div>

      <h4 className="font-semibold text-gray-700 mb-3">Items</h4>
      <div className="space-y-2 mb-6">
        {order.items?.map((item: any) => (
          <div key={item.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
            {item.product?.images?.[0] && (
              <img src={item.product.images[0]} alt="" className="w-12 h-12 rounded-lg object-cover" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{item.product?.name || 'Product'}</p>
              <p className="text-xs text-gray-500">Qty: {item.quantity} x {config.currency.symbol}{Number(item.price).toLocaleString()}</p>
            </div>
            <p className="text-sm font-semibold text-gray-800">{config.currency.symbol}{(item.quantity * Number(item.price)).toLocaleString()}</p>
          </div>
        ))}
      </div>

      {order.shippingAddress && (
        <div>
          <h4 className="font-semibold text-gray-700 mb-2">Shipping Address</h4>
          <p className="text-sm text-gray-600 bg-gray-50 p-3 rounded-xl">
            {typeof order.shippingAddress === 'object' ? Object.values(order.shippingAddress as Record<string, string>).filter(Boolean).join(', ') : String(order.shippingAddress)}
          </p>
        </div>
      )}
    </div>
  );
}
