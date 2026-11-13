"use client";

import { useMemo, useState } from 'react';
import { HelpCircle, ChevronDown, Search } from 'lucide-react';
import { stringifyForScript } from '@/lib/safe-json';

interface FaqItem {
  question?: string;
  answer?: string;
  /** Added by Part A to the FAQ item schema; read defensively — items
   *  without a category still render, uncategorised. */
  category?: string;
}

const UNCATEGORISED = 'General';

function itemCategory(item: FaqItem): string {
  const c = (item.category || '').trim();
  return c || UNCATEGORISED;
}

export default function FaqTemplate({ config }: { config: Record<string, any> }) {
  const items: FaqItem[] = Array.isArray(config?.items) ? config.items : [];
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');

  // JSON-LD describes the whole page, not the current filter.
  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((faq) => ({
      '@type': 'Question',
      name: faq.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: faq.answer,
      },
    })),
  };

  const categories = useMemo(() => {
    const seen = new Set<string>();
    for (const item of items) seen.add(itemCategory(item));
    return ['All', ...[...seen].sort((a, b) => a.localeCompare(b))];
  }, [items]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== 'All' && itemCategory(item) !== category) return false;
      if (!q) return true;
      return (
        (item.question || '').toLowerCase().includes(q) ||
        (item.answer || '').toLowerCase().includes(q)
      );
    });
  }, [items, query, category]);

  if (!items.length) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8 md:py-16 text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 bg-brand-blue/10 text-brand-blue rounded-full mb-4">
          <HelpCircle size={32} />
        </div>
        <h2 className="text-3xl font-bold text-gray-800 mb-4">Frequently Asked Questions</h2>
        <p className="text-gray-500 max-w-2xl mx-auto">
          No questions have been added yet. If you need help, please contact our support team.
        </p>
        <a
          href="/support"
          className="inline-block mt-6 bg-brand-blue hover:bg-brand-blue/90 text-white px-8 h-11 leading-[44px] rounded-full font-bold transition-all shadow-sm"
        >
          Contact Support
        </a>
      </div>
    );
  }

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: stringifyForScript(faqSchema) }}
      />
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

      <div className="relative mb-4 max-w-xl mx-auto">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search questions…"
          aria-label="Search questions"
          className="w-full h-11 pl-9 pr-3 rounded-xl border border-gray-200 text-[14px] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-brand-blue"
        />
      </div>

      {categories.length > 2 && (
        <div className="flex flex-wrap justify-center gap-2 mb-8" role="group" aria-label="Filter by category">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={`px-3 h-9 rounded-full text-[13px] font-semibold border transition-colors ${
                category === c
                  ? 'bg-brand-blue text-white border-brand-blue'
                  : 'bg-white text-gray-700 border-gray-200 hover:border-brand-blue/50'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="text-center text-gray-500 text-sm py-8">
          No questions match{query.trim() ? ` “${query.trim()}”` : ''}{category !== 'All' ? ` in ${category}` : ''}. Try a different search.
        </p>
      ) : (
        <div className="space-y-4">
          {visible.map((faq, index) => (
            <details
              key={`${faq.question}-${index}`}
              className="bg-white border rounded-xl overflow-hidden shadow-sm border-gray-100 [&[open]]:border-brand-blue/30 [&[open]]:shadow-md [&[open]]:shadow-brand-blue/5"
            >
              <summary className="w-full flex items-center justify-between p-5 md:p-6 text-left focus:outline-none cursor-pointer list-none [&::-webkit-details-marker]:none">
                <span className="font-bold text-[15px] md:text-base pr-8 text-gray-800 [details[open]_&]:text-brand-blue">
                  {faq.question}
                </span>
                <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-gray-50 text-gray-400 [details[open]_&]:bg-brand-blue/10 [details[open]_&]:text-brand-blue">
                  <ChevronDown size={18} className="[details[open]_&]:rotate-180 transition-transform" />
                </div>
              </summary>
              <div className="px-5 md:px-6 pb-6 text-gray-600 text-sm md:text-[15px] leading-relaxed border-t border-gray-50 pt-4">
                {faq.answer}
              </div>
            </details>
          ))}
        </div>
      )}

      <div className="mt-12 bg-brand-blue/5 border border-gray-100 rounded-2xl p-8 text-center">
        <h3 className="font-bold text-gray-800 text-lg mb-2">Still need help?</h3>
        <p className="text-gray-500 text-sm mb-6">Our customer support team is happy to assist you.</p>
        <a
          href="/support"
          className="inline-block bg-brand-blue hover:bg-brand-blue/90 text-white px-8 h-11 leading-[44px] rounded-full font-bold transition-all shadow-sm"
        >
          Contact Support
        </a>
      </div>
    </div>
    </>
  );
}
