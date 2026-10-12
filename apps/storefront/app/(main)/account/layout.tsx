import type { Metadata } from "next";

// Private page: keep out of the index (robots.txt disallow is the backup).
export const metadata: Metadata = { robots: { index: false, follow: true } };

export default function PrivateLayout({ children }: { children: React.ReactNode }) {
  return children;
}
