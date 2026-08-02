import Image from "next/image";
import { Briefcase, MapPin, Clock, DollarSign, ArrowRight } from "lucide-react";
import { PLACEHOLDER_IMAGE } from "@/lib/constants";

interface Job {
  title?: string;
  department?: string;
  location?: string;
  type?: string;
  salary?: string;
  description?: string;
}

export default function CareersTemplate({ config }: { config: Record<string, any> }) {
  const hero = config?.hero || {};
  const jobs: Job[] = Array.isArray(config?.jobs) ? config.jobs : [];
  const benefits: string[] = Array.isArray(config?.benefits) ? config.benefits : [];
  const application = config?.application || {};

  const heroTitle = (hero.title || "").trim();
  const heroWords = heroTitle.split(/\s+/).filter(Boolean);
  const splitTitle = heroWords.length > 1;
  const firstLine = splitTitle ? heroWords.slice(0, -1).join(" ") : heroTitle;
  const secondLine = splitTitle ? heroWords[heroWords.length - 1] : "";

  const heroImage = (hero.image || "").trim();
  const subtitle =
    hero.subtitle ||
    "Join a team that cares about health, authenticity, and the growth of Bangladeshi agriculture.";

  const applyEmail = (application.email || "").trim();
  const applyHref = applyEmail ? `mailto:${applyEmail}` : "#";
  const ctaText = application.ctaText || "Send Spontaneous CV";

  return (
    <div className="bg-white min-h-screen">
      {/* Brutalist Hero */}
      <section className="bg-white pt-24 pb-16 border-b-2 border-black px-4">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-end gap-12">
          <div className="md:w-3/4">
            <div className="inline-block bg-black text-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.3em] mb-8">Careers</div>
            <h1 className="text-6xl md:text-[140px] font-black text-gray-900 leading-[0.8] tracking-tighter">
              {splitTitle ? (
                <>
                  {firstLine} <br />
                  <span className="text-brand-blue">{secondLine}</span>
                </>
              ) : (
                <span className="text-brand-blue">{heroTitle}</span>
              )}
            </h1>
          </div>
          <div className="md:w-1/4 pb-4">
            <div className="w-20 h-20 bg-brand-blue rounded-full flex items-center justify-center text-white rotate-12 mb-6 overflow-hidden">
              {heroImage ? (
                <Image
                  src={heroImage || PLACEHOLDER_IMAGE}
                  alt={heroTitle || "Careers"}
                  width={80}
                  height={80}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Briefcase size={32} />
              )}
            </div>
            <p className="text-gray-500 text-sm font-medium leading-relaxed italic">
              {subtitle}
            </p>
          </div>
        </div>
      </section>

      {/* Benefits */}
      {benefits.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 py-20 border-b border-gray-100">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 md:gap-4">
            {benefits.map((text, i) => (
              <Benefit key={i} text={text} />
            ))}
          </div>
        </section>
      )}

      {/* Jobs List */}
      <section className="max-w-5xl mx-auto px-4 py-24">
        {jobs.length > 0 && (
          <>
            <h2 className="text-3xl font-bold mb-16 text-center">Current Openings</h2>
            <div className="space-y-6">
              {jobs.map((job, idx) => (
                <div
                  key={idx}
                  className="group border border-gray-100 bg-gray-50/50 p-8 rounded-[32px] hover:bg-white hover:shadow-2xl hover:shadow-gray-200 transition-all duration-500 cursor-pointer flex flex-col md:flex-row md:items-center justify-between gap-8"
                >
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-brand-blue mb-2">{job.department}</p>
                    <h3 className="text-2xl font-bold text-gray-900 mb-6 group-hover:text-brand-blue transition-colors">{job.title}</h3>
                    <div className="flex flex-wrap items-center gap-6 text-gray-400 text-xs font-medium">
                      <span className="flex items-center gap-2"><MapPin size={14} /> {job.location}</span>
                      <span className="flex items-center gap-2"><Clock size={14} /> {job.type}</span>
                      <span className="flex items-center gap-2"><DollarSign size={14} /> {job.salary}</span>
                    </div>
                  </div>
                  <button className="w-14 h-14 bg-gray-200 rounded-full flex items-center justify-center group-hover:bg-black group-hover:text-white transition-all">
                    <ArrowRight size={24} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        <div className={jobs.length > 0 ? "mt-24 text-center" : "text-center"}>
          <p className="text-gray-500 mb-8">Don&apos;t see a role that fits? We&apos;re always looking for talent.</p>
          <a href={applyHref} className="bg-black text-white px-12 py-4 rounded-full font-bold hover:scale-105 transition-transform shadow-xl">
            {ctaText}
          </a>
        </div>
      </section>
    </div>
  );
}

function Benefit({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center gap-4 group">
      <div className="w-2 h-2 rounded-full bg-gray-200 group-hover:bg-brand-blue group-hover:scale-150 transition-all" />
      <span className="text-xs font-bold uppercase tracking-widest text-gray-600 group-hover:text-black transition-colors">{text}</span>
    </div>
  );
}
