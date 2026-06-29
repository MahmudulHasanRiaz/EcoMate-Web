import { describe, it, expect } from 'vitest';
import { FEATURES, type PlanType, type FeatureFlag, type LicenseToken, PLAN_TYPES, isPlanType } from '../license-types';
import { ClientConfig } from '../client-config';

describe('shared-types', () => {
  describe('FEATURES', () => {
    it('has 58 expected features', () => {
      expect(Object.keys(FEATURES).length).toBe(58);
    });

    it('has storefront and admin features', () => {
      expect(FEATURES).toHaveProperty('storefront_catalog');
      expect(FEATURES).toHaveProperty('admin_products');
      expect(FEATURES).toHaveProperty('admin_accounting');
    });

    it('storefront_catalog requires essential', () => {
      const f = FEATURES['storefront_catalog'];
      expect(f.key).toBe('storefront_catalog');
      expect(f.planMin).toBe('essential');
    });

    it('admin_accounting requires enterprise', () => {
      const f = FEATURES['admin_accounting'];
      expect(f.key).toBe('admin_accounting');
      expect(f.planMin).toBe('enterprise');
    });
  });

  describe('PlanType', () => {
    it('includes all expected values', () => {
      expect(PLAN_TYPES).toEqual(['essential', 'growth', 'enterprise', 'custom']);
    });

    it('isPlanType validates correct values', () => {
      expect(isPlanType('enterprise')).toBe(true);
      expect(isPlanType('essential')).toBe(true);
    });

    it('isPlanType rejects invalid values', () => {
      expect(isPlanType('ultimate')).toBe(false);
      expect(isPlanType('premium')).toBe(false);
      expect(isPlanType('')).toBe(false);
    });

    it('allows valid plan values in array', () => {
      const plans: PlanType[] = ['essential', 'growth', 'enterprise', 'custom'];
      expect(plans).toContain('essential');
      expect(plans).toContain('growth');
      expect(plans).toContain('enterprise');
      expect(plans).toContain('custom');
    });
  });

  describe('LicenseToken interface', () => {
    it('creates a valid license token shape', () => {
      const token: LicenseToken = {
        clientId: 'test-client',
        plan: 'enterprise',
        features: ['storefront_catalog', 'admin_accounting'],
        limits: { orders_per_month: 5000, staff_users: 10 },
        domains: ['example.com'],
        exp: 9999999999,
        iat: 1000000000,
      };
      expect(token.clientId).toBe('test-client');
      expect(token.plan).toBe('enterprise');
      expect(token.limits.orders_per_month).toBe(5000);
      expect(token.domains).toContain('example.com');
    });
  });

  describe('ClientConfig interface', () => {
    it('creates a minimal client config', () => {
      const config: ClientConfig = {
        clientId: 'client-1',
        displayName: 'Test Client',
        features: { storefront_catalog: true },
        overrides: {},
      };
      expect(config.clientId).toBe('client-1');
      expect(config.displayName).toBe('Test Client');
    });

    it('creates a full client config with branding', () => {
      const config: ClientConfig = {
        clientId: 'client-2',
        displayName: 'Branded Client',
        features: { storefront_catalog: true, admin_products: true },
        overrides: {
          admin: { theme: { primary: '#000' } },
          storefront: { theme: { accent: '#fff' } },
        },
        branding: {
          primaryColor: '#ff6600',
          logo: '/logo.png',
          favicon: '/favicon.ico',
        },
      };
      expect(config.branding?.primaryColor).toBe('#ff6600');
      expect(config.branding?.logo).toBe('/logo.png');
    });
  });
});
