/**
 * Tracking Eligibility Gate
 *
 * Centralized gate that checks if an order's tracking events should be sent
 * to advertising platforms (Meta, TikTok, etc.) based on order source policy.
 *
 * This gate is called BEFORE any tracking event is captured/dispatched for
 * order-originated events (Purchase, Refund, OrderPlaced, OrderConfirmed, etc.).
 *
 * Browser-originated pre-order events (PageView, AddToCart, InitiateCheckout, Lead)
 * are NOT gated by this policy because they occur before the order exists.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  OrderSourcePolicyService,
  resolveOrderSourceCategory,
  type OrderSourceCategory,
} from './order-source-policy';

/** Result of an eligibility check. */
export interface EligibilityResult {
  /** Whether the order is eligible for tracking. */
  eligible: boolean;
  /** The source category of the order. */
  category: OrderSourceCategory;
  /** The configuration key that was checked. */
  configKey: string;
  /** The resolved configuration value. */
  configValue: boolean;
  /** Human-readable reason for the decision. */
  reason: string;
  /** Metadata for observability. */
  metadata: {
    orderId: string;
    source?: string | null;
    salesChannel?: string | null;
    sourcePlatform?: string | null;
    posSessionId?: string | null;
  };
}

/**
 * Event types that are order-originated and should be gated by source policy.
 * These events are associated with a specific order and represent business
 * lifecycle events that should only be tracked for eligible order sources.
 */
const ORDER_ORIGINATED_EVENT_TYPES = new Set([
  'Purchase',
  'Refund',
  'OrderPlaced',
  'OrderConfirmed',
  'OrderCancelled',
  'OrderDelivered',
  'OrderReturned',
]);

/**
 * Event types that are browser-originated and occur BEFORE an order exists.
 * These should NOT be gated by order source policy because the order hasn't
 * been created yet when these events fire.
 */
const BROWSER_PRE_ORDER_EVENT_TYPES = new Set([
  'PageView',
  'ViewContent',
  'AddToCart',
  'InitiateCheckout',
  'Lead',
  'Search',
]);

@Injectable()
export class TrackingEligibilityGate {
  private readonly logger = new Logger(TrackingEligibilityGate.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sourcePolicy: OrderSourcePolicyService,
  ) {}

  /**
   * Check if an order-originated tracking event should be sent.
   *
   * @param eventType The tracking event type
   * @param orderId The order ID (required for order-originated events)
   * @returns EligibilityResult with decision and metadata
   */
  async checkOrderEvent(
    eventType: string,
    orderId: string,
  ): Promise<EligibilityResult> {
    // Browser pre-order events are always eligible
    if (BROWSER_PRE_ORDER_EVENT_TYPES.has(eventType)) {
      return {
        eligible: true,
        category: 'DIRECT_WEBSITE',
        configKey: 'N/A',
        configValue: true,
        reason: 'Browser pre-order events are always eligible',
        metadata: { orderId },
      };
    }

    // Non-order events (custom events, etc.) are always eligible
    if (!ORDER_ORIGINATED_EVENT_TYPES.has(eventType)) {
      return {
        eligible: true,
        category: 'DIRECT_WEBSITE',
        configKey: 'N/A',
        configValue: true,
        reason: 'Non-order events are always eligible',
        metadata: { orderId },
      };
    }

    // Fetch order metadata for source classification
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        source: true,
        salesChannel: true,
        sourcePlatform: true,
        sourceType: true,
        posSessionId: true,
        idempotencyKey: true,
      },
    });

    if (!order) {
      // Order not found - allow tracking (will fail at dispatch anyway)
      return {
        eligible: true,
        category: 'DIRECT_WEBSITE',
        configKey: 'N/A',
        configValue: true,
        reason: 'Order not found - allowing tracking (dispatch will handle error)',
        metadata: { orderId },
      };
    }

    const eligibility = await this.sourcePolicy.checkEligibility(order);

    const result: EligibilityResult = {
      ...eligibility,
      reason: eligibility.eligible
        ? `Order source "${eligibility.category}" is eligible for tracking`
        : eligibility.reason || `Order source "${eligibility.category}" is not eligible for tracking`,
      metadata: {
        orderId: order.id,
        source: order.source,
        salesChannel: order.salesChannel,
        sourcePlatform: order.sourcePlatform,
        posSessionId: order.posSessionId,
      },
    };

    if (!result.eligible) {
      this.logger.log(
        `Tracking skipped for order ${orderId}: ${result.reason} (category=${result.category}, config=${result.configKey}=${result.configValue})`,
      );
    }

    return result;
  }

  /**
   * Quick check: is an order eligible for tracking?
   * Returns true/false without full metadata.
   */
  async isOrderEligible(orderId: string): Promise<boolean> {
    const result = await this.checkOrderEvent('Purchase', orderId);
    return result.eligible;
  }

  /**
   * Check eligibility and throw if not eligible.
   * Used by callers that want to gate on eligibility.
   */
  async requireEligible(eventType: string, orderId: string): Promise<EligibilityResult> {
    const result = await this.checkOrderEvent(eventType, orderId);
    return result;
  }
}
