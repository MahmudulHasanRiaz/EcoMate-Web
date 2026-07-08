import { fetchCombosServer } from "@/lib/api/combos-server";
import ComboGridClient from "./ComboGridClient";
import { getStorefrontConfigServer } from "@/lib/api/storefront-config-server";

type CombosSearchParams = {
  search?: string;
  page?: string;
};

export default async function CombosPage({
  searchParams,
}: {
  searchParams: Promise<CombosSearchParams>;
}) {
  const config = await getStorefrontConfigServer();
  if (!config.licenseFeatures?.includes('admin_combos')) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-8 h-8 text-gray-400">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-3">Not Available</h2>
        <p className="text-gray-500 max-w-md">Combo deals are not available on your current plan.</p>
      </div>
    );
  }

  const sp = await searchParams;
  const { data, meta } = await fetchCombosServer({
    perPage: 12,
    isActive: true,
    search: sp.search || undefined,
  });

  const filterKey = JSON.stringify(sp);

  return (
    <ComboGridClient
      key={filterKey}
      initialItems={data}
      initialCursor={meta.nextCursor}
      initialHasMore={meta.hasMore}
      filters={sp}
    />
  );
}
