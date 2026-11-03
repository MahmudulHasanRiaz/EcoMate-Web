import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import { resolveDerivativeUrl } from "@/lib/image-derivative";

export function StoreBrand() {
  const { config } = useStorefrontConfig();

  const display = config.systems?.[0]?.display || 'name';

  if (display === 'logo') {
    return config.branding.storeLogo ? (
      <img
        // The logo renders at h-8 — never ship the raw original (a tenant
        // logo measured 832 KB). The backend already ships the logo's
        // derivative manifest in config._mediaMeta; fall back to the
        // original when no derivative exists yet.
        src={resolveDerivativeUrl(config._mediaMeta, config.branding.storeLogo, 'small')}
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
          <img src={resolveDerivativeUrl(config._mediaMeta, config.branding.storefrontFavicon, 'thumbnail')} alt="" width={32} height={32} className="w-8 h-8 rounded object-contain" />
        ) : null}
        <span className="text-xl font-black text-brand-blue tracking-tight">{config.store.name}</span>
      </div>
    );
  }

  return <span className="text-xl font-black text-brand-blue tracking-tight">{config.store.name}</span>;
}
