import { Hind_Siliguri } from "next/font/google";

// PDP mockup typeface (Hind Siliguri: Latin + Bengali in one family, so
// bilingual PDP content renders in a single matching face). Self-hosted via
// next/font with display:swap — no render-blocking external stylesheet.
//
// Scoped to this segment on purpose: this layout only wraps the PDP
// (page.tsx, colors/page.tsx and loading.tsx, which all consume
// --font-pdp), so Hind's woff2 files are preloaded/fetched only on PDP
// routes instead of on every page (previously declared in the root
// layout, which preloaded 8 files sitewide). The variable is applied on
// a plain wrapper <div>: it is a block box whose height is exactly its
// content, the same box the PDP root was before relative to <main>, so
// rendering is unchanged — only the load scope changed.
//
// Weights: all four are genuinely used inside the PDP subtree
// (400 = default body text / font-normal, 500 = font-medium,
// 600 = font-semibold, 700 = font-bold across ProductDetailClient and
// components/pdp/*), and both subsets are needed for bilingual content,
// so no weight/subset trim is possible without a visual change.
const hindSiliguri = Hind_Siliguri({
  variable: "--font-pdp",
  subsets: ["latin", "bengali"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export default function ProductDetailLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className={hindSiliguri.variable}>{children}</div>;
}
