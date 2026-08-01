/**
 * Provider adapter assembly point. Exposes the adapter contract + versioned
 * registry; concrete provider adapters (Tasks 3-5) are registered here via
 * buildAdapterRegistry().
 */
import { Ga4Adapter } from './ga4.adapter';
import { GoogleAdsAdapter } from './google-ads.adapter';
import { MetaAdapter } from './meta.adapter';
import { TikTokAdapter } from './tiktok.adapter';
import {
  TrackingProviderAdapter,
  registerAdapter,
} from './tracking-provider.adapter';

export * from './tracking-provider.adapter';
export * from './meta.adapter';
export * from './tiktok.adapter';
export * from './ga4.adapter';
export * from './google-ads.adapter';

/**
 * Instantiate and register every concrete provider adapter, returning the
 * assembled set. Registration is overwrite-on-collision (same provider+version
 * → later wins), so repeated calls are idempotent and safe.
 */
export function buildAdapterRegistry(): TrackingProviderAdapter[] {
  const adapters: TrackingProviderAdapter[] = [
    new MetaAdapter(),
    new TikTokAdapter(),
    new Ga4Adapter(),
    new GoogleAdsAdapter(),
  ];
  for (const adapter of adapters) registerAdapter(adapter);
  return adapters;
}
