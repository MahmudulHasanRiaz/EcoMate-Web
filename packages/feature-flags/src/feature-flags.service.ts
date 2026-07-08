import { Injectable, Optional } from '@nestjs/common';
import { DEPENDENCY_MAP } from '@ecomate/shared-types';
import { LicenseEngine } from '@ecomate/license-engine';

@Injectable()
export class FeatureFlagsService {
  private activeFeatures: Set<string> = new Set();
  private license: any = null;
  private licenseEngine: LicenseEngine | null = null;

  constructor(@Optional() licenseEngine?: LicenseEngine) {
    if (licenseEngine) {
      this.licenseEngine = licenseEngine;
    }
  }

  canUse(featureKey: string): boolean {
    if (this.license?.valid) {
      if (this.license?.features?.includes('*')) return true;
      if (this.licenseEngine) {
        return this.licenseEngine.canUseFeature(this.license, featureKey);
      }
      return this.license.features?.includes(featureKey) ?? false;
    }
    if (this.activeFeatures.has('*')) return true;
    return this.activeFeatures.has(featureKey);
  }

  getActiveFeatures(): string[] {
    if (this.license?.features?.includes('*')) return [];
    if (this.license?.features) return this.license.features;
    return Array.from(this.activeFeatures);
  }

  setLicense(features: string[]) {
    this.activeFeatures = new Set(features);
    this.license = { valid: true, features };
  }

  validateDependencies(features: string[]): string[] {
    const featureSet = new Set(features);
    let changed = true;
    let result = [...features];

    while (changed) {
      changed = false;
      const currentSet = new Set(result);
      result = result.filter(f => {
        const deps = DEPENDENCY_MAP[f];
        if (!deps || deps.length === 0) return true;
        const allMet = deps.every(d => currentSet.has(d));
        if (!allMet) changed = true;
        return allMet;
      });
    }

    return result;
  }

  initialize(features: string[]) {
    const validated = this.validateDependencies(features);
    this.setLicense(validated);
    return validated;
  }

  async initializeWithEngine(licenseKey: string, domain?: string, apiKey?: string) {
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

  isReady(): boolean {
    return this.license !== null || this.activeFeatures.size > 0;
  }

  getLicense(): any {
    return this.license;
  }
}
