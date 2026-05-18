"use client";

import React, { useState } from 'react';
import { HelpCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useRouter } from 'next/navigation';

const FAQS = [
  {
    question: "How do I place an order?",
    answer: "You can easily place an order through our website by adding items to your cart and proceeding to checkout. Alternatively, you can use our Mobile App or call our customer service center."
  },
  {
    question: "What are the payment methods available?",
    answer: "We accept multiple payment methods including Cash on Delivery (COD), Mobile Banking (bKash, Nagad, Rocket), and Credit/Debit Cards (Visa, MasterCard)."
  },
  {
    question: "How long does delivery take?",
    answer: "Inside Dhaka, delivery usually takes 1-2 business days. Outside Dhaka, it may take 3-5 business days depending on the courier service. You can track your order using your order ID."
  },
  {
    question: "What is your return policy?",
    answer: "We offer a flexible return policy. If you receive a damaged or incorrect product, you can request a return within 3 days of receiving the order. Contact our support team for assistance."
  },
  {
    question: "Are your products authentic?",
    answer: "Yes, 100% authentic. We carefully source all our products from verified suppliers, farmers, and our own managed manufacturing units to ensure premium quality."
  },
  {
    question: "How can I track my order?",
    answer: "You can track your order by clicking on the 'Track Order' link in the footer or mobile menu, and entering your order ID or mobile number."
  }
];

export default function FaqPage() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  const router = useRouter();

  return (
    <div className="max-w-4xl mx-auto px-4 py-8 md:py-16">
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-blue/10 text-brand-blue rounded-full mb-4">
          <HelpCircle size={32} />
        </div>
        <h2 className="text-3xl font-bold text-gray-800 mb-4">Frequently Asked Questions</h2>
        <p className="text-gray-500 max-w-2xl mx-auto">
          Have questions? We&apos;re here to help. If you don&apos;t find your answer here, feel free to contact our support team.
        </p>
      </div>

      <div className="space-y-4">
        {FAQS.map((faq, index) => {
          const isOpen = openIndex === index;
          return (
            <div 
              key={index} 
              className={`bg-white border rounded-xl overflow-hidden transition-all duration-300 ${isOpen ? 'border-brand-blue/30 shadow-md shadow-brand-blue/5' : 'border-gray-100 shadow-sm'}`}
            >
              <button
                className="w-full flex items-center justify-between p-5 md:p-6 text-left focus:outline-none"
                onClick={() => setOpenIndex(isOpen ? null : index)}
              >
                <span className={`font-bold text-[15px] md:text-base pr-8 ${isOpen ? 'text-brand-blue' : 'text-gray-800'}`}>
                  {faq.question}
                </span>
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${isOpen ? 'bg-brand-blue/10 text-brand-blue' : 'bg-gray-50 text-gray-400'}`}>
                  {isOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>
              </button>
              
              <div 
                className={`overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'}`}
              >
                <div className="px-5 md:px-6 pb-6 text-gray-600 text-sm md:text-[15px] leading-relaxed border-t border-gray-50 pt-4">
                  {faq.answer}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-12 bg-[#f8f9fa] border border-gray-100 rounded-2xl p-8 text-center">
        <h3 className="font-bold text-gray-800 text-lg mb-2">Still need help?</h3>
        <p className="text-gray-500 text-sm mb-6">Our customer support team is available 24/7 to assist you.</p>
        <button 
          onClick={() => {
            router.push('/support');
            window.scrollTo(0, 0);
          }}
          className="bg-brand-blue hover:bg-brand-blue/90 text-white px-8 h-11 rounded-full font-bold transition-all shadow-sm"
        >
          Contact Support
        </button>
      </div>
    </div>
  );
}
