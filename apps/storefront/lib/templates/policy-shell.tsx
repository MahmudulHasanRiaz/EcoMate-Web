import type { ReactNode } from "react";
import type { PageMeta } from "./content-utils";
import { formatPageDate } from "./content-utils";

/**
 * The ONE shared shell for the policy templates (terms, privacy, refund,
 * exchange, shipping). One header treatment (eyebrow + title + optional
 * intro) and one last-updated treatment, so the five pages stop drifting
 * into five visual languages. Each template keeps its own content structure
 * inside; only the chrome is shared.
 *
 * Last-updated comes from the CmsPage row (pageMeta), never from hardcoded
 * copy: `updatedAt` is the date, `effectiveDate` is shown when the admin
 * set one, and `version` is shown when present.
 */
export function PolicyShell({
  title,
  eyebrow,
  intro,
  pageMeta,
  variant = "light",
  wide = false,
  children,
}: {
  title: string;
  eyebrow?: string;
  intro?: string;
  pageMeta?: PageMeta;
  variant?: "light" | "dark";
  /** Wider (7xl) container for templates with a sidebar/grid layout. */
  wide?: boolean;
  children: ReactNode;
}) {
  const dark = variant === "dark";
  const updated = formatPageDate(pageMeta?.updatedAt);
  const effective = formatPageDate(pageMeta?.effectiveDate);
  const version = pageMeta?.version;

  return (
    <div
      className={
        dark
          ? "bg-brand-dark min-h-screen text-white pb-24"
          : "bg-white min-h-screen pb-24"
      }
    >
      <div className={`${wide ? "max-w-7xl" : "max-w-4xl"} mx-auto px-4 pt-16 md:pt-24`}>
        {eyebrow && (
          <p
            className={`text-[11px] font-bold uppercase tracking-[0.3em] mb-6 ${
              dark ? "text-brand-blue" : "text-brand-blue"
            }`}
          >
            {eyebrow}
          </p>
        )}
        <h1
          className={`text-4xl md:text-5xl font-black tracking-tight leading-[1.05] mb-6 ${
            dark ? "text-white" : "text-gray-900"
          }`}
        >
          {title}
        </h1>
        {intro && (
          <p
            className={`text-lg leading-relaxed max-w-2xl mb-4 ${
              dark ? "text-gray-400" : "text-gray-500"
            }`}
          >
            {intro}
          </p>
        )}
        <div className="h-1 w-24 bg-brand-blue mb-12" />
        {children}
        {(updated || effective || version) && (
          <div
            className={`mt-16 pt-6 border-t text-[12px] ${
              dark
                ? "border-white/10 text-gray-500"
                : "border-gray-100 text-gray-400"
            }`}
          >
            {updated && <span>Last updated: {updated}</span>}
            {effective && <span> · Effective: {effective}</span>}
            {version ? <span> · Version {version}</span> : null}
          </div>
        )}
      </div>
    </div>
  );
}
