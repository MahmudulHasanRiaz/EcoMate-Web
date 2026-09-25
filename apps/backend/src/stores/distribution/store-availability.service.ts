/**
 * Store availability resolver — central-commerce §8.2 (P3).
 *
 * Pure function (no DB, no provider calls): precedence is
 * ```
 * global   = product.status === 'active' && product.isActive === true
 * override = ProductStoreAssignment(source = MANUAL)
 * rule     = nearest Category with a StoreAvailabilityRule
 * default  = OFF for external stores · NATIVE = global only
 * final    = global AND (override ?? rule ?? default)
 * ```
 * BR-20: NATIVE short-circuits to plain global publish — overrides, rules
 * and defaults can neither publish nor unpublish the native website.
 */
import { Injectable } from '@nestjs/common';

export type AvailabilityStoreKind = 'NATIVE' | 'WOOCOMMERCE' | 'SHOPIFY' | 'CUSTOM' | string;

export interface AvailabilityResolveInput {
  /** product.status === 'active' && product.isActive === true */
  globalActive: boolean;
  storeKind: AvailabilityStoreKind;
  /** MANUAL assignment override; null/undefined = no override */
  overrideAvailable?: boolean | null;
  /** nearest category rule; null/undefined = no rule */
  ruleAvailable?: boolean | null;
  /** external default; defaults to OFF */
  defaultAvailable?: boolean;
}

@Injectable()
export class StoreAvailabilityService {
  resolve(input: AvailabilityResolveInput): boolean {
    if (!input.globalActive) return false;
    if (input.storeKind === 'NATIVE') return true;
    const channel =
      input.overrideAvailable ?? input.ruleAvailable ?? input.defaultAvailable ?? false;
    return channel;
  }
}
