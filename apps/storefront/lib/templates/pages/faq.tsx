import { HelpCircle, ChevronDown } from 'lucide-react';

export default function FaqTemplate({ config }: { config: Record<string, any> }) {
  const items = Array.isArray(config?.items) ? config.items : [];
  if (!items.length) return null;

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

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
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

      <div className="space-y-4">
        {items.map((faq, index) => (
          <details
            key={index}
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

      <div className="mt-12 bg-[#f8f9fa] border border-gray-100 rounded-2xl p-8 text-center">
        <h3 className="font-bold text-gray-800 text-lg mb-2">Still need help?</h3>
        <p className="text-gray-500 text-sm mb-6">Our customer support team is available 24/7 to assist you.</p>
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
