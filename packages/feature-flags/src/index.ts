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

  constructor(@Optional() licenseEngine?: LicenseEngine) {
    if (licenseEngine) {
      this.licenseEngine = licenseEngine;
    } else {
      try {
        const engine = require('@ecomate/license-engine');
        this.licenseEngine = engine.default || engine;
      } catch {
        console.warn('[FeatureFlags] License engine unavailable — running in dev mode');
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
      } catch {
        // fall through to dev mode
      }
    }
    this.setDevLicense();
  }

  setLicense(token: string) {
    if (this.licenseEngine) {
      const result = this.licenseEngine.setLicense(token);
      if (result.valid) {
        this.license = result;
      } else {
        this.setDevLicense();
      }
    } else {
      this.setDevLicense();
    }
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
    return true;
  }

  getLicense(): LicenseInfo | null {
    return this.license;
  }
}
