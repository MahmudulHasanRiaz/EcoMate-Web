import { Injectable, Optional } from '@nestjs/common';
import { LicenseEngine } from '@ecomate/license-engine';

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
        this.license = { valid: false, code: 'engine_unavailable' };
        console.warn('[FeatureFlags] License engine unavailable — license required');
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
        this.license = { valid: false, code: result.code || 'validation_failed', detail: result.detail };
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
    this.license = { valid: false, code: 'engine_unavailable' };
  }

  isReady(): boolean {
    return this.license !== null;
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
