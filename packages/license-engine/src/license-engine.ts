import type { LicenseInfo, LicenseEngineOptions, LicensePayload } from './types';
import { ApiClient } from './api-client';
import { verifyToken } from './verifier';

export class LicenseEngine {
  private apiClient: ApiClient | null = null;
  private licenseInfo: LicenseInfo | null = null;

  constructor(options?: LicenseEngineOptions) {
    if (options?.keymateUrl) {
      this.apiClient = new ApiClient(options.keymateUrl, options.apiKey);
    }
  }

  getLicense(): LicenseInfo | null {
    return this.licenseInfo;
  }

  async verify(licenseKey: string, domain?: string, apiKey?: string): Promise<LicenseInfo> {
    if (!this.apiClient) {
      this.licenseInfo = { valid: false, code: 'engine_unavailable' };
      return this.licenseInfo;
    }
    try {
      const raw = await this.apiClient.verify(licenseKey, domain, apiKey);
      const features: string[] = raw?.features ?? raw?.data?.features ?? [];
      const plan = raw?.plan ?? raw?.data?.plan;
      this.licenseInfo = {
        valid: Array.isArray(features) && features.length > 0,
        code: raw?.code,
        detail: raw?.detail,
        plan: plan ? { id: plan.id || plan, name: plan.name || plan, planType: plan.planType || '', price: plan.price || 0 } : undefined,
        features,
        limits: raw?.limits ?? raw?.data?.limits,
        domains: raw?.domains ?? raw?.data?.domains,
        expiry: raw?.expiry ?? raw?.data?.expiry,
        lastCheckIn: raw?.lastCheckIn ?? raw?.data?.lastCheckIn,
      };
    } catch (err: any) {
      this.licenseInfo = { valid: false, code: 'unreachable', detail: err.message };
    }
    return this.licenseInfo;
  }

  canUseFeature(license: LicenseInfo, featureKey: string): boolean {
    if (!license.valid) return false;
    if (license.features?.includes('*')) return true;
    return license.features?.includes(featureKey) ?? false;
  }

  setLicense(token: string): LicenseInfo {
    const result = verifyToken(token);
    if (!result.valid || !result.payload) {
      this.licenseInfo = { valid: false, code: result.reason || 'validation_failed' };
      return this.licenseInfo;
    }
    const payload: LicensePayload = result.payload;
    this.licenseInfo = {
      valid: true,
      features: payload.features,
      domains: payload.domains,
      limits: payload.limits,
      expiry: payload.exp ? new Date(payload.exp * 1000).toISOString() : undefined,
      plan: { id: payload.plan, name: payload.plan, planType: '', price: 0 },
    };
    return this.licenseInfo;
  }

  checkIn(): boolean {
    return this.licenseInfo !== null && this.licenseInfo.valid === true;
  }
}
