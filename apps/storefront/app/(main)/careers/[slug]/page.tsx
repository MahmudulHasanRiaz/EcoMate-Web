import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, MapPin, Clock, DollarSign, CalendarDays, Briefcase } from "lucide-react";
import { getCmsPageBySlug } from "@/lib/api/cms-pages";
import { formatJobSalary, getJobBySlug } from "@/lib/api/jobs";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";
import { hasLicenseFeature } from "@/lib/api/storefront-config";
import { pageMetadata } from "@/lib/metadata";
import ApplyForm from "./apply-form";

export const revalidate = 300;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const job = await getJobBySlug(slug).catch(() => null);
  if (!job) return pageMetadata("Role Not Found", "This role is no longer available.");
  return pageMetadata(job.title, `${job.title} — ${job.location} · ${job.employmentType}`);
}

export default async function CareerDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const job = await getJobBySlug(slug).catch(() => null);
  if (!job) notFound();

  const cms = await getCmsPageBySlug("careers").catch(() => null);
  const applyEmail = ((cms?.config as Record<string, any> | null)?.application?.email || "").trim();
  const storefrontConfig = await getStorefrontConfigServer().catch(() => ({ licenseFeatures: [] as string[] }));
  const canApply = hasLicenseFeature(storefrontConfig, 'admin_hr_careers');
  const salary = formatJobSalary(job);

  return (
    <div className="bg-white min-h-screen">
      <section className="max-w-5xl mx-auto px-4 pt-24 pb-16">
        <Link href="/careers" className="inline-flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-brand-blue mb-8">
          <ArrowLeft size={16} /> All openings
        </Link>

        {job.department?.name && (
          <p className="text-[10px] font-bold uppercase tracking-widest text-brand-blue mb-2">{job.department.name}</p>
        )}
        <h1 className="text-4xl md:text-5xl font-black text-gray-900 tracking-tight mb-6">{job.title}</h1>

        <div className="flex flex-wrap items-center gap-6 text-gray-500 text-sm font-medium mb-12">
          <span className="flex items-center gap-2"><MapPin size={16} /> {job.location}</span>
          <span className="flex items-center gap-2"><Clock size={16} /> {job.employmentType}</span>
          {salary && (
            <span className="flex items-center gap-2"><DollarSign size={16} /> {salary}</span>
          )}
          {job.designation?.name && (
            <span className="flex items-center gap-2"><Briefcase size={16} /> {job.designation.name}</span>
          )}
          {job.deadline && (
            <span className="flex items-center gap-2">
              <CalendarDays size={16} /> Apply by {new Date(job.deadline).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}
            </span>
          )}
        </div>

        <div className="space-y-10">
          <section>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">About the role</h2>
            <p className="whitespace-pre-line text-gray-600 leading-relaxed">{job.description}</p>
          </section>

          {job.responsibilities && (
            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Responsibilities</h2>
              <p className="whitespace-pre-line text-gray-600 leading-relaxed">{job.responsibilities}</p>
            </section>
          )}

          {job.requirements && (
            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Requirements</h2>
              <p className="whitespace-pre-line text-gray-600 leading-relaxed">{job.requirements}</p>
            </section>
          )}

          {job.benefits && job.benefits.length > 0 && (
            <section>
              <h2 className="text-2xl font-bold text-gray-900 mb-4">Benefits</h2>
              <ul className="grid gap-3 sm:grid-cols-2">
                {job.benefits.map((benefit, i) => (
                  <li key={i} className="flex items-start gap-3 rounded-2xl border border-gray-100 bg-gray-50/50 px-4 py-3 text-sm font-medium text-gray-700">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-blue" />
                    {benefit}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section id="apply">
            {canApply ? (
              <ApplyForm slug={job.slug} />
            ) : applyEmail ? (
              <div className="rounded-[32px] border border-gray-100 bg-gray-50/50 p-8 text-center">
                <h2 className="text-2xl font-bold text-gray-900 mb-3">Interested in this role?</h2>
                <p className="text-gray-500 mb-8">Send your CV to us directly and we will get in touch.</p>
                <a
                  href={`mailto:${applyEmail}?subject=${encodeURIComponent(`Application: ${job.title}`)}`}
                  className="inline-block rounded-full bg-black px-12 py-4 font-bold text-white shadow-xl transition-transform hover:scale-105"
                >
                  Email Your CV
                </a>
              </div>
            ) : (
              <div className="rounded-[32px] border border-gray-100 bg-gray-50/50 p-8 text-center">
                <h2 className="text-2xl font-bold text-gray-900 mb-3">Interested in this role?</h2>
                <p className="text-gray-500">Applications for this role are not open right now. Please check back soon.</p>
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
