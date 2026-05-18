"use client";

import React from 'react';
import { Lock, Eye, FileText, Database } from 'lucide-react';

export default function PrivacyPolicyPage() {
  return (
    <div className="bg-[#0a0a0a] min-h-screen text-white pt-24 pb-32">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="mb-20">
          <div className="flex items-center gap-3 text-brand-blue font-mono text-sm tracking-widest uppercase mb-8">
            <Lock size={16} />
            <span>Secure & Private</span>
          </div>
          <h1 className="text-5xl md:text-8xl font-black mb-8 leading-[0.85] tracking-tighter">
            Privacy <br /><span className="text-brand-blue">Protocols.</span>
          </h1>
          <div className="h-1 w-24 bg-brand-blue mb-12" />
          <p className="text-gray-400 text-lg leading-relaxed max-w-2xl">
            Your trust is our most valuable asset. Learn how we collect, protect, and handle your data with transparency and care.
          </p>
        </div>

        {/* Content Sections */}
        <div className="space-y-24">
          <PrivacySection 
            icon={<Eye size={24} />}
            title="Data Collection"
            text="We only collect essential information needed to fulfill your orders: name, shipping address, mobile number, and email. We do not store sensitive payment details like credit card numbers; these are handled by secured 3rd party gateways."
          />

          <PrivacySection 
            icon={<Database size={24} />}
            title="Usage Disclosure"
            text="Your data is primarily used to process transactions, send delivery updates, and occasionally inform you about new products or offers. We never sell your personal information to third-party marketing agencies."
          />

          <PrivacySection 
            icon={<Shield size={24} />}
            title="Security Architecture"
            text="Our platform uses industry-standard SSL encryption for all data transfers. We conduct periodic security audits to ensure your data remains protected against unauthorized access or breaches."
          />

          <div className="bg-[#1a1a1a] p-12 rounded-[40px] border border-white/5">
             <h3 className="text-2xl font-bold mb-6">User Rights</h3>
             <div className="grid grid-cols-1 md:grid-cols-2 gap-8 text-gray-400 text-sm">
                <p>You have the right to request access to the personal data we hold about you at any time.</p>
                <p>You may request the deletion of your account and all associated personal data from our servers.</p>
                <p>You can opt-out of marketing communications by clicking &lsquo;Unsubscribe&rsquo; in our emails.</p>
                <p>If you have any privacy concerns, contact our Data Privacy Officer via email.</p>
             </div>
          </div>

          <div className="text-center pt-12 border-t border-white/10">
            <p className="text-gray-500 text-xs font-mono uppercase tracking-[0.3em]">Last Updated: January 2024</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function PrivacySection({ icon, title, text }: { icon: any, title: string, text: string }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[60px_1fr] gap-8">
      <div className="w-14 h-14 rounded-full border border-white/10 flex items-center justify-center text-brand-blue">
        {icon}
      </div>
      <div>
        <h2 className="text-2xl font-bold mb-4 tracking-tight">{title}</h2>
        <p className="text-gray-400 leading-relaxed text-base md:text-lg">{text}</p>
      </div>
    </div>
  );
}

function Shield({ size }: { size: number }) {
  return <div className="w-6 h-6 border-2 border-current rounded-sm rotate-45" />;
}
