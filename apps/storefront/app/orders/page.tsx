"use client";

import React, { useState } from 'react';
import { Search, Package, Truck, CheckCircle2, Clock, MapPin, ChevronRight } from 'lucide-react';
import Image from 'next/image';
import { serverFetch } from '@/lib/api-server';
import { useRouter } from 'next/navigation';

interface OrderItem {
  id: string;
  quantity: number;
  price: number;
  product: { name: string; slug: string; images: string[] };
}

interface ShippingAddress {
  name?: string;
  phone?: string;
  address?: string;
  city?: string;
  district?: string;
  thana?: string;
}

interface TimelineEntry {
  status: string;
  timestamp: string;
  note?: string;
}

interface OrderData {
  id: string;
  displayId: string;
  status: { name: string; color?: string };
  createdAt: string;
  items: OrderItem[];
  shippingAddress: ShippingAddress | null;
  shipment: {
    courier?: string;
    trackingCode?: string;
    estimatedDelivery?: string;
  } | null;
  timeline: TimelineEntry[];
  customer?: { firstName: string; lastName: string; phoneNumber: string };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit',
  });
}

export default function OrdersPage() {
  const router = useRouter();
  const [orderNumber, setOrderNumber] = useState('');
  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orderNumber.trim()) return;
    setLoading(true);
    setError(null);
    setOrder(null);
    try {
      const data = await serverFetch<OrderData>(`/orders/public/${encodeURIComponent(orderNumber.trim())}`);
      setOrder(data);
    } catch {
      setError('Order not found. Please check your order number.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#f8f9fa] min-h-screen pb-20 font-sans">
      {/* Header Section */}
      <div className="bg-white border-b border-gray-100 py-8 md:py-12">
        <div className="max-w-screen-xl mx-auto px-4 text-center">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">Track Your Order</h1>
          <nav className="flex items-center justify-center gap-2 text-[12px] md:text-[13px] text-gray-400 font-medium">
            <button 
              onClick={() => router.push('/')} 
              className="hover:text-brand-blue transition-colors"
            >
              Home
            </button>
            <ChevronRight size={14} />
            <span className="text-gray-600">Track Order</span>
          </nav>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 -mt-6 md:-mt-8">
        {/* Search Card */}
        <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 p-6 md:p-10 mb-8">
          <form onSubmit={handleSearch} className="max-w-2xl mx-auto">
            <p className="text-center text-gray-500 text-[14px] md:text-[15px] mb-6">
              Enter your order number to track your package delivery status in real-time.
            </p>
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <input
                  type="text"
                  placeholder="Order ID (e.g. FP-100254)"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  className="w-full h-12 md:h-14 pl-12 pr-4 rounded-xl border border-gray-200 outline-none focus:border-brand-blue focus:ring-4 focus:ring-brand-blue/10 transition-all text-[15px]"
                />
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              </div>
              <button
                type="submit"
                className="h-12 md:h-14 bg-brand-blue text-white px-8 rounded-xl font-bold text-[15px] hover:bg-brand-blue/90 transition-colors shadow-lg shadow-brand-blue/20 active:scale-95"
              >
                Track Now
              </button>
            </div>
          </form>
        </div>

        {loading && (
          <div className="text-center py-20">
            <div className="inline-block w-8 h-8 border-2 border-brand-blue border-t-transparent rounded-full animate-spin"></div>
            <p className="mt-4 text-gray-500 text-[14px]">Looking up your order...</p>
          </div>
        )}

        {error && (
          <div className="bg-white rounded-2xl border border-gray-100 p-10 shadow-sm text-center">
            <Package className="mx-auto text-gray-300 mb-4" size={48} />
            <h3 className="text-lg font-bold text-gray-800 mb-2">Order Not Found</h3>
            <p className="text-gray-500 text-[14px] mb-6">{error}</p>
            <button
              onClick={() => { setError(null); setOrderNumber(''); }}
              className="text-brand-blue text-[14px] font-medium hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {order && !loading && !error && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Order Status Header */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-brand-blue/10 rounded-2xl flex items-center justify-center text-brand-blue">
                  <Truck size={28} />
                </div>
                <div>
                  <h3 className="text-gray-400 text-[13px] font-medium uppercase tracking-wider mb-0.5">Order ID</h3>
                  <p className="text-xl font-bold text-gray-800">{order.displayId}</p>
                </div>
              </div>
              <div className="text-center md:text-right">
                <h3 className="text-gray-400 text-[13px] font-medium uppercase tracking-wider mb-0.5">Status</h3>
                <p className="text-xl font-bold text-[#2ecc71]">{order.status.name}</p>
              </div>
            </div>

            {/* Tracking Steps from Timeline */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-10 shadow-sm">
              <div className="relative">
                <div className="absolute left-[23px] top-6 bottom-6 w-0.5 bg-gray-100"></div>
                
                <div className="space-y-12">
                  {(order.timeline || []).map((entry, index) => (
                    <div key={index} className="relative flex gap-6 md:gap-10">
                      <div className="relative z-10 w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm bg-brand-blue text-white">
                        <Package size={24} />
                      </div>
                      
                      <div className="flex-1 pt-1">
                        <div className="flex flex-col md:flex-row md:items-center justify-between mb-1">
                          <h4 className="text-lg font-bold text-gray-800">{entry.status}</h4>
                          <span className="text-[13px] font-medium text-gray-400">{formatDate(entry.timestamp)}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-gray-500 mb-2">
                          <Clock size={14} />
                          <span className="text-[13px]">{formatTime(entry.timestamp)}</span>
                        </div>
                        {entry.note && (
                          <p className="text-[14px] leading-relaxed text-gray-500">{entry.note}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Delivery Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-6 border-l-4 border-brand-blue pl-3">
                  <h3 className="font-bold text-gray-800">Shipping To</h3>
                </div>
                <div className="flex gap-4">
                  <div className="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center text-gray-400">
                    <MapPin size={20} />
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-800 mb-1">
                      {order.customer?.firstName} {order.customer?.lastName}
                    </h4>
                    <p className="text-[14px] text-gray-500 leading-relaxed">
                      {order.shippingAddress ? (
                        <>
                          {order.shippingAddress.address && <>{order.shippingAddress.address}<br /></>}
                          {[order.shippingAddress.thana, order.shippingAddress.district, order.shippingAddress.city].filter(Boolean).join(', ')}
                          <br />
                          Phone: {order.shippingAddress.phone || order.customer?.phoneNumber}
                        </>
                      ) : (
                        'No shipping address available'
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
                <div className="flex items-center gap-3 mb-6 border-l-4 border-brand-blue pl-3">
                  <h3 className="font-bold text-gray-800">Support Helper</h3>
                </div>
                <p className="text-[14px] text-gray-500 mb-4 leading-relaxed">
                  Need any help regarding your order? Our support team is available 24/7 to assist you with any inquiries.
                </p>
                <div className="flex items-center gap-3 p-3 bg-[#f8f9fa] rounded-xl border border-gray-50">
                  <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0">
                    <Image 
                      src="/placeholder.svg" 
                      alt="Support" 
                      width={40} height={40}
                      className="w-full h-full object-cover" 
                    />
                  </div>
                  <div>
                    <h4 className="font-bold text-gray-800 text-[14px]">Support Agent</h4>
                    <p className="text-[12px] text-brand-blue font-medium">+880 09642 922922</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
