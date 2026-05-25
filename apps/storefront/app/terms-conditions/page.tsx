import type { Metadata } from "next";
import { FileText, Gavel, Scale, AlertCircle } from 'lucide-react';
import { pageMetadata } from "@/lib/metadata";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata("Terms & Conditions", "Read the Terms of Service for using {store}. Understand your rights and obligations when using our platform.");
}

export default async function TermsConditionsPage() {
  let storeName = "Store";
  try { const c = await getStorefrontConfigServer(); storeName = c.store.name; } catch {}

  return (
    <div className="bg-amber-50/30 min-h-screen pb-24">
      {/* Editorial Header */}
      <div className="max-w-7xl mx-auto px-4 pt-20 pb-16 border-b border-gray-200">
         <div className="flex flex-col md:flex-row md:items-end justify-between gap-8">
            <h1 className="text-6xl md:text-[120px] font-black text-gray-900 leading-[0.8] tracking-tighter">
              TERMS <br /><span className="text-brand-blue opacity-80">OF SERVICE.</span>
            </h1>
            <div className="md:w-64 pb-4">
               <p className="text-xs font-bold uppercase tracking-widest text-brand-blue mb-2 flex items-center gap-2">
                 <Scale size={14} /> Legal Agreement
               </p>
               <p className="text-gray-500 text-[11px] leading-relaxed italic">
                  By using {storeName}, you agree to follow these rules and regulations which ensure a safe marketplace for everyone.
               </p>
            </div>
         </div>
      </div>

      {/* Grid Content */}
      <div className="max-w-7xl mx-auto px-4 mt-20">
         <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
            <div className="lg:col-span-4">
               <div className="sticky top-24 space-y-4">
                  <SidebarLink number="01" label="Operating Entities" active />
                  <SidebarLink number="02" label="Product Availability" />
                  <SidebarLink number="03" label="Pricing & Payments" />
                  <SidebarLink number="04" label="Delivery Conditions" />
                  <SidebarLink number="05" label="Liabilities" />
               </div>
            </div>

            <div className="lg:col-span-8">
               <div className="prose prose-gray prose-lg max-w-none text-gray-600">
                  <h3 className="text-2xl font-bold text-gray-900 mb-6">1. Acceptance of Terms</h3>
                  <p className="mb-8">
                    FIXED PLUS LTD provides its service to you, subject to the following Terms of Service, which may be updated by us from time to time without notice to you. You can review the most current version of the Terms of Service at any time on this page.
                  </p>

                  <h3 className="text-2xl font-bold text-gray-900 mb-6">2. Product Authenticity</h3>
                  <p className="mb-8">
                    We guarantee the authenticity of our signature items including pure honey, ghee, and organic oils. However, as these are natural products, seasonal variations in color, texture, and taste are normal and do not qualify as defects.
                  </p>

                  <h3 className="text-2xl font-bold text-gray-900 mb-6">3. Use of Website</h3>
                  <p className="mb-8">
                    You may use the website for personal, non-commercial purposes only. Any unauthorized use of automated systems or software to extract data from this website for commercial purposes (&apos;screen scraping&apos;) is strictly prohibited.
                  </p>

                  <div className="bg-white p-10 rounded-[32px] border border-gray-200 mt-16 shadow-sm">
                     <h4 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
                        <AlertCircle className="text-brand-blue" size={20} />
                        Termination of Service
                     </h4>
                     <p className="text-[15px] leading-relaxed">
                        We reserve the right to refuse service to anyone for any reason at any time. We may also, in our sole discretion, change or discontinue any aspect, service or feature of the website, including, but not limited to, content, hours of availability, and equipment needed for access or use.
                     </p>
                  </div>
               </div>
            </div>
         </div>
      </div>
    </div>
  );
}

function SidebarLink({ number, label, active }: { number: string, label: string, active?: boolean }) {
  return (
    <button className={`w-full flex items-center gap-6 p-4 rounded-2xl transition-all ${active ? 'bg-white shadow-xl shadow-gray-200/50' : 'hover:bg-white/50 grayscale opacity-60 hover:grayscale-0 hover:opacity-100'}`}>
       <span className="font-mono text-xs font-bold text-brand-blue">{number}</span>
       <span className={`text-sm font-bold tracking-tight ${active ? 'text-gray-900' : 'text-gray-500'}`}>{label}</span>
       {active && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-blue" />}
    </button>
  );
}
