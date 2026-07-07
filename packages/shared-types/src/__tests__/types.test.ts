import { describe, it, expect } from 'vitest';
import { FEATURES, type FeatureFlag, type LicenseToken } from '../license-types';
import { ClientConfig } from '../client-config';

describe('shared-types', () => {
  describe('FEATURES', () => {
    it('has 72 features', () => {
      expect(Object.keys(FEATURES).length).toBe(72);
    });

    it('has storefront and admin features', () => {
      expect(FEATURES).toHaveProperty('storefront');
      expect(FEATURES).toHaveProperty('admin_products');
      expect(FEATURES).toHaveProperty('admin_accounting');
    });

    it('storefront has no dependencies', () => {
      const f = FEATURES['storefront'];
      expect(f.key).toBe('storefront');
      expect(f.dependencies).toBeUndefined();
    });

    it('admin_purchases depends on admin_suppliers + admin_inventory', () => {
      const f = FEATURES['admin_purchases'];
      expect(f.key).toBe('admin_purchases');
      expect(f.dependencies).toContain('admin_suppliers');
      expect(f.dependencies).toContain('admin_inventory');
    });

    it('all courier features depend on admin_products + admin_orders', () => {
      const f = FEATURES['courier_steadfast'];
      expect(f.dependencies).toContain('admin_products');
      expect(f.dependencies).toContain('admin_orders');
    });

    it('pos_system depends only on admin_products', () => {
      const f = FEATURES['pos_system'];
      expect(f.dependencies).toEqual(['admin_products']);
    });
  });

  describe('LicenseToken interface', () => {
    it('creates a valid license token shape', () => {
      const token: LicenseToken = {
        clientId: 'test-client',
        features: ['storefront', 'admin_products', 'admin_accounting'],
        limits: { orders_per_month: 5000, staff_users: 10 },
        domains: ['example.com'],
        exp: 9999999999,
        iat: 1000000000,
      };
      expect(token.clientId).toBe('test-client');
      expect(token.features).toContain('storefront');
      expect(token.limits.orders_per_month).toBe(5000);
      expect(token.domains).toContain('example.com');
    });
  });

  describe('ClientConfig interface', () => {
    it('creates a minimal client config', () => {
      const config: ClientConfig = {
        clientId: 'client-1',
        displayName: 'Test Client',
        features: { storefront: true },
        overrides: {},
      };
      expect(config.clientId).toBe('client-1');
      expect(config.displayName).toBe('Test Client');
    });

    it('creates a full client config with branding', () => {
      const config: ClientConfig = {
        clientId: 'client-2',
        displayName: 'Branded Client',
        features: { storefront: true, admin_products: true },
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
