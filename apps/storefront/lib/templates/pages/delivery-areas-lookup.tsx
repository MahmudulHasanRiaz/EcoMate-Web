"use client";

import { useMemo, useState } from "react";
import { Search, Truck, Ban } from "lucide-react";

export interface DistrictCharge {
  name: string;
  nameBn?: string;
  charge: { charge: number; noDeliveryError: string };
}

/**
 * District / charge lookup — the charge shown for each district is the
 * one checkout's resolver returns for it (computed server-side in the
 * template), never a CMS claim.
 */
export default function DistrictChargeLookup({
  districts,
  symbol,
}: {
  districts: DistrictCharge[];
  symbol: string;
}) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return districts;
    return districts.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.nameBn || "").toLowerCase().includes(q),
    );
  }, [districts, query]);

  if (districts.length === 0) return null;

  return (
    <div className="mb-8">
      <h2 className="text-[16px] font-bold text-gray-900 mb-1">Find your delivery charge</h2>
      <p className="text-[13px] text-gray-500 mb-4">
        Search your district — the charge shown is exactly what checkout will apply.
      </p>
      <div className="relative mb-4 max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search district…"
          aria-label="Search district"
          className="w-full h-11 pl-9 pr-3 rounded-xl border border-gray-200 text-[13px] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-brand-blue"
        />
      </div>

      {filtered.length === 0 ? (
        <p className="text-[13px] text-gray-500">
          No district matches &ldquo;{query}&rdquo;. Try another spelling.
        </p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {filtered.map((d) => {
            const noDelivery = Boolean(d.charge.noDeliveryError);
            return (
              <div key={d.name} className="bg-white rounded-xl border border-gray-100 p-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-gray-800 truncate">{d.name}</p>
                  {d.nameBn && <p className="text-[11px] text-gray-400 truncate">{d.nameBn}</p>}
                </div>
                {noDelivery ? (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 bg-red-50 px-2 py-1 rounded-full">
                    <Ban size={12} /> No delivery
                  </span>
                ) : (
                  <span className="shrink-0 inline-flex items-center gap-1 text-[12px] font-bold text-gray-800">
                    <Truck size={12} className="text-brand-blue" />
                    {d.charge.charge === 0 ? 'Free' : `${symbol}${d.charge.charge.toLocaleString()}`}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
