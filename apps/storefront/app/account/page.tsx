"use client";

import React, { useState } from 'react';
import { Mail, Lock, User, LogOut, Package, MapPin, Heart, History, Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';

export default function AccountPage() {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);

  const handleAuth = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggedIn(true);
  };

  if (!isLoggedIn) {
    return (
      <div className="max-w-md mx-auto px-4 py-12 md:py-24">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              {isLoginMode ? 'Welcome Back' : 'Create Account'}
            </h2>
            <p className="text-sm text-gray-500">
              {isLoginMode 
                ? 'Sign in to access your orders, wishlist, and settings' 
                : 'Sign up to get started with Fixed Plus'}
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {!isLoginMode && (
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-600 ml-1">Full Name</label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <User size={18} />
                  </div>
                  <input 
                    type="text" 
                    placeholder="John Doe" 
                    className="w-full h-12 pl-10 pr-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 transition-all text-sm"
                    required
                  />
                </div>
              </div>
            )}
            
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600 ml-1">Email or Phone</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                  <Mail size={18} />
                </div>
                <input 
                  type="text" 
                  placeholder="name@example.com" 
                  className="w-full h-12 pl-10 pr-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 transition-all text-sm"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600 ml-1">Password</label>
              <div className="relative">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                  <Lock size={18} />
                </div>
                <input 
                  type="password" 
                  placeholder="••••••••" 
                  className="w-full h-12 pl-10 pr-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue focus:ring-2 focus:ring-brand-blue/20 transition-all text-sm"
                  required
                />
              </div>
            </div>

            {isLoginMode && (
              <div className="flex justify-end pt-1">
                <button type="button" className="text-xs font-medium text-brand-blue hover:underline">
                  Forgot Password?
                </button>
              </div>
            )}

            <div className="pt-2">
              <button 
                type="submit"
                className="w-full h-12 bg-brand-blue hover:bg-brand-blue/90 text-white font-bold rounded-xl transition-all shadow-lg shadow-brand-blue/20 active:scale-[0.98]"
              >
                {isLoginMode ? 'Sign In' : 'Create Account'}
              </button>
            </div>
          </form>

          <div className="mt-8 text-center border-t border-gray-100 pt-6">
            <span className="text-sm text-gray-500 mr-2">
              {isLoginMode ? "Don't have an account?" : "Already have an account?"}
            </span>
            <button 
              type="button" 
              onClick={() => setIsLoginMode(!isLoginMode)}
              className="text-sm font-bold text-brand-blue hover:underline"
            >
              {isLoginMode ? 'Sign Up' : 'Sign In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      <div className="flex flex-col md:flex-row gap-8">
        
        {/* Sidebar */}
        <div className="w-full md:w-80 flex-shrink-0">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
            <div className="flex items-center gap-4 mb-8">
              <div className="w-16 h-16 bg-brand-blue/10 text-brand-blue rounded-full flex items-center justify-center font-bold text-2xl">
                MA
              </div>
              <div>
                <h3 className="font-bold text-gray-800 text-lg">My Account</h3>
                <p className="text-sm text-gray-500">user@example.com</p>
              </div>
            </div>

            <div className="space-y-1">
              <SidebarItem icon={<User size={18} />} label="Profile Overview" isActive />
              <SidebarItem icon={<Package size={18} />} label="My Orders" />
              <SidebarItem icon={<MapPin size={18} />} label="Saved Addresses" />
              <SidebarItem 
                icon={<Heart size={18} />} 
                label="Wishlist" 
                onClick={() => router.push('/wishlist')} 
              />
              <SidebarItem icon={<History size={18} />} label="Order History" />
              <SidebarItem icon={<Settings size={18} />} label="Settings" />
            </div>

            <div className="mt-8 pt-8 border-t border-gray-100">
              <button 
                onClick={() => setIsLoggedIn(false)}
                className="w-full flex items-center justify-between text-sm font-semibold text-gray-600 hover:text-red-500 transition-colors p-3 rounded-lg hover:bg-red-50"
              >
                <span>Log Out</span>
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
            <h3 className="text-xl font-bold text-gray-800 mb-6">Profile Settings</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-600 ml-1">First Name</label>
                <input type="text" defaultValue="John" className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-600 ml-1">Last Name</label>
                <input type="text" defaultValue="Doe" className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-600 ml-1">Email Address</label>
                <input type="email" defaultValue="user@example.com" className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold text-gray-600 ml-1">Phone Number</label>
                <input type="tel" defaultValue="+8801700000000" className="w-full h-11 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
              </div>
            </div>

            <button className="bg-brand-blue hover:bg-brand-blue/90 text-white px-8 h-11 rounded-xl text-sm font-bold transition-all shadow-sm active:scale-95">
              Save Changes
            </button>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
            <h3 className="text-xl font-bold text-gray-800 mb-6">Recent Orders</h3>
            <div className="text-center py-12 text-gray-400">
              <Package size={48} strokeWidth={1} className="mx-auto mb-4 opacity-50" />
              <p>You have no recent orders</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SidebarItem({ icon, label, isActive, onClick }: { icon: React.ReactNode, label: string, isActive?: boolean, onClick?: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
      isActive 
        ? 'bg-brand-blue/10 text-brand-blue font-semibold' 
        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900 font-medium'
    }`}>
      <div className={isActive ? 'text-brand-blue' : 'text-gray-400'}>
        {icon}
      </div>
      <span className="text-sm">{label}</span>
    </button>
  );
}
