import { Building2, Award, Users2, Rocket } from 'lucide-react';
import Image from 'next/image';
import { PLACEHOLDER_IMAGE } from "@/lib/constants";

const DEFAULTS = {
  name: "Store Limited",
  registration: "C-182394/2021",
  certifications: "BSTI Certified",
  teamSize: "150+ Experts",
  ceoName: "Mahmud Riaz",
  established: "2024",
  philosophy:
    "At Store, we believe that transparency is the bedrock of trust. From the early stages of development to the final product delivery, we manage every step with integrity.",
  vision: "Empowering millions through cutting-edge technology and reliable services.",
  impact: "Simplifying complex technology for the modern Bangladeshi household.",
};

export default function CompanyTemplate({ config }: { config: Record<string, any> }) {
  // The hero previously read the store brand name from the storefront config
  // (store-wide Settings). This page template is self-contained, so use the
  // literal fallback that page already used.
  const brandName = "Store";
  const name = String(config?.name || DEFAULTS.name).trim();
  const registration = String(config?.registration || DEFAULTS.registration).trim();
  const certifications = String(config?.certifications || DEFAULTS.certifications).trim();
  const teamSize = String(config?.teamSize || DEFAULTS.teamSize).trim();
  const ceoName = String(config?.ceoName || DEFAULTS.ceoName).trim();
  const established = String(config?.established || DEFAULTS.established).trim();
  const philosophy = String(config?.philosophy || DEFAULTS.philosophy).trim();
  const vision = String(config?.vision || DEFAULTS.vision).trim();
  const impact = String(config?.impact || DEFAULTS.impact).trim();
  const image = config?.image || PLACEHOLDER_IMAGE;

  return (
    <div className="bg-white min-h-screen">
      {/* Editorial Split Header */}
      <div className="grid grid-cols-1 lg:grid-cols-2 h-screen max-h-[800px]">
        <div className="bg-[#1a1a1a] p-12 md:p-24 flex flex-col justify-center">
           <div className="text-[10px] font-bold text-brand-blue uppercase tracking-[0.4em] mb-12">Established {established}</div>
           <h1 className="text-6xl md:text-[100px] font-black text-white leading-[0.85] tracking-tighter mb-12">
              {brandName.toUpperCase().split(" ")[0]} <br /><span className="text-brand-blue">{brandName.toUpperCase().split(" ").slice(1).join(" ") || "PLUS"}</span>
           </h1>
           <p className="text-gray-400 text-lg max-w-sm border-l-2 border-brand-blue pl-6 leading-relaxed">
             A technology-driven ecosystem dedicated to innovation, efficiency, and sustainability.
           </p>
        </div>
        <div className="relative overflow-hidden hidden lg:block">
           <Image
              src={image}
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
            <InfoTile icon={<Building2 />} title="Corporate Name" val={name} />
            <InfoTile icon={<Rocket />} title="Reg. Number" val={registration} />
            <InfoTile icon={<Award />} title="Certifications" val={certifications} />
            <InfoTile icon={<Users2 />} title="Team Size" val={teamSize} />
        </div>

        <div className="mt-32 grid grid-cols-1 lg:grid-cols-12 gap-16">
           <div className="lg:col-span-5">
              <h2 className="text-4xl font-bold tracking-tight mb-8">Management Philosophy</h2>
              <p className="text-gray-600 leading-relaxed mb-6">
                {philosophy}
              </p>
              <div className="flex items-center gap-6 mt-12 bg-gray-50 p-6 rounded-2xl border-l-4 border-brand-blue">
                 <div className="shrink-0 w-16 h-16 rounded-full bg-gray-200 overflow-hidden">
                    <Image src={image} alt="CEO" width={64} height={64} className="w-full h-full object-cover" />
                 </div>
                 <div>
                     <p className="font-bold text-gray-900">{ceoName}</p>
                    <p className="text-sm text-gray-500">Founder & CEO</p>
                 </div>
              </div>
           </div>
           <div className="lg:col-span-7 grid grid-cols-2 gap-4">
              <div className="bg-gray-900 rounded-[32px] p-8 text-white h-64 flex flex-col justify-end">
                 <p className="text-xs uppercase tracking-widest text-brand-blue mb-2">Vision</p>
                 <h3 className="text-xl font-bold">{vision}</h3>
              </div>
              <div className="bg-brand-coral rounded-[32px] p-8 text-white h-64 flex flex-col justify-end">
                 <p className="text-xs uppercase tracking-widest opacity-60 mb-2">Impact</p>
                 <h3 className="text-xl font-bold">{impact}</h3>
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
