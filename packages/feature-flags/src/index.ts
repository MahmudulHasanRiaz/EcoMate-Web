import { Injectable, Optional } from '@nestjs/common';

export { REQUIRES_FEATURE_KEY, RequiresFeature } from './decorator';
export { FeatureGuard } from './guard';

export interface LicenseInfo {
  valid: boolean;
  code?: string;
  detail?: string;
  plan?: { id: string; name: string; planType: string; price: number };
  features?: string[];
  limits?: Record<string, number>;
  domains?: string[];
  expiry?: string;
  lastCheckIn?: string;
}

interface LicenseEngine {
  verify(licenseKey: string, domain?: string, apiKey?: string): Promise<LicenseInfo>;
  canUseFeature(license: LicenseInfo | null, featureKey: string): boolean;
  checkLimit(license: LicenseInfo | null, metricKey: string, currentUsage: number): { ok: boolean; allowed: number; current: number; remaining: number };
  setLicense(token: string): LicenseInfo;
  getLicense(): LicenseInfo | null;
}

@Injectable()
export class FeatureFlagsService {
  private license: LicenseInfo | null = null;
  private licenseEngine: LicenseEngine | null = null;

  private isDevBypassEnabled(): boolean {
    return process.env.DEV_LICENSE_BYPASS === 'true' && process.env.NODE_ENV !== 'production';
  }

  constructor(@Optional() licenseEngine?: LicenseEngine) {
    if (licenseEngine) {
      this.licenseEngine = licenseEngine;
    } else {
      try {
        const engine = require('@ecomate/license-engine');
        this.licenseEngine = engine.default || engine;
      } catch {
        if (this.isDevBypassEnabled()) {
          this.setDevLicense();
          console.warn('[FeatureFlags] License engine unavailable — DEV_LICENSE_BYPASS active');
        } else {
          this.license = { valid: false, code: 'engine_unavailable' };
          console.warn('[FeatureFlags] License engine unavailable — license required');
        }
      }
    }
  }

  async initialize(licenseKey: string, domain?: string, apiKey?: string) {
    if (this.licenseEngine) {
      try {
        const result = await this.licenseEngine.verify(licenseKey, domain, apiKey);
        if (result.valid) {
          this.license = result;
          return;
        }
        this.license = { valid: false, code: result.code || 'validation_failed' };
        return;
      } catch (err: any) {
        this.license = { valid: false, code: 'unreachable', detail: err.message };
        return;
      }
    }
    this.license = { valid: false, code: 'engine_unavailable' };
  }

  setLicense(token: string) {
    if (this.licenseEngine) {
      const result = this.licenseEngine.setLicense(token);
      if (result.valid) {
        this.license = result;
        return;
      }
    }
    this.license = { valid: false, code: 'invalid_token' };
  }

  setDevMode() {
    if (!this.isDevBypassEnabled()) return;
    this.setDevLicense();
  }

  private setDevLicense() {
    this.license = {
      valid: true,
      plan: { id: 'dev', name: 'Dev Mode', planType: 'fixed', price: 0 },
      features: [],
      limits: {},
      expiry: '2099-12-31T23:59:59Z',
    };
  }

  canUse(featureKey: string): boolean {
    if (!this.license?.valid) return false;
    if (this.licenseEngine) {
      return this.licenseEngine.canUseFeature(this.license, featureKey);
    }
    return this.license.valid;
  }

  getLicense(): LicenseInfo | null {
    return this.license;
  }
}
