"use client";

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { Sidebar } from './Sidebar';
import { ProfileSection } from './sections/ProfileSection';
import { OrdersSection } from './sections/OrdersSection';
import { AddressesSection } from './sections/AddressesSection';
import { SettingsSection } from './sections/SettingsSection';
import { useRouter } from 'next/navigation';

type Section = 'profile' | 'orders' | 'addresses' | 'settings';

export default function AccountPage() {
  const { user, loading, login, register } = useAuth();
  const router = useRouter();
  const [activeSection, setActiveSection] = useState<Section>('profile');
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (loading) {
    return (
      <div className="max-w-md mx-auto px-4 py-24 flex items-center justify-center">
        <Loader2 className="animate-spin text-brand-blue" size={32} />
      </div>
    );
  }

  if (!user) {
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
                : 'Sign up to get started'}
            </p>
          </div>

          <form onSubmit={async (e) => {
            e.preventDefault(); setError(''); setSubmitting(true);
            try {
              if (isLoginMode) await login(email, password);
              else await register({ firstName, lastName, username, email, phoneNumber, password });
            } catch (err: any) {
              setError(err?.response?.data?.message || err?.message || 'Authentication failed');
            } finally { setSubmitting(false); }
          }} className="space-y-4">
            {!isLoginMode && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-600 ml-1">First Name</label>
                    <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} placeholder="John" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-gray-600 ml-1">Last Name</label>
                    <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} placeholder="Doe" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600 ml-1">Username</label>
                  <input type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="johndoe" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-gray-600 ml-1">Phone Number</label>
                  <input type="tel" value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} placeholder="+8801700000000" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" />
                </div>
              </>
            )}
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600 ml-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" required />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-gray-600 ml-1">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className="w-full h-12 px-4 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:bg-white focus:border-brand-blue text-sm" required />
            </div>
            {error && <div className="text-red-500 text-xs font-medium bg-red-50 p-3 rounded-xl">{error}</div>}
            <button type="submit" disabled={submitting} className="w-full h-12 bg-brand-blue hover:bg-brand-blue/90 text-white font-bold rounded-xl transition-all shadow-lg shadow-brand-blue/20 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center">
              {submitting ? <Loader2 className="animate-spin" size={20} /> : (isLoginMode ? 'Sign In' : 'Create Account')}
            </button>
          </form>

          <div className="mt-8 text-center border-t border-gray-100 pt-6">
            <span className="text-sm text-gray-500 mr-2">
              {isLoginMode ? "Don't have an account?" : "Already have an account?"}
            </span>
            <button type="button" onClick={() => setIsLoginMode(!isLoginMode)} className="text-sm font-bold text-brand-blue hover:underline">
              {isLoginMode ? 'Sign Up' : 'Sign In'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const renderSection = () => {
    switch (activeSection) {
      case 'profile': return <ProfileSection />;
      case 'orders': return <OrdersSection />;
      case 'addresses': return <AddressesSection />;
      case 'settings': return <SettingsSection />;
      default: return <ProfileSection />;
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 md:py-12">
      <div className="flex flex-col md:flex-row gap-8">
        <div className="w-full md:w-80 flex-shrink-0">
          <Sidebar activeSection={activeSection} onNavigate={setActiveSection} />
        </div>
        <div className="flex-1 space-y-6">
          {renderSection()}
        </div>
      </div>
    </div>
  );
}
