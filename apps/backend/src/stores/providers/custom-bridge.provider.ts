/**
 * Custom bridge adapter — P1 capability declaration (central-commerce §7.1).
 *
 * Capabilities are manifest-discovered (Bridge v1, P10); the values below
 * are the safe defaults until a manifest is read: status-only stock is the
 * tested default path. A manifest may only narrow writes, never widen them
 * past these defaults without an explicit audited capability grant (P10).
 */
import { Injectable } from '@nestjs/common';
import { BaseCommerceProvider } from './base-provider';
import type { ProviderCapabilities } from './provider.contract';

@Injectable()
export class CustomBridgeProvider extends BaseCommerceProvider {
  readonly slug = 'custom' as const;

  readonly declaredCapabilities: ProviderCapabilities = {
    products: true,
    variations: true,
    variantDelete: true,
    categories: true,
    media: true,
    mediaReuse: true,
    delete: true,
    seo: true,
    costPrice: false, // manifest may enable; never customer-facing (BR-23)
    weight: true,
    dimensions: true,
    slug: true,
    orders: true,
    webhooks: true,
    orderStatusUpdate: true,
    orderStatusUpdateTargets: ['cancelled', 'completed'],
    stockStatusFidelity: 'faithful', // status-only recommended; manifest narrows
    contactCheckExposure: true,
    categoryModel: 'custom',
    seoModel: 'native',
    mediaModel: 'url-fetch',
    combos: false, // BR-22; manifest-declared only
    externalEditsDetectable: 'inferred',
  };
}
