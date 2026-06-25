import { Injectable, Optional } from '@nestjs/common';
export { REQUIRES_FEATURE_KEY, RequiresFeature } from './decorator';
export { FeatureGuard } from './guard';

export interface LicenseInfo {
  valid: boolean;
  clientId: string;
  plan: string;
  packages: string[];
  customFeatures: string[];
  limits: { cpus: number; memory: string; users: number; stores: number };
  exp: number;
}

@Injectable()
export class FeatureFlagsService {
  private license: LicenseInfo | null = null;
  private licenseEngine: any;

  constructor(@Optional() licenseEngine?: any) {
    if (licenseEngine) {
      this.licenseEngine = licenseEngine;
    } else {
      try {
        this.licenseEngine = require('@ecomate/license-engine');
      } catch {
        console.warn('[FeatureFlags] License engine unavailable — running in dev mode');
      }
    }
  }

  setLicense(token: string) {
    if (this.licenseEngine) {
      const result = this.licenseEngine.verify(token);
      if (result && result.valid) {
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
      clientId: 'dev',
      plan: 'ultimate',
      packages: [],
      customFeatures: [],
      limits: { cpus: 999, memory: '999G', users: 999, stores: 999 },
      exp: 9999999999,
    };
  }

  canUse(featureKey: string): boolean {
    if (!this.license || !this.license.valid) return false;
    if (this.licenseEngine) {
      return this.licenseEngine.canUseFeature(this.license, featureKey);
    }
    return true;
  }

  getLicense(): LicenseInfo | null {
    return this.license;
  }
}
