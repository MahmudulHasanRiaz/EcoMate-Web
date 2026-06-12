import { fetchCombosServer } from "@/lib/api/combos-server";
import ComboGridClient from "./ComboGridClient";

type CombosSearchParams = {
  search?: string;
  page?: string;
};

export default async function CombosPage({
  searchParams,
}: {
  searchParams: Promise<CombosSearchParams>;
}) {
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
