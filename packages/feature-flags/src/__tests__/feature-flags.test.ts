import { describe, it, expect } from 'vitest';
import { FeatureFlagsService } from '../index';

describe('FeatureFlagsService', () => {
  describe('setLicense / canUse', () => {
    it('allows feature in active set', () => {
      const svc = new FeatureFlagsService();
      svc.setLicense(['storefront', 'admin_products']);
      expect(svc.canUse('storefront')).toBe(true);
      expect(svc.canUse('admin_products')).toBe(true);
    });

    it('denies feature not in active set', () => {
      const svc = new FeatureFlagsService();
      svc.setLicense(['storefront']);
      expect(svc.canUse('pos_system')).toBe(false);
    });

    it('returns empty array before any license set', () => {
      const svc = new FeatureFlagsService();
      expect(svc.getActiveFeatures()).toEqual([]);
    });

    it('getActiveFeatures returns active features', () => {
      const svc = new FeatureFlagsService();
      svc.setLicense(['a', 'b', 'c']);
      expect(svc.getActiveFeatures()).toEqual(['a', 'b', 'c']);
    });
  });

  describe('initialize', () => {
    it('sets active features and returns validated list', () => {
      const svc = new FeatureFlagsService();
      const result = svc.initialize(['storefront', 'admin_products']);
      expect(result).toEqual(['storefront', 'admin_products']);
      expect(svc.canUse('storefront')).toBe(true);
    });
  });

  describe('validateDependencies', () => {
    it('keeps features with met dependencies', () => {
      const svc = new FeatureFlagsService();
      const result = svc.validateDependencies(['storefront', 'gateway_bkash']);
      expect(result).toContain('storefront');
      expect(result).toContain('gateway_bkash');
    });

    it('excludes features with unmet dependencies', () => {
      const svc = new FeatureFlagsService();
      const result = svc.validateDependencies(['gateway_bkash']);
      expect(result).not.toContain('gateway_bkash');
    });

    it('handles chain dependency — removes cascading features', () => {
      const svc = new FeatureFlagsService();
      // Two-level chain: admin_barcode_search → pos_system → admin_products
      // admin_products missing → both removed (iteration needed for 2nd level)
      const result = svc.validateDependencies([
        'admin_barcode_search',
        'pos_system',
      ]);
      expect(result).not.toContain('pos_system');
      expect(result).not.toContain('admin_barcode_search');
    });

    it('keeps features with no dependencies', () => {
      const svc = new FeatureFlagsService();
      const result = svc.validateDependencies(['storefront', 'admin_products', 'admin_orders']);
      expect(result).toEqual(['storefront', 'admin_products', 'admin_orders']);
    });

    it('iterate until stable — deps resolved when feature with shared dep excluded', () => {
      const svc = new FeatureFlagsService();
      // admin_reviews depends on storefront_reviews
      // admin_referrals depends on storefront_referral
      // Both storefront_reviews and storefront_referral depend on storefront
      // Input has all deps met → all kept
      const result = svc.validateDependencies([
        'storefront',
        'storefront_reviews',
        'storefront_referral',
        'admin_reviews',
        'admin_referrals',
      ]);
      expect(result).toEqual([
        'storefront',
        'storefront_reviews',
        'storefront_referral',
        'admin_reviews',
        'admin_referrals',
      ]);
    });
  });
});
