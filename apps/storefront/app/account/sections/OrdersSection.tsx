"use client";

import { useState, useEffect } from 'react';
import { Package, Loader2, ChevronRight } from 'lucide-react';
import { getMyOrders } from '@/lib/api/orders';
import { OrderDetailSection } from './OrderDetailSection';
import type { Order } from '@/lib/types';

const TABS = [
  { key: '', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
];

export function OrdersSection() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [meta, setMeta] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const res = await getMyOrders({ page, perPage: 10, status: status || undefined });
      setOrders(res.data);
      setMeta(res.meta);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchOrders(); }, [page, status]);

  if (selectedOrderId) {
    return <OrderDetailSection orderId={selectedOrderId} onBack={() => setSelectedOrderId(null)} />;
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
      <h3 className="text-xl font-bold text-gray-800 mb-6">My Orders</h3>

      <div className="flex gap-2 mb-6 overflow-x-auto">
        {TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => { setStatus(tab.key); setPage(1); }}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              status === tab.key
                ? 'bg-brand-blue text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin text-brand-blue" size={28} /></div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Package size={48} strokeWidth={1} className="mx-auto mb-4 opacity-50" />
          <p>No orders found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map(order => (
            <button
              key={order.id}
              onClick={() => setSelectedOrderId(order.id)}
              className="w-full flex items-center justify-between p-4 rounded-xl border border-gray-100 hover:border-gray-200 hover:shadow-sm transition-all text-left"
            >
              <div>
                <p className="font-semibold text-gray-800 text-sm">{order.displayId}</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {new Date(order.createdAt).toLocaleDateString('bn-BD', { year: 'numeric', month: 'short', day: 'numeric' })}
                </p>
                <p className="text-xs text-gray-500 mt-1">
                  {order.items?.length || 0} item(s) — ৳{Number(order.total).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {order.status && (
                  <span
                    className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: order.status.color ? `${order.status.color}20` : '#f3f4f6', color: order.status.color || '#6b7280' }}
                  >
                    {order.status.name}
                  </span>
                )}
                <ChevronRight size={16} className="text-gray-400" />
              </div>
            </button>
          ))}
          {meta && meta.totalPages > 1 && (
            <div className="flex justify-center gap-2 pt-4">
              <button
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
                className="px-4 py-2 text-sm rounded-lg border disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Previous
              </button>
              <span className="px-4 py-2 text-sm text-gray-500">Page {meta.page} of {meta.totalPages}</span>
              <button
                disabled={page >= meta.totalPages}
                onClick={() => setPage(p => p + 1)}
                className="px-4 py-2 text-sm rounded-lg border disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
