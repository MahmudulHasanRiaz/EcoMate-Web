import LandingFooter from "@/components/landing/LandingFooter";

// Landing pages use only the shared root fonts (Geist via `font-sans`).
// This layout previously declared a second Hind_Siliguri instance
// (--font-hind-siliguri, 5 weights × 2 subsets), but that variable was
// never referenced anywhere in the landing subtree — the wrapper only
// ever applied `font-sans` — so the duplicate preloaded up to 10 extra
// woff2 files with zero visual effect. Removed; rendering is unchanged.
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-sans">
      {children}
      <LandingFooter />
    </div>
  );
}
