import { Building2, Award, Users2, Rocket } from 'lucide-react';
import Image from 'next/image';
import { resolveDerivativeUrl } from "@/lib/image-derivative";
import { hasText } from "../content-utils";
import type { PageMeta } from "../content-utils";
import { TemplateEmptyState } from "../shared";

export default function CompanyTemplate({
  config,
  storeName,
}: {
  config: Record<string, any>;
  storeName?: string;
  pageMeta?: PageMeta;
}) {
  // Brand name binds to real store settings (passed in by
  // renderPreFormattedPage) — never a literal fallback here.
  const brandName = (storeName || "").trim();
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : "");
  const name = str(config?.name);
  const registration = str(config?.registration);
  const certifications = str(config?.certifications);
  const teamSize = str(config?.teamSize);
  const ceoName = str(config?.ceoName);
  const established = str(config?.established);
  const tagline = str(config?.tagline);
  const philosophy = str(config?.philosophy);
  const vision = str(config?.vision);
  const impact = str(config?.impact);
  const image = config?.image
    ? resolveDerivativeUrl(config?._mediaMeta, config.image, 'large')
    : "";

  // Matches templateHasRealContent('company', config): an unconfigured page
  // shows the honest empty state instead of invented corporate facts.
  const hasContent =
    hasText(name) ||
    hasText(registration) ||
    hasText(certifications) ||
    hasText(teamSize) ||
    hasText(ceoName) ||
    hasText(established) ||
    hasText(tagline) ||
    hasText(philosophy) ||
    hasText(vision) ||
    hasText(impact) ||
    hasText(image);

  if (!hasContent) {
    return (
      <TemplateEmptyState
        title="Company"
        message="Company details haven't been added yet. Please check back soon."
      />
    );
  }

  const tiles = [
    { icon: <Building2 />, title: "Corporate Name", val: name },
    { icon: <Rocket />, title: "Reg. Number", val: registration },
    { icon: <Award />, title: "Certifications", val: certifications },
    { icon: <Users2 />, title: "Team Size", val: teamSize },
  ].filter((t) => hasText(t.val));

  return (
    <div className="bg-white min-h-screen">
      {/* Editorial Split Header — capped height; the image shows cropped on
          mobile instead of being hidden behind a full-screen dark panel. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 min-h-[420px] md:min-h-[560px] max-h-[800px]">
        <div className="bg-brand-dark p-12 md:p-24 flex flex-col justify-center">
           {established && (
             <div className="text-[10px] font-bold text-brand-blue uppercase tracking-[0.4em] mb-12">Established {established}</div>
           )}
           {brandName && (
             <h1 className="text-6xl md:text-[100px] font-black text-white leading-[0.85] tracking-tighter mb-12 break-words">
                {brandName.toUpperCase()}
             </h1>
           )}
           {tagline && (
             <p className="text-gray-400 text-lg max-w-sm border-l-2 border-brand-blue pl-6 leading-relaxed">
               {tagline}
             </p>
           )}
        </div>
        {image ? (
          <div className="relative overflow-hidden h-64 sm:h-80 lg:h-auto">
             <Image
                src={image}
                fill
                sizes="50vw"
                className="object-cover"
                alt={brandName || name || "Office"}
              />
             <div className="absolute inset-0 bg-brand-blue/10 mix-blend-multiply" />
          </div>
        ) : (
          <div className="hidden lg:block bg-gray-50" aria-hidden="true" />
        )}
      </div>

      {/* Corporate Details */}
      <section className="max-w-7xl mx-auto px-4 py-24">
        {tiles.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12">
              {tiles.map((t) => (
                <InfoTile key={t.title} icon={t.icon} title={t.title} val={t.val} />
              ))}
          </div>
        )}

        {(philosophy || ceoName || vision || impact) && (
          <div className="mt-32 grid grid-cols-1 lg:grid-cols-12 gap-16">
             <div className="lg:col-span-5">
                {philosophy && (
                  <>
                    <h2 className="text-4xl font-bold tracking-tight mb-8">Management Philosophy</h2>
                    <p className="text-gray-600 leading-relaxed mb-6">
                      {philosophy}
                    </p>
                  </>
                )}
                {ceoName && (
                  <div className="flex items-center gap-6 mt-12 bg-gray-50 p-6 rounded-2xl border-l-4 border-brand-blue">
                     <div className="shrink-0 w-16 h-16 rounded-full bg-brand-blue/10 text-brand-blue overflow-hidden flex items-center justify-center font-black text-2xl">
                        {image ? (
                          <Image src={image} alt={ceoName} width={64} height={64} className="w-full h-full object-cover" />
                        ) : (
                          ceoName.charAt(0).toUpperCase()
                        )}
                     </div>
                     <div>
                         <p className="font-bold text-gray-900">{ceoName}</p>
                        <p className="text-sm text-gray-500">Founder & CEO</p>
                     </div>
                  </div>
                )}
             </div>
             {(vision || impact) && (
               <div className="lg:col-span-7 grid grid-cols-2 gap-4">
                  {vision && (
                    <div className="bg-gray-900 rounded-[32px] p-8 text-white h-64 flex flex-col justify-end">
                       <p className="text-xs uppercase tracking-widest text-brand-blue mb-2">Vision</p>
                       <h3 className="text-xl font-bold">{vision}</h3>
                    </div>
                  )}
                  {impact && (
                    <div className="bg-brand-coral rounded-[32px] p-8 text-white h-64 flex flex-col justify-end">
                       <p className="text-xs uppercase tracking-widest opacity-60 mb-2">Impact</p>
                       <h3 className="text-xl font-bold">{impact}</h3>
                    </div>
                  )}
               </div>
             )}
          </div>
        )}
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
