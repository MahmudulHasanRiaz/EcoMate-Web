import { Hind_Siliguri } from "next/font/google";
import LandingFooter from "@/components/landing/LandingFooter";

const hindSiliguri = Hind_Siliguri({
  weight: ["300", "400", "500", "600", "700"],
  subsets: ["bengali", "latin"],
  variable: "--font-hind-siliguri",
});

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${hindSiliguri.variable} font-sans`}>
      {children}
      <LandingFooter />
    </div>
  );
}
