"use client";

export default function LandingCustomRenderer({
  html,
  css,
}: {
  html: string;
  css?: string | null;
}) {
  return (
    <>
      {css && (
        <style dangerouslySetInnerHTML={{ __html: css }} />
      )}
      <div
        className="landing-custom-content"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  );
}
