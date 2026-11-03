"use client";

// P5 (JS diet): tiny client island that preserves the Footer's historical
// behaviour of not rendering on /checkout, now that Footer itself is a
// Server Component and can no longer call usePathname().

import { usePathname } from "next/navigation";

export default function HideOnCheckout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  if (pathname && pathname.startsWith("/checkout")) return null;
  return <>{children}</>;
}
