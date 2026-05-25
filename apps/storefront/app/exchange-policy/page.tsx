import type { Metadata } from "next";
import { ArrowRightLeft, PackageCheck, Truck, ShieldAlert } from 'lucide-react';

export const metadata: Metadata = {
  title: "Exchange Policy — Fixed Plus",
  description: "Learn about Fixed Plus easy exchange policy. Hassle-free returns and exchanges within 24 hours of delivery.",
};

export default function ExchangePolicyPage() {
  return (
    <div className="bg-white min-h-screen">
      {/* Header */}
      <div className="bg-brand-blue/5 py-20 md:py-32 overflow-hidden relative">
        <div className="absolute top-0 right-0 w-96 h-96 bg-brand-blue/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="max-w-4xl mx-auto px-4 relative z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-brand-blue text-white text-[10px] font-bold rounded-full uppercase tracking-wider mb-8">
            <ArrowRightLeft size={12} />
            Hassle Free
          </div>
          <h1 className="text-4xl md:text-7xl font-black text-gray-900 mb-8 leading-tight">
            Exchange <br /><span className="text-brand-blue">Simplified.</span>
          </h1>
          <p className="text-gray-600 text-lg md:text-xl max-w-xl leading-relaxed">
            Ordered the wrong size or changed your mind? We&apos;ve got you covered with our easy exchange policy.
          </p>
        </div>
      </div>

      {/* Steps Section */}
      <section className="max-w-6xl mx-auto px-4 -mt-16 relative z-20 pb-24">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <StepCard 
            icon={<PackageCheck size={32} />}
            title="Request Exchange"
            description="Contact our support within 24 hours of delivery to initiate the process."
          />
          <StepCard 
            icon={<Truck size={32} />}
            title="Return Shipping"
            description="Our courier will pick up the item or you can ship it back to our hub."
          />
          <StepCard 
            icon={<ShieldAlert size={32} />}
            title="Quality Check"
            description="We inspect the returned item to ensure it's in original condition."
          />
        </div>

        <div className="mt-24 grid grid-cols-1 md:grid-cols-2 gap-16 items-center">
          <div>
            <h2 className="text-3xl font-bold mb-8">Exchange Conditions</h2>
            <div className="space-y-6">
              <ConditionItem title="Original Packaging" desc="The item must be returned in its original Fixed Plus packaging." />
              <ConditionItem title="Proof of Purchase" desc="A valid order ID or paper invoice must be presented." />
              <ConditionItem title="Non-Food Items" desc="Food items can only be exchanged if damaged; non-food items follow standard rules." />
              <ConditionItem title="Shipping Costs" desc="Standard shipping charges apply for exchanges unless the error was on our part." />
            </div>
          </div>
          <div className="bg-gray-100 rounded-[40px] aspect-square flex items-center justify-center p-12">
            <div className="relative w-full h-full border-2 border-dashed border-gray-300 rounded-[32px] flex flex-col items-center justify-center text-center p-8">
               <ArrowRightLeft size={64} className="text-brand-blue mb-6 animate-pulse" />
               <p className="text-gray-500 font-medium italic">&ldquo;We believe a happy customer is a returning customer.&rdquo;</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function StepCard({ icon, title, description }: { icon: any, title: string, description: string }) {
  return (
    <div className="bg-white p-8 rounded-[32px] shadow-2xl shadow-gray-200 border border-gray-50 flex flex-col items-center text-center">
      <div className="w-16 h-16 bg-brand-blue text-white rounded-2xl flex items-center justify-center mb-6 shadow-xl shadow-brand-blue/20">
        {icon}
      </div>
      <h3 className="font-bold text-gray-900 text-lg mb-3">{title}</h3>
      <p className="text-gray-500 text-sm leading-relaxed">{description}</p>
    </div>
  );
}

function ConditionItem({ title, desc }: { title: string, desc: string }) {
  return (
    <div className="flex gap-4">
      <div className="w-5 h-5 rounded-full bg-brand-blue/10 border border-brand-blue/20 flex items-center justify-center shrink-0 mt-1">
        <div className="w-1.5 h-1.5 rounded-full bg-brand-blue" />
      </div>
      <div>
        <h4 className="font-bold text-gray-800 mb-1">{title}</h4>
        <p className="text-gray-500 text-sm">{desc}</p>
      </div>
    </div>
  );
}
