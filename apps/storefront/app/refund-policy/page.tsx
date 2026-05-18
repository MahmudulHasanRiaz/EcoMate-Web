"use client";

import React from 'react';
import { ShieldCheck, ArrowRightLeft, RefreshCw, AlertCircle } from 'lucide-react';

export default function RefundPolicyPage() {
  return (
    <div className="bg-white min-h-screen">
      {/* Header */}
      <div className="bg-gray-50 border-b border-gray-100 py-16 md:py-24">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-brand-blue/10 rounded-xl text-brand-blue mb-6 animate-bounce">
             <RefreshCw size={24} />
          </div>
          <h1 className="text-4xl md:text-5xl font-black text-gray-900 mb-6 tracking-tight">Refund <span className="text-brand-blue">Policy</span></h1>
          <p className="text-gray-500 text-lg max-w-2xl mx-auto">
            We want you to be 100% satisfied with your purchase. Read how we handle returns and refunds.
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-16">
        <div className="space-y-12">
          {/* Section 1 */}
          <PolicySection 
            number="01"
            title="Eligibility for Refund"
            content="To be eligible for a refund, the product must be in the same condition that you received it, unworn or unused, with tags, and in its original packaging. You'll also need the receipt or proof of purchase."
          />

          {/* Section 2 */}
          <PolicySection 
            number="02"
            title="Reason for Refund"
            content={[
              "Received a damaged product upon delivery.",
              "Received a product that is past its expiration date.",
              "Received the wrong item entirely.",
              "The quality of the product does not match the description provided."
            ]}
          />

          {/* Section 3 */}
          <PolicySection 
            number="03"
            title="Refund Timeline"
            content="Once we receive and inspect your return, we will notify you of the approval or rejection of your refund. If approved, the refund will be processed within 5-7 business days through your original payment method (bKash, Nagad, or Bank Transfer)."
          />

          {/* Warning Box */}
          <div className="bg-amber-50 border-l-4 border-amber-400 p-8 rounded-r-2xl">
            <div className="flex items-start gap-4">
              <AlertCircle className="text-amber-500 shrink-0 mt-0.5" size={24} />
              <div>
                <h4 className="font-bold text-amber-900 mb-2">Important Notice</h4>
                <p className="text-amber-800/80 text-[15px] leading-relaxed">
                  Refund requests must be initiated within 24 hours of receiving the shipment. Since most of our items are perishable foods, we cannot accept returns after this period for hygiene and quality reasons.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-12 text-center">
            <p className="text-gray-400 text-sm mb-6 font-mono uppercase tracking-widest">Questions?</p>
            <a href="mailto:support@fixedplus.com" className="text-brand-blue font-bold text-xl hover:underline">support@fixedplus.com</a>
          </div>
        </div>
      </div>
    </div>
  );
}

function PolicySection({ number, title, content }: { number: string, title: string, content: string | string[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[100px_1fr] gap-4">
      <div className="font-mono text-4xl font-black text-gray-100 hidden md:block">{number}</div>
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">{title}</h2>
        {Array.isArray(content) ? (
          <ul className="space-y-4">
            {content.map((item, idx) => (
              <li key={idx} className="flex items-start gap-3 text-gray-600">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-blue mt-2.5 shrink-0" />
                <span className="text-[15px] leading-relaxed">{item}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-gray-600 leading-relaxed text-[15px]">{content}</p>
        )}
      </div>
    </div>
  );
}
