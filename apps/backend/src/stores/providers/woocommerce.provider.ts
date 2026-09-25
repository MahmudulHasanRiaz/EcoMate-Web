/**
 * WooCommerce adapter — P1 capability declaration (central-commerce §7.1).
 *
 * First implementation priority (P4): faithful stock (`stock_status =
 * instock/outofstock`), `product_cat` taxonomy with real hierarchy,
 * `?force=true` delete, HMAC webhooks. Companion-plugin capabilities
 * (field-change provenance → `externalEditsDetectable: 'plugin'`, SEO via
 * `meta_data`, media source-hash reuse, contact-check) degrade to the
 * REST-only values declared here until the plugin version gate passes.
 */
import { Injectable } from '@nestjs/common';
import { BaseCommerceProvider } from './base-provider';
import type { ProviderCapabilities } from './provider.contract';

@Injectable()
export class WooCommerceProvider extends BaseCommerceProvider {
  readonly slug = 'woocommerce' as const;

  readonly declaredCapabilities: ProviderCapabilities = {
    products: true,
    variations: true,
    variantDelete: true,
    categories: true,
    media: true,
    mediaReuse: false, // true only with the companion plugin (source-hash reuse)
    delete: true,
    seo: false, // plugin-only via meta_data → Yoast/RankMath
    costPrice: false, // no native field → never pushed (BR-23)
    weight: true,
    dimensions: true,
    slug: true,
    orders: true,
    webhooks: true,
    orderStatusUpdate: true,
    orderStatusUpdateTargets: ['cancelled', 'completed'],
    stockStatusFidelity: 'faithful',
    contactCheckExposure: true,
    categoryModel: 'taxonomy',
    seoModel: 'plugin-meta',
    mediaModel: 'url-fetch',
    combos: false, // BR-22: skipped with an explicit reason, never fabricated
    externalEditsDetectable: 'inferred', // 'plugin' once the companion plugin reports provenance
  };
}
