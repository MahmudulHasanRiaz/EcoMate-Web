"use client";

import React, { useState, useEffect } from 'react';
import { ChevronDown, ShieldCheck, MapPin, ChevronRight, X, Minus, Plus, Package2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useCart } from '@/context/CartContext';
import { COMBOS } from '@/lib/combos';
import { PLACEHOLDER_IMAGE } from '@/lib/constants';
import { useRouter } from 'next/navigation';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CheckoutItemRow({ item, removeFromCart, updateQuantity }: any) {
  const [imgError, setImgError] = useState(false);
  return (
    <div className="flex gap-4">
      <div className="w-[60px] h-[60px] md:w-[80px] md:h-[80px] border border-gray-100 rounded-lg flex-shrink-0 flex items-center justify-center p-1.5 bg-[#fcfcfc]">
        <img 
          src={imgError ? PLACEHOLDER_IMAGE : (item.image || PLACEHOLDER_IMAGE)} 
          alt={item.name} 
          className="w-full h-full object-contain"
          onError={() => setImgError(true)}
        />
      </div>
      <div className="flex-1">
        <div className="flex justify-between items-start mb-2 pr-1">
          <h3 className="text-[13px] md:text-[14px] font-bold text-gray-800 leading-snug max-w-[240px]">{item.name}</h3>
          <button onClick={() => removeFromCart(item.id)} className="text-red-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded-full">
            <X size={18} />
          </button>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center h-8 md:h-9 border border-gray-200 rounded-md bg-[#f8f9fa] overflow-hidden">
            <button onClick={() => updateQuantity(item.id, item.quantity - 1)} className="w-8 h-full flex items-center justify-center text-gray-500 hover:bg-gray-100"><Minus size={14} /></button>
            <span className="w-10 h-full flex items-center justify-center border-x border-gray-200 bg-white text-[13px] font-black text-gray-800">{item.quantity}</span>
            <button onClick={() => updateQuantity(item.id, item.quantity + 1)} className="w-8 h-full flex items-center justify-center text-brand-blue hover:bg-gray-100"><Plus size={14} /></button>
          </div>
          <div className="font-black text-[15px] text-gray-800">
            ৳{(item.price * item.quantity).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  const { items, cartTotal, clearCart, updateQuantity, removeFromCart } = useCart();
  const router = useRouter();
  const [district, setDistrict] = useState('');
  const [thana, setThana] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [isCouponExpanded, setIsCouponExpanded] = useState(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const handlePlaceOrder = () => {
    setIsSuccess(true);
    setTimeout(() => {
      clearCart();
      setIsSuccess(false);
      router.push('/');
    }, 2000);
  };

  if (isSuccess) {
    return (
      <div className="bg-[#f2f4f8] min-h-screen pb-32 font-sans flex items-center justify-center p-4">
         <div className="bg-white rounded-xl shadow-sm p-8 text-center max-w-md w-full">
            <div className="w-16 h-16 bg-green-100 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
               <ShieldCheck size={32} />
            </div>
            <h2 className="text-xl font-bold text-gray-800 mb-2">Order placed successfully!</h2>
            <p className="text-gray-500 mb-6">Thank you for shopping with Fixed Plus.</p>
         </div>
      </div>
    );
  }

  return (
    <div className="bg-[#f2f4f8] min-h-screen pb-20 md:pb-12 font-sans">
      
      {/* Centered Header Section */}
      <div className="bg-white md:bg-[#f8f9fa] border-b border-gray-100 py-6 md:py-10">
        <div className="max-w-screen-xl mx-auto px-4 text-center">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-2">Checkout</h1>
          <nav className="flex items-center justify-center gap-2 text-[11px] md:text-[13px] text-gray-400 font-medium">
            <button onClick={() => router.push('/')} className="hover:text-brand-blue">Home</button>
            <ChevronRight size={14} />
            <span className="text-gray-600">Checkout</span>
          </nav>
        </div>
      </div>

      <div className="max-w-screen-xl mx-auto px-4 md:py-8">
        
        {/* Top Banner */}
        <div className="bg-white rounded-lg border border-gray-100 p-3 md:p-4 mb-6 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-[14px] md:text-[15px] text-gray-700 font-medium">Have any account? please login or register</p>
          <div className="flex gap-2 w-full md:w-auto">
            <button className="flex-1 md:flex-none border border-gray-200 text-gray-700 px-6 py-2 rounded-[4px] text-[13px] font-bold uppercase transition-colors hover:bg-gray-50">
              Login
            </button>
            <button className="flex-1 md:flex-none bg-brand-blue text-white px-6 py-2 rounded-[4px] text-[13px] font-bold uppercase transition-colors hover:bg-brand-blue/90">
              Register
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Left Column: Review & Address */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Order Review Bundle */}
            <div className="bg-white rounded-lg border border-gray-100 relative shadow-sm overflow-hidden">
              <div className="p-4 md:p-6">
                <div className="flex items-center gap-2 mb-6 border-l-4 border-brand-blue pl-3">
                  <h2 className="text-[16px] md:text-[18px] font-bold text-gray-800">Order review</h2>
                </div>
                
                <div className="space-y-6">
                  {items.length === 0 ? (
                    <p className="text-gray-500 text-sm py-4">Your cart is empty.</p>
                  ) : (
                    items.map(item => {
                      const isCombo = item.id.startsWith('combo-');
                      const comboId = isCombo ? parseInt(item.id.replace('combo-', '')) : null;
                      const combo = isCombo ? COMBOS.find(c => c.id === comboId) : null;

                      return (
                        <div key={item.id} className="border border-gray-100 rounded-xl p-4 transition-colors hover:bg-[#fcfcfc]">
                          {isCombo ? (
                            <div className="space-y-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2 bg-brand-blue/5 px-2 py-1 rounded">
                                   <span className="text-[14px] font-bold text-gray-800">{combo?.name}</span>
                                </div>
                                <button onClick={() => removeFromCart(item.id)} className="text-red-500 hover:bg-red-50 p-1.5 rounded-full transition-colors">
                                  <X size={18} />
                                </button>
                              </div>
                              <div className="space-y-3">
                                {combo?.items.map((sub, idx) => (
                                  <div key={idx} className="flex items-center justify-between text-[13px] pl-4">
                                    <div className="flex items-center gap-3">
                                       <span className="text-gray-600 font-medium">{sub.name} <span className="text-gray-400 ml-1">&times; {sub.qty}</span></span>
                                    </div>
                                    {idx === 0 && <span className="text-[#2ecc71] font-bold">Included</span>}
                                  </div>
                                ))}
                              </div>
                              <div className="flex items-center justify-between pt-3 border-t border-gray-50">
                                 <span className="text-[12px] text-gray-400 font-bold uppercase">Combo Total</span>
                                 <span className="text-[15px] font-black text-brand-blue">৳{item.price.toLocaleString('en-US', {minimumFractionDigits: 2})}</span>
                              </div>
                            </div>
                          ) : (
                            <CheckoutItemRow item={item} removeFromCart={removeFromCart} updateQuantity={updateQuantity} />
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Shipping Address Module */}
            <div className="bg-white rounded-lg border border-gray-100 relative shadow-sm overflow-hidden">
              <div className="p-4 md:p-6">
                <div className="flex items-center gap-2 mb-6 border-l-4 border-brand-blue pl-3">
                  <h2 className="text-[16px] md:text-[18px] font-bold text-gray-800">Shipping Address</h2>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <input 
                    type="text" 
                    placeholder="Your Full Name *" 
                    className="w-full border border-gray-200 rounded-md px-4 py-3 text-[14px] outline-none focus:border-brand-blue transition-all bg-[#fcfcfc]"
                  />
                  <div className="flex">
                    <div className="border border-gray-200 border-r-0 rounded-l-md px-4 py-3 bg-[#f8f9fa] text-gray-600 font-bold text-[14px]">
                      88
                    </div>
                    <input 
                      type="tel" 
                      placeholder="017********" 
                      className="w-full border border-gray-200 rounded-r-md px-4 py-3 text-[14px] outline-none focus:border-brand-blue transition-all bg-[#fcfcfc]"
                    />
                  </div>
                  
                  <div className="relative">
                    <select 
                      value={district}
                      onChange={(e) => setDistrict(e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-4 py-3 text-[14px] outline-none focus:border-brand-blue appearance-none bg-[#fcfcfc] text-gray-600 font-medium"
                    >
                      <option value="" disabled>Select District</option>
                      <option value="dhaka">Dhaka</option>
                    </select>
                    <ChevronDown size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                  <div className="relative">
                    <select 
                      value={thana}
                      onChange={(e) => setThana(e.target.value)}
                      className="w-full border border-gray-200 rounded-md px-4 py-3 text-[14px] outline-none focus:border-brand-blue appearance-none bg-[#fcfcfc] text-gray-600 font-medium"
                    >
                      <option value="" disabled>Select Thana (Optional)</option>
                      <option value="gulshan">Gulshan</option>
                    </select>
                    <ChevronDown size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>

                  <div className="md:col-span-2">
                    <textarea 
                      placeholder="ex: House no. / building / street / area"
                      rows={2}
                      className="w-full border border-gray-200 rounded-md px-4 py-3 text-[14px] outline-none focus:border-brand-blue resize-none bg-[#fcfcfc]"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Billing Address Module */}
            <div className="bg-white rounded-lg border border-gray-100 p-4 md:p-6 shadow-sm flex justify-between items-center cursor-pointer transition-colors hover:bg-[#fcfcfc]">
              <div className="flex items-center gap-3">
                <div className="w-1 h-6 bg-brand-blue rounded-sm"></div>
                <span className="text-[16px] md:text-[18px] font-bold text-gray-800">Billing Address</span>
              </div>
              <div className="w-5 h-5 rounded-full border-2 border-gray-300"></div>
            </div>
          </div>

          {/* Right Column: Order Summary & Payment */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* Payment Method Module */}
            <div className="bg-white rounded-lg border border-gray-100 relative shadow-sm overflow-hidden">
              <div className="p-4 md:p-6">
                <div className="flex items-center gap-2 mb-6 border-l-4 border-brand-blue pl-3">
                  <h2 className="text-[16px] md:text-[18px] font-bold text-gray-800">Payment method</h2>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                  <div className="border-2 border-brand-blue bg-brand-blue/5 rounded-lg p-3 flex items-center justify-between cursor-pointer">
                    <div className="flex items-center gap-3">
                       <div className="w-10 h-10 bg-gray-100 rounded-md flex items-center justify-center">
                         <Package2 size={20} className="text-brand-blue" />
                       </div>
                       <span className="text-[13px] text-gray-800 font-bold">Cash On Delivery</span>
                    </div>
                    <div className="w-5 h-5 rounded-full bg-brand-blue flex items-center justify-center">
                      <ShieldCheck size={14} className="text-white" />
                    </div>
                  </div>
                  
                  <div className="border border-gray-100 rounded-lg p-3 flex items-center gap-3 cursor-pointer hover:border-brand-blue transition-all bg-[#fcfcfc]">
                    <div className="w-10 h-10 bg-gray-100 rounded-md flex items-center justify-center">
                      <ShieldCheck size={20} className="text-blue-500" />
                    </div>
                    <span className="text-[13px] text-gray-800 font-bold whitespace-nowrap">Online Payment</span>
                  </div>
                  
                  <div className="border border-gray-100 rounded-lg p-3 flex items-center gap-3 cursor-pointer hover:border-brand-blue transition-all bg-[#fcfcfc]">
                    <div className="w-10 h-10 bg-[#e2136e] rounded-md flex items-center justify-center text-white font-bold text-[10px]">
                      bkash
                    </div>
                    <span className="text-[13px] text-gray-800 font-bold">Bkash</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Coupon & Summary Bundle */}
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden divide-y divide-gray-50">
              
              {/* Coupon Accordion */}
              <button 
                onClick={() => setIsCouponExpanded(!isCouponExpanded)}
                className="w-full p-4 md:p-6 flex justify-between items-center cursor-pointer group text-left outline-none"
              >
                <span className="text-[14px] md:text-[15px] font-bold text-gray-700 group-hover:text-brand-blue transition-colors">
                  Have any coupon or gift voucher?
                </span>
                <motion.div
                  animate={{ rotate: isCouponExpanded ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronDown size={20} className="text-brand-blue" />
                </motion.div>
              </button>

              <AnimatePresence>
                {isCouponExpanded && (
                  <motion.div 
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: "easeInOut" }}
                    className="overflow-hidden bg-[#fcfcfc]"
                  >
                    <div className="p-4 md:p-6 pt-0 md:pt-0">
                      <div className="flex gap-2">
                        <input 
                          type="text" 
                          placeholder="Enter Coupon" 
                          className="flex-1 border border-gray-200 rounded-md px-4 py-2 text-[14px] outline-none focus:border-brand-blue bg-white"
                        />
                        <button className="bg-brand-blue text-white px-4 py-2 rounded-md text-[13px] font-bold uppercase transition-colors hover:bg-brand-blue/90">
                          Apply
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              
              <div className="p-4 md:p-6 space-y-4">
                <div className="flex justify-between items-center">
                   <span className="text-[14px] text-gray-500 font-medium">Sub total</span>
                   <span className="text-[14px] text-gray-800 font-black">{cartTotal.toLocaleString('en-US', {minimumFractionDigits: 2})} BDT</span>
                </div>
                <div className="flex justify-between items-center">
                   <span className="text-[14px] text-gray-500 font-medium">Delivery cost</span>
                   <span className="text-[14px] text-gray-800 font-black">0 BDT</span>
                </div>
                <div className="flex justify-between items-center pt-4 mt-4 border-t-2 border-dashed border-gray-100">
                   <span className="text-[16px] font-black text-gray-900">Total</span>
                   <span className="text-[16px] font-black text-gray-900">৳{cartTotal.toLocaleString('en-US', {minimumFractionDigits: 2})} BDT</span>
                </div>
              </div>
            </div>

            {/* Special notes */}
            <div className="bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-4 md:p-6">
                <div className="flex items-center gap-2 mb-4 border-l-4 border-brand-blue pl-3">
                  <h2 className="text-[15px] font-bold text-gray-800">Special notes <span className="font-normal text-[12px] text-gray-400 ml-1">(Optional)</span></h2>
                </div>
                <textarea 
                  className="w-full border border-gray-100 rounded-lg px-4 py-3 text-[14px] outline-none focus:border-brand-blue resize-none h-24 bg-[#fcfcfc]"
                  maxLength={90}
                />
                <div className="text-[11px] text-gray-400 mt-1 text-right">0 / 90 characters</div>
              </div>
            </div>

            {/* Agreement & Place Order */}
            <div className="space-y-4">
              <div className="flex items-start gap-3 px-2">
                <div className="w-5 h-5 rounded-full bg-brand-blue flex items-center justify-center flex-shrink-0 mt-0.5 shadow-sm">
                  <ShieldCheck size={12} className="text-white" />
                </div>
                <p className="text-[12px] md:text-[13px] text-gray-500 leading-relaxed">
                  I have read and agree to the <span className="text-brand-blue font-bold cursor-pointer hover:underline">Terms and Conditions</span>, <span className="text-brand-blue font-bold cursor-pointer hover:underline">Privacy Policy</span> & <span className="text-brand-blue font-bold cursor-pointer hover:underline">Refund and Return Policy</span>.
                </p>
              </div>

              <button 
                onClick={items.length > 0 ? handlePlaceOrder : undefined}
                disabled={items.length === 0}
                className={`w-full text-white font-black h-14 rounded-lg text-[16px] uppercase tracking-widest shadow-lg transition-all active:scale-[0.98] ${items.length > 0 ? 'bg-brand-blue hover:bg-brand-blue/90 shadow-brand-blue/20' : 'bg-gray-400 cursor-not-allowed'}`}
              >
                PLACE ORDER
              </button>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
