import type { Metadata } from "next";
import { Building2, Award, Users2, Rocket } from 'lucide-react';
import Image from 'next/image';
import { pageMetadata } from "@/lib/metadata";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import { PLACEHOLDER_IMAGE } from "@/lib/constants";

export async function generateMetadata(): Promise<Metadata> {
  return pageMetadata("Company", "Learn about {store} — our management philosophy, certifications, team, and vision for the future.");
}

export default async function CompanyPage() {
  let storeName = "Store";
  let company = { registration: "C-182394/2021", certifications: "BSTI Certified", teamSize: "150+ Experts", ceoName: "Mahmud Riaz" };
  try { const c = await getStorefrontConfigServer(); storeName = c.store.name; company = { ...company, ...c.company }; } catch {}
  return (
    <div className="bg-white min-h-screen">
      {/* Editorial Split Header */}
      <div className="grid grid-cols-1 lg:grid-cols-2 h-screen max-h-[800px]">
        <div className="bg-[#1a1a1a] p-12 md:p-24 flex flex-col justify-center">
           <div className="text-[10px] font-bold text-brand-blue uppercase tracking-[0.4em] mb-12">Established 2024</div>
           <h1 className="text-6xl md:text-[100px] font-black text-white leading-[0.85] tracking-tighter mb-12">
              {storeName.toUpperCase().split(" ")[0]} <br /><span className="text-brand-blue">{storeName.toUpperCase().split(" ").slice(1).join(" ") || "PLUS"}</span>
           </h1>
           <p className="text-gray-400 text-lg max-w-sm border-l-2 border-brand-blue pl-6 leading-relaxed">
             A technology-driven ecosystem dedicated to innovation, efficiency, and sustainability.
           </p>
        </div>
        <div className="relative overflow-hidden hidden lg:block">
           <Image 
              src={PLACEHOLDER_IMAGE}
              fill
              sizes="50vw"
              className="object-cover" 
              alt="Office" 
            />
           <div className="absolute inset-0 bg-brand-blue/10 mix-blend-multiply" />
        </div>
      </div>

      {/* Corporate Details */}
      <section className="max-w-7xl mx-auto px-4 py-24">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
            <InfoTile icon={<Building2 />} title="Corporate Name" val={storeName + " Limited"} />
            <InfoTile icon={<Rocket />} title="Reg. Number" val={company.registration} />
            <InfoTile icon={<Award />} title="Certifications" val={company.certifications} />
            <InfoTile icon={<Users2 />} title="Team Size" val={company.teamSize} />
        </div>

        <div className="mt-32 grid grid-cols-1 lg:grid-cols-12 gap-16">
           <div className="lg:col-span-5">
              <h2 className="text-4xl font-bold tracking-tight mb-8">Management Philosophy</h2>
              <p className="text-gray-600 leading-relaxed mb-6">
                At {storeName}, we believe that transparency is the bedrock of trust. From the early stages of development to the final product delivery, we manage every step with integrity.
              </p>
              <div className="flex items-center gap-6 mt-12 bg-gray-50 p-6 rounded-2xl border-l-4 border-brand-blue">
                 <div className="shrink-0 w-16 h-16 rounded-full bg-gray-200 overflow-hidden">
                    <Image src={PLACEHOLDER_IMAGE} alt="CEO" width={64} height={64} className="w-full h-full object-cover" />
                 </div>
                 <div>
                     <p className="font-bold text-gray-900">{company.ceoName || "Mahmud Riaz"}</p>
                    <p className="text-sm text-gray-500">Founder & CEO</p>
                 </div>
              </div>
           </div>
           <div className="lg:col-span-7 grid grid-cols-2 gap-4">
              <div className="bg-gray-900 rounded-[32px] p-8 text-white h-64 flex flex-col justify-end">
                 <p className="text-xs uppercase tracking-widest text-brand-blue mb-2">Vision</p>
                 <h3 className="text-xl font-bold">Empowering millions through cutting-edge technology and reliable services.</h3>
              </div>
              <div className="bg-brand-coral rounded-[32px] p-8 text-white h-64 flex flex-col justify-end">
                 <p className="text-xs uppercase tracking-widest opacity-60 mb-2">Impact</p>
                 <h3 className="text-xl font-bold">Simplifying complex technology for the modern Bangladeshi household.</h3>
              </div>
           </div>
        </div>
      </section>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function InfoTile({ icon, title, val }: { icon: any, title: string, val: string }) {
  return (
    <div className="group border-b border-gray-100 pb-8 hover:border-brand-blue transition-colors">
       <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center text-brand-blue mb-6 group-hover:scale-110 transition-transform">
          {icon}
       </div>
       <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">{title}</p>
       <p className="text-lg font-bold text-gray-900">{val}</p>
    </div>
  );
}
