import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AdProviderAdapter,
  AD_PROVIDER_ADAPTER,
} from './ad-provider.adapter';

/**
 * Resolves the correct AdProviderAdapter based on platform slug.
 * Currently only Meta is implemented, but the architecture supports
 * adding TikTok, Google, LinkedIn etc. by registering additional adapters.
 */
@Injectable()
export class ProviderAdapterFactory {
  private readonly logger = new Logger(ProviderAdapterFactory.name);
  private readonly adapters = new Map<string, AdProviderAdapter>();

  constructor(
    @Inject(AD_PROVIDER_ADAPTER) private defaultAdapter: AdProviderAdapter,
  ) {
    // Register the default adapter under its slug
    this.adapters.set(defaultAdapter.providerSlug, defaultAdapter);
  }

  /**
   * Get the adapter for a given platform slug.
   * Falls back to the default adapter if no platform-specific adapter is registered.
   */
  getAdapter(platformSlug: string): AdProviderAdapter {
    const adapter = this.adapters.get(platformSlug);
    if (adapter) return adapter;

    // Fallback to default (currently Meta)
    this.logger.warn(
      `No adapter registered for platform "${platformSlug}"; falling back to ${this.defaultAdapter.providerSlug}`,
    );
    return this.defaultAdapter;
  }

  /**
   * Register an additional provider adapter (for future use).
   */
  registerAdapter(adapter: AdProviderAdapter) {
    this.adapters.set(adapter.providerSlug, adapter);
    this.logger.log(`Registered adapter for platform "${adapter.providerSlug}"`);
  }
}
