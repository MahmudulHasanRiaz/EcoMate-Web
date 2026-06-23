// Minimal layout for landing pages — no app header/footer/JS
import LandingFooter from "@/components/landing/LandingFooter";

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <LandingFooter />
    </>
  );
}
