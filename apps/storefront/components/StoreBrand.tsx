import { useStorefrontConfig } from "@/context/StorefrontConfigContext";

export function StoreBrand() {
  const { config } = useStorefrontConfig();

  const display = config.systems?.[0]?.display || 'name';

  if (display === 'logo') {
    return config.branding.storeLogo ? (
      <img
        src={config.branding.storeLogo}
        alt={config.store.name}
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
          <img src={config.branding.storefrontFavicon} alt="" className="w-8 h-8 rounded object-contain" />
        ) : null}
        <span className="text-xl font-black text-brand-blue tracking-tight">{config.store.name}</span>
      </div>
    );
  }

  return <span className="text-xl font-black text-brand-blue tracking-tight">{config.store.name}</span>;
}
