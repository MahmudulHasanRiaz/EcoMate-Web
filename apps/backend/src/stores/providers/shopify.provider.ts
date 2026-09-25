/**
 * Shopify adapter — P1 capability declaration (central-commerce §7.1).
 *
 * Phase-1 stock is `unsupported` (BR-08): zero writes, read-only drift
 * reporting. Variants with orders cannot be deleted → archive + issue.
 * `handle` is the slug; dimensions are not native → skipped with a reason.
 * Live adapter lands in P9 (entry prerequisite: dev store + custom-app
 * token); no core-service change may be needed to add it.
 */
import { Injectable } from '@nestjs/common';
import { BaseCommerceProvider } from './base-provider';
import type { ProviderCapabilities } from './provider.contract';

@Injectable()
export class ShopifyProvider extends BaseCommerceProvider {
  readonly slug = 'shopify' as const;

  readonly declaredCapabilities: ProviderCapabilities = {
    products: true,
    variations: true,
    variantDelete: false, // cannot delete a variant with orders → archive + issue
    categories: true, // collections per path + product_type (adapter-internal)
    media: true,
    mediaReuse: true, // via stored media id
    delete: true,
    seo: true, // seo.title / seo.description
    costPrice: true, // inventory_item.cost (never customer-facing — BR-23)
    weight: true,
    dimensions: false, // not native → skipped with reason
    slug: true, // handle
    orders: true,
    webhooks: true,
    orderStatusUpdate: true,
    orderStatusUpdateTargets: ['CANCELLED', 'FULFILLED'],
    stockStatusFidelity: 'unsupported', // BR-08: no writes, monitor-only
    contactCheckExposure: true, // via bridge / app proxy
    categoryModel: 'collection',
    seoModel: 'native',
    mediaModel: 'binary-upload',
    combos: false, // BR-22
    externalEditsDetectable: 'inferred',
  };
}
