/**
 * Order Source Tracking Policy
 *
 * Centralized classification of order sources for tracking eligibility.
 * Determines which orders should have their tracking events sent to
 * advertising platforms (Meta, TikTok, etc.).
 *
 * Categories:
 * - DIRECT_WEBSITE: Website checkout orders (default: ON)
 * - POS: Point-of-sale orders (default: OFF)
 * - INCOMPLETE_CONVERSION: Checkout lead → order conversions (default: OFF)
 * - MANUAL: Admin/operator manually created orders (default: OFF)
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Order source tracking categories. */
export type OrderSourceCategory =
  | 'DIRECT_WEBSITE'
  | 'POS'
  | 'INCOMPLETE_CONVERSION'
  | 'MANUAL';

/** Configuration keys for source eligibility. */
export const SOURCE_CONFIG_KEYS: Record<OrderSourceCategory, string> = {
  DIRECT_WEBSITE: 'tracking_send_website_orders',
  POS: 'tracking_send_pos_orders',
  INCOMPLETE_CONVERSION: 'tracking_send_incomplete_conversion_orders',
  MANUAL: 'tracking_send_manual_orders',
};

/** Default eligibility for each source category. */
export const SOURCE_DEFAULTS: Record<OrderSourceCategory, boolean> = {
  DIRECT_WEBSITE: true,
  POS: false,
  INCOMPLETE_CONVERSION: false,
  MANUAL: false,
};

/** Human-readable labels for settings UI. */
export const SOURCE_LABELS: Record<OrderSourceCategory, string> = {
  DIRECT_WEBSITE: 'Direct Website Orders',
  POS: 'POS Orders',
  INCOMPLETE_CONVERSION: 'Incomplete Conversion Orders',
  MANUAL: 'Manual/Admin Orders',
};

/** Descriptions for settings UI. */
export const SOURCE_DESCRIPTIONS: Record<OrderSourceCategory, string> = {
  DIRECT_WEBSITE:
    'Orders placed directly through the website checkout. These are standard e-commerce orders.',
  POS:
    'Orders created through the Point-of-Sale system in physical showrooms.',
  INCOMPLETE_CONVERSION:
    'Orders converted from incomplete checkout leads or phone orders.',
  MANUAL:
    'Orders manually created by admin/operators through the admin panel.',
};

interface OrderSourceInput {
  source?: string | null;
  salesChannel?: string | null;
  sourcePlatform?: string | null;
  sourceType?: string | null;
  posSessionId?: string | null;
  idempotencyKey?: string | null;
}

/**
 * Resolves the tracking source category for an order based on its metadata.
 * This is deterministic: the same order metadata always produces the same category.
 *
 * `source` is authoritative where it is explicit (POS / MANUAL are written by the
 * order paths themselves); the remaining categories are inferred from the
 * attribution dimensions, because a converted checkout lead is staff-created yet
 * is genuinely website-origin traffic and must stay INCOMPLETE_CONVERSION rather
 * than being lumped into MANUAL.
 */
export function resolveOrderSourceCategory(order: OrderSourceInput): OrderSourceCategory {
  // POS orders: created through POS sessions
  if (order.posSessionId || order.source === 'POS') {
    return 'POS';
  }

  // Incomplete conversion: orders from checkout leads / phone orders. Checked
  // BEFORE the MANUAL bucket — a converted lead is placed by staff but its
  // origin is the website, so it keeps its own eligibility switch.
  if (
    order.sourcePlatform === 'PHONE' ||
    order.sourceType === 'CALL' ||
    order.sourcePlatform === 'LEAD'
  ) {
    return 'INCOMPLETE_CONVERSION';
  }

  // Manual orders: explicitly marked by the creating path, or created with a
  // non-website/non-POS channel.
  if (order.source === 'MANUAL') {
    return 'MANUAL';
  }
  if (
    order.salesChannel &&
    order.salesChannel !== 'WEBSITE' &&
    order.salesChannel !== 'POS'
  ) {
    return 'MANUAL';
  }

  // Default: direct website order
  return 'DIRECT_WEBSITE';
}

/**
 * Service for resolving tracking eligibility based on order source and configuration.
 */
@Injectable()
export class OrderSourcePolicyService {
  private readonly logger = new Logger(OrderSourcePolicyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Check if an order is eligible for tracking based on its source category
   * and the current configuration.
   *
   * Returns { eligible: true } if tracking should proceed,
   * or { eligible: false, category, reason } if tracking should be skipped.
   */
  async checkEligibility(order: OrderSourceInput): Promise<{
    eligible: boolean;
    category: OrderSourceCategory;
    configKey: string;
    configValue: boolean;
    reason?: string;
  }> {
    const category = resolveOrderSourceCategory(order);
    const configKey = SOURCE_CONFIG_KEYS[category];

    // Read configuration (database-backed with runtime defaults)
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: configKey },
    });

    const configValue = setting?.value === 'true' || (!setting && SOURCE_DEFAULTS[category]);

    if (configValue) {
      return {
        eligible: true,
        category,
        configKey,
        configValue: true,
      };
    }

    return {
      eligible: false,
      category,
      configKey,
      configValue: false,
      reason: `Order source "${category}" is disabled in tracking configuration (${configKey}=${configValue})`,
    };
  }

  /**
   * Get all source eligibility settings for the settings UI.
   */
  async getAllSettings(): Promise<
    Array<{
      category: OrderSourceCategory;
      key: string;
      label: string;
      description: string;
      enabled: boolean;
      defaultValue: boolean;
    }>
  > {
    const categories: OrderSourceCategory[] = [
      'DIRECT_WEBSITE',
      'POS',
      'INCOMPLETE_CONVERSION',
      'MANUAL',
    ];

    const settings = await this.prisma.systemSetting.findMany({
      where: {
        key: { in: categories.map((c) => SOURCE_CONFIG_KEYS[c]) },
      },
    });

    const settingMap = new Map(settings.map((s) => [s.key, s.value]));

    return categories.map((category) => {
      const key = SOURCE_CONFIG_KEYS[category];
      const stored = settingMap.get(key);
      const enabled =
        stored === 'true' ? true : stored === 'false' ? false : SOURCE_DEFAULTS[category];

      return {
        category,
        key,
        label: SOURCE_LABELS[category],
        description: SOURCE_DESCRIPTIONS[category],
        enabled,
        defaultValue: SOURCE_DEFAULTS[category],
      };
    });
  }

  /**
   * Update a source eligibility setting.
   */
  async updateSetting(category: OrderSourceCategory, enabled: boolean): Promise<void> {
    const key = SOURCE_CONFIG_KEYS[category];
    await this.prisma.systemSetting.upsert({
      where: { key },
      create: { key, value: String(enabled) },
      update: { value: String(enabled) },
    });
    this.logger.log(`Updated ${key} to ${enabled}`);
  }
}
