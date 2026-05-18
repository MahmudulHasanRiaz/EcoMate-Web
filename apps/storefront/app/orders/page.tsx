"use client";

import React, { useState } from 'react';
import { Search, Package, Truck, CheckCircle2, Clock, MapPin, ChevronRight } from 'lucide-react';

import { useRouter } from 'next/navigation';

export default function OrdersPage() {
  const router = useRouter();
  const [orderNumber, setOrderNumber] = useState('');
  const [isSearched, setIsSearched] = useState(false);
  const [imgError, setImgError] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (orderNumber.trim()) {
      setIsSearched(true);
    }
  };

  const steps = [
    { title: 'Order Placed', date: '12 May, 2026', time: '10:30 AM', icon: Package, status: 'completed' },
    { title: 'Processing', date: '12 May, 2026', time: '11:45 AM', icon: Clock, status: 'completed' },
    { title: 'In Transit', date: 'Expected tomorrow', icon: Truck, status: 'current' },
    { title: 'Delivered', date: 'Pending', icon: CheckCircle2, status: 'upcoming' },
  ];

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

        {isSearched && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Order Status Header */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm flex flex-col md:flex-row justify-between items-center gap-6">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 bg-brand-blue/10 rounded-2xl flex items-center justify-center text-brand-blue">
                  <Truck size={28} />
                </div>
                <div>
                  <h3 className="text-gray-400 text-[13px] font-medium uppercase tracking-wider mb-0.5">Order ID</h3>
                  <p className="text-xl font-bold text-gray-800">{orderNumber}</p>
                </div>
              </div>
              <div className="text-center md:text-right">
                <h3 className="text-gray-400 text-[13px] font-medium uppercase tracking-wider mb-0.5">Estimated Arrival</h3>
                <p className="text-xl font-bold text-[#2ecc71]">15 May, 2026</p>
              </div>
            </div>

            {/* Tracking Steps */}
            <div className="bg-white rounded-2xl border border-gray-100 p-6 md:p-10 shadow-sm">
              <div className="relative">
                <div className="absolute left-[23px] top-6 bottom-6 w-0.5 bg-gray-100"></div>
                
                <div className="space-y-12">
                  {steps.map((step, index) => (
                    <div key={index} className="relative flex gap-6 md:gap-10">
                      <div 
                        className={`relative z-10 w-12 h-12 rounded-2xl flex items-center justify-center shadow-sm transition-colors ${
                          step.status === 'completed' ? 'bg-brand-blue text-white' : 
                          step.status === 'current' ? 'bg-brand-blue text-white animate-pulse' : 
                          'bg-gray-50 text-gray-300 border border-gray-100'
                        }`}
                      >
                        <step.icon size={24} />
                      </div>
                      
                      <div className="flex-1 pt-1">
                        <div className="flex flex-col md:flex-row md:items-center justify-between mb-1">
                          <h4 className={`text-lg font-bold ${step.status === 'upcoming' ? 'text-gray-400' : 'text-gray-800'}`}>
                            {step.title}
                          </h4>
                          <span className="text-[13px] font-medium text-gray-400">{step.date}</span>
                        </div>
                        {step.time && (
                          <div className="flex items-center gap-1.5 text-gray-500 mb-2">
                            <Clock size={14} />
                            <span className="text-[13px]">{step.time}</span>
                          </div>
                        )}
                        <p className={`text-[14px] leading-relaxed ${step.status === 'upcoming' ? 'text-gray-300' : 'text-gray-500'}`}>
                          {step.status === 'completed' ? 'This stage is completed successfully.' : 
                           step.status === 'current' ? 'Your package is currently at this stage and moving soon.' : 
                           'Awaiting to reach this destination.'}
                        </p>
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
                    <h4 className="font-bold text-gray-800 mb-1">Riaz Mahmud</h4>
                    <p className="text-[14px] text-gray-500 leading-relaxed">
                      House: 15, Road: 04, Block: G<br />
                      Banashree, Rampura, Dhaka-1219<br />
                      Phone: +880 1712 345678
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
                    <img 
                      src={imgError ? "https://placehold.co/100x100/f8f9fa/a0aec0?text=Support" : "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100&h=100&fit=crop"} 
                      alt="Support" 
                      className="w-full h-full object-cover" 
                      onError={() => setImgError(true)}
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
