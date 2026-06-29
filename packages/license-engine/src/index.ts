import { ApiClient } from './api-client';
import { createCache, type CacheStore } from './cache';
import type { LicenseInfo, LicenseEngineOptions, LimitResult } from './types';

const DEFAULT_OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export type { LicenseInfo, LicenseEngineOptions, LimitResult, CacheStore };

export class LicenseEngine {
  private apiClient: ApiClient;
  private offlineGraceMs: number;
  private cache: CacheStore;
  private cachedLicense: LicenseInfo | null = null;
  private cachedLicenseKey: string | null = null;

  constructor(options: LicenseEngineOptions) {
    this.apiClient = new ApiClient(options.keymateUrl, options.apiKey);
    this.offlineGraceMs = options.offlineGraceMs ?? DEFAULT_OFFLINE_GRACE_MS;
    this.cache = createCache();
  }

  async verify(licenseKey: string, domain?: string, apiKey?: string): Promise<LicenseInfo> {
    try {
      const result = await this.apiClient.verify(licenseKey, domain, apiKey);

      if (result.valid) {
        this.cache.set(licenseKey, result, this.offlineGraceMs);
        this.cachedLicense = result;
        this.cachedLicenseKey = licenseKey;
      }

      return result;
    } catch {
      const cached = this.cache.get(licenseKey);
      if (cached) {
        return { ...cached, valid: true, detail: 'offline_cache' };
      }
      return { valid: false, code: 'unreachable' };
    }
  }

  async checkIn(licenseKey: string, domain?: string, apiKey?: string): Promise<LicenseInfo> {
    try {
      const result = await this.apiClient.checkIn(licenseKey, domain, apiKey);

      if (result.valid) {
        this.cache.set(licenseKey, result, this.offlineGraceMs);
      }

      this.cachedLicense = result;
      return result;
    } catch {
      const cached = this.cache.get(licenseKey);
      if (cached) {
        return { ...cached, valid: true, detail: 'offline_cache' };
      }
      return { valid: false, code: 'unreachable' };
    }
  }

  canUseFeature(license: LicenseInfo | null, featureKey: string): boolean {
    if (!license?.valid) return false;
    if (!license.features) return false;
    return license.features.includes(featureKey);
  }

  checkLimit(license: LicenseInfo | null, metricKey: string, currentUsage: number): LimitResult {
    if (!license?.valid) {
      return { ok: false, allowed: 0, current: currentUsage, remaining: 0 };
    }

    const allowed = license.limits?.[metricKey] ?? Infinity;
    const ok = currentUsage <= allowed;
    return {
      ok,
      allowed,
      current: currentUsage,
      remaining: Math.max(0, allowed - currentUsage),
    };
  }

  setLicense(token: string): LicenseInfo {
    const cached = this.cache.get(token);
    if (cached) {
      this.cachedLicense = cached;
      this.cachedLicenseKey = token;
      return cached;
    }
    this.cachedLicenseKey = token;
    return { valid: false, code: 'not_verified' };
  }

  getLicense(): LicenseInfo | null {
    return this.cachedLicense;
  }
}

let defaultInstance: LicenseEngine | null = null;

export function getDefaultEngine(options?: LicenseEngineOptions): LicenseEngine {
  if (!defaultInstance || options) {
    defaultInstance = new LicenseEngine(options || { keymateUrl: '' });
  }
  return defaultInstance;
}

const singleton = getDefaultEngine();
(singleton as any).LicenseEngine = LicenseEngine;
export default singleton;
