import { fetchCombosServer } from "@/lib/api/combos-server";
import ComboGridClient from "./ComboGridClient";

export const dynamic = "force-dynamic";

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

  return (
    <ComboGridClient
      initialItems={data}
      initialCursor={meta.nextCursor}
      initialHasMore={meta.hasMore}
      filters={sp}
    />
  );
}
