"use client";

import { useStorefrontConfig } from "@/context/StorefrontConfigContext";

export function StoreBrand() {
  const { config } = useStorefrontConfig();
  const systems = config.systems?.length ? config.systems : null;

  if (!systems) {
    return <span className="text-xl font-black text-brand-blue tracking-tight">{config.store.name}</span>;
  }

  return (
    <>
      {systems.map((sys) => {
        if (sys.display === 'logo') {
          return (
            <img key={sys.id} src={sys.logo} alt={sys.name} className="h-8 w-auto object-contain" />
          );
        }
        if (sys.display === 'name+logo') {
          return (
            <div key={sys.id} className="flex items-center gap-2">
              {sys.logo ? (
                <img src={sys.logo} alt="" className="w-8 h-8 rounded object-contain" />
              ) : null}
              <span className="text-xl font-black text-brand-blue tracking-tight">{sys.name}</span>
            </div>
          );
        }
        return (
          <span key={sys.id} className="text-xl font-black text-brand-blue tracking-tight">{sys.name}</span>
        );
      })}
    </>
  );
}
