
"use client";

import { useState } from "react";

const TESTIMONIALS = [
  {
    name: 'Sultana Yesmin',
    role: 'Housewife',
    text: 'Thanks Fixed Plus for free Honeyraj. Of course, I got it for being a regular customer.',
    avatar: 'https://i.pravatar.cc/150?u=sultana'
  },
  {
    name: 'Ayesha Khan',
    role: 'Banker',
    text: '২য় বার Fixed Plus থেকে অর্ডার করলাম। আগের মতো এবারও খাঁটি পণ্য পেয়েছি। ধন্যবাদ ডেলিভারি ম্যানদের। একদম সঠিক সময়ে দিয়ে গিয়েছে।',
    avatar: 'https://i.pravatar.cc/150?u=ayesha'
  },
  {
    name: 'Fariha Akter Tumpa',
    role: 'Entrepreneur',
    text: 'এই খাঁটি মধুর জন্য আপনাদের অনেক অনেক ধন্যবাদ। খুব ভালো ছিল।',
    avatar: 'https://i.pravatar.cc/150?u=fariha'
  }
];

const PLACEHOLDER_IMAGE = "https://placehold.co/600x600/f8f9fa/a0aec0?text=No+Image";

export default function Testimonials() {
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  return (
    <section className="py-12 bg-[#fcfcfc]">
      <div className="max-w-7xl mx-auto px-4 text-center">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TESTIMONIALS.map((t, idx) => (
            <div key={idx} className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm text-left">
              <p className="text-[13px] md:text-[14px] text-gray-600 italic mb-6 leading-relaxed">
                &ldquo;{t.text}&rdquo;
              </p>
              <div className="flex items-center gap-3">
                <img 
                  src={imgErrors[t.name] ? PLACEHOLDER_IMAGE : t.avatar} 
                  alt={t.name} 
                  className="w-10 h-10 rounded-full object-cover border border-gray-100 bg-gray-50"
                  onError={() => setImgErrors(prev => ({ ...prev, [t.name]: true }))}
                />
                <div>
                  <h4 className="text-[14px] font-bold text-gray-800">{t.name}</h4>
                  <p className="text-[11px] text-gray-400 font-medium">{t.role}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        
        <div className="flex justify-center gap-1.5 mt-10">
           <div className="w-2 h-2 rounded-full bg-gray-200"></div>
           <div className="w-2 h-2 rounded-full bg-gray-200"></div>
           <div className="w-2 h-2 rounded-full bg-brand-blue"></div>
        </div>
      </div>
    </section>
  );
}
