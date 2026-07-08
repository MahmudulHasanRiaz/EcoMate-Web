import { Injectable } from '@nestjs/common';
import { DEPENDENCY_MAP } from '@ecomate/shared-types';

@Injectable()
export class FeatureFlagsService {
  private activeFeatures: Set<string> = new Set();

  canUse(featureKey: string): boolean {
    if (this.activeFeatures.has('*')) return true;
    return this.activeFeatures.has(featureKey);
  }

  getActiveFeatures(): string[] {
    return Array.from(this.activeFeatures);
  }

  setLicense(features: string[]) {
    this.activeFeatures = new Set(features);
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
}
