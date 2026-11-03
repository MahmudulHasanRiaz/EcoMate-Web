/**
 * P2: section-shaped Suspense fallback for homepage product sections.
 * Mirrors ProductSection's chrome (section padding, title bar, 2/4-col
 * grid) with pulse placeholders — shown only while that section's data
 * streams in; the resolved section replaces it with identical layout.
 * Kept local to the homepage (a sibling perf branch introduces shared
 * skeletons app-wide; this file is the merge-time alignment point —
 * it should be folded into that shared set when both land).
 */
export default function ProductSectionSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <section className="py-10 md:py-14 bg-white border-b border-gray-50" aria-hidden="true">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex items-center justify-between mb-8 md:mb-10 relative">
          <div className="relative pb-3">
            <div className="h-6 md:h-7 w-44 bg-gray-100 rounded animate-pulse" />
            <div className="absolute bottom-0 left-0 w-20 h-[4px] bg-gray-100 rounded-full" />
          </div>
          <div className="h-4 w-20 bg-gray-100 rounded animate-pulse pb-2" />
          <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gray-100 -z-10" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
          {Array.from({ length: cards }).map((_, i) => (
            <div key={i} className="bg-gray-100 rounded-[3px] animate-pulse aspect-[3/4]" />
          ))}
        </div>
      </div>
    </section>
  );
}
