"use client";

import Image from 'next/image';
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";

export function StoreBrand() {
  const { config } = useStorefrontConfig();

  // Determine display mode from the first store_system config, default to 'name'
  const display = config.systems?.[0]?.display || 'name';

  if (display === 'logo') {
    return config.branding.storeLogo ? (
      <Image
        src={config.branding.storeLogo}
        alt={config.store.name}
        width={32}
        height={32}
        className="h-8 w-auto object-contain"
      />
    ) : (
      <span className="text-xl font-black text-brand-blue tracking-tight">{config.store.name}</span>
    );
  }

  if (display === 'name+logo') {
    return (
      <div className="flex items-center gap-2">
        {config.branding.storefrontFavicon ? (
          <Image src={config.branding.storefrontFavicon} alt={config.store.name} width={32} height={32} className="w-8 h-8 rounded object-contain" />
        ) : null}
        <span className="text-xl font-black text-brand-blue tracking-tight">{config.store.name}</span>
      </div>
    );
  }

  return <span className="text-xl font-black text-brand-blue tracking-tight">{config.store.name}</span>;
}
