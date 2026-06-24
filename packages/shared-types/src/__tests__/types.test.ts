import { describe, it, expect } from 'vitest';
import { FEATURES, type PlanType, type FeatureFlag, type LicenseToken, PLAN_TYPES, isPlanType } from '../license-types';
import { ClientConfig } from '../client-config';

describe('shared-types', () => {
  describe('FEATURES', () => {
    it('has expected features', () => {
      expect(FEATURES).toHaveProperty('pos');
      expect(FEATURES).toHaveProperty('multi-warehouse');
      expect(FEATURES).toHaveProperty('advanced-reports');
      expect(FEATURES).toHaveProperty('coupons');
      expect(FEATURES).toHaveProperty('custom-reports');
    });

    it('pos has correct config', () => {
      const pos = FEATURES['pos'];
      expect(pos.key).toBe('pos');
      expect(pos.enabled).toBe(true);
      expect(pos.planMin).toBe('growth');
    });

    it('multi-warehouse requires enterprise', () => {
      const mw = FEATURES['multi-warehouse'];
      expect(mw.key).toBe('multi-warehouse');
      expect(mw.planMin).toBe('enterprise');
    });

    it('custom-reports requires ultimate', () => {
      const cr = FEATURES['custom-reports'];
      expect(cr.key).toBe('custom-reports');
      expect(cr.planMin).toBe('ultimate');
    });
  });

  describe('PlanType', () => {
    it('includes all expected values', () => {
      expect(PLAN_TYPES).toEqual(['essential', 'growth', 'enterprise', 'ultimate', 'custom']);
    });

    it('isPlanType validates correct values', () => {
      expect(isPlanType('enterprise')).toBe(true);
      expect(isPlanType('ultimate')).toBe(true);
    });

    it('isPlanType rejects invalid values', () => {
      expect(isPlanType('premium')).toBe(false);
      expect(isPlanType('')).toBe(false);
    });

    it('allows valid plan values in array', () => {
      const plans: PlanType[] = ['essential', 'growth', 'enterprise', 'ultimate', 'custom'];
      expect(plans).toContain('essential');
      expect(plans).toContain('growth');
      expect(plans).toContain('enterprise');
      expect(plans).toContain('ultimate');
      expect(plans).toContain('custom');
    });
  });

  describe('LicenseToken interface', () => {
    it('creates a valid license token shape', () => {
      const token: LicenseToken = {
        clientId: 'test-client',
        plan: 'enterprise',
        packages: ['pos', 'inventory'],
        customFeatures: ['custom-reports'],
        limits: { cpus: 4, memory: '8GB', users: 50, stores: 5 },
        exp: 9999999999,
        iat: 1000000000,
      };
      expect(token.clientId).toBe('test-client');
      expect(token.plan).toBe('enterprise');
      expect(token.limits.cpus).toBe(4);
      expect(token.limits.users).toBe(50);
    });
  });

  describe('ClientConfig interface', () => {
    it('creates a minimal client config', () => {
      const config: ClientConfig = {
        clientId: 'client-1',
        displayName: 'Test Client',
        features: { pos: true },
        overrides: {},
      };
      expect(config.clientId).toBe('client-1');
      expect(config.displayName).toBe('Test Client');
    });

    it('creates a full client config with branding', () => {
      const config: ClientConfig = {
        clientId: 'client-2',
        displayName: 'Branded Client',
        features: { pos: true, coupons: true },
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
