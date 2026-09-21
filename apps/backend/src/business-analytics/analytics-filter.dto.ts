/**
 * Business analytics filter DTO (P2 data layer, §4.1).
 *
 * The SINGLE filter every analytics service consumes. Source System
 * (Order.source) and Sales Channel (Order.salesChannel) are separate filters
 * and are never merged. There is intentionally NO Store dimension (F7 —
 * Order has no store/storeId/branch).
 */
import { IsIn, IsOptional, IsString, Matches, IsEnum } from 'class-validator';
import { SalesChannel } from '@prisma/client';
import type { RangePreset, Granularity } from './analytics-range.util';

export const ANALYTICS_RANGE_PRESETS: readonly RangePreset[] = [
  'today',
  'yesterday',
  'last_7_days',
  'last_30_days',
  'this_month',
  'this_quarter',
  'this_year',
  'custom',
];

export const ANALYTICS_SOURCES = ['POS', 'ECOMMERCE', 'MANUAL'] as const;
export type AnalyticsSource = (typeof ANALYTICS_SOURCES)[number];

export const CUSTOMER_SEGMENTS = ['new', 'returning', 'vip'] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

export const DELIVERY_OUTCOMES = [
  'delivered',
  'returned',
  'in_fulfilment',
  'cancelled',
] as const;
export type DeliveryOutcome = (typeof DELIVERY_OUTCOMES)[number];

export const COLLECTION_STATUSES = [
  'online-collected',
  'cod-unavailable',
] as const;
export type CollectionStatus = (typeof COLLECTION_STATUSES)[number];

/** Marketing-source literal for orders with no attribution (analytical). */
export const MARKETING_UNATTRIBUTED = 'unattributed';

/** Dhaka date-only YYYY-MM-DD. */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class AnalyticsFilterDto {
  @IsOptional()
  @IsIn([...ANALYTICS_RANGE_PRESETS])
  preset?: RangePreset;

  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'startDate must be YYYY-MM-DD' })
  startDate?: string;

  @IsOptional()
  @IsString()
  @Matches(DATE_RE, { message: 'endDate must be YYYY-MM-DD' })
  endDate?: string;

  @IsOptional()
  @IsIn(['hour', 'day', 'week', 'month'])
  granularity?: Granularity;

  /** Source System — how the order was created (Order.source). */
  @IsOptional()
  @IsIn([...ANALYTICS_SOURCES])
  source?: AnalyticsSource;

  /** Sales Channel — where the sale came from (Order.salesChannel). */
  @IsOptional()
  @IsEnum(SalesChannel)
  salesChannel?: SalesChannel;

  /**
   * Marketing Source — platform slug via
   * OrderAttribution → campaign → adAccount → platform; unattributed orders
   * resolve via MarketingSession.utmSource, else 'unattributed'.
   * Never Order.sourcePlatform.
   */
  @IsOptional()
  @IsString()
  marketingSource?: string;

  /** Payment Method — Payment.gatewayCode; PAID rows only (§4.1). */
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  /** True sold entity; combo lines expand via OrderItemComboComponent. */
  @IsOptional()
  @IsString()
  productId?: string;

  @IsOptional()
  @IsString()
  variantId?: string;

  /** Product.categoryId + ProductCategory (not a product-column-only fact). */
  @IsOptional()
  @IsString()
  categoryId?: string;

  /** Order-time snapshot: matches customerCity/State/Zip (unmapped → W7). */
  @IsOptional()
  @IsString()
  location?: string;

  /** Derived new/returning/vip — not stored (see AnalyticsFilterService). */
  @IsOptional()
  @IsIn([...CUSTOMER_SEGMENTS])
  customerSegment?: CustomerSegment;

  /** Fulfillment location — OrderItem.sourceWarehouseId. */
  @IsOptional()
  @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsIn([...DELIVERY_OUTCOMES])
  deliveryOutcome?: DeliveryOutcome;

  /** online-collected / cod-unavailable — explicit, never a derived guess. */
  @IsOptional()
  @IsIn([...COLLECTION_STATUSES])
  collectionStatus?: CollectionStatus;
}

/** Field inventory of the DTO (used to assert no Store dimension exists). */
export const ANALYTICS_FILTER_FIELDS = [
  'preset',
  'startDate',
  'endDate',
  'granularity',
  'source',
  'salesChannel',
  'marketingSource',
  'paymentMethod',
  'productId',
  'variantId',
  'categoryId',
  'location',
  'customerSegment',
  'warehouseId',
  'deliveryOutcome',
  'collectionStatus',
] as const;
