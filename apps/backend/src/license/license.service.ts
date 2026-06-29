import { Injectable, OnModuleInit } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LicenseService implements OnModuleInit {
  constructor(
    private featureFlags: FeatureFlagsService,
    private config: ConfigService,
  ) {}

  async onModuleInit() {
    const licenseKey = this.config.get<string>('LICENSE_KEY');
    const keymateUrl = this.config.get<string>('KEYMATE_API_URL');

    if (!licenseKey || !keymateUrl) {
      this.featureFlags.setLicense(licenseKey || 'dev');
      console.log('[License] Dev mode — all features unrestricted');
      return;
    }

    const domain = this.config.get<string>('DOMAIN');
    const apiKey = this.config.get<string>('KEYMATE_API_KEY');

    try {
      await this.featureFlags.initialize(licenseKey, domain, apiKey);
      const lic = this.featureFlags.getLicense();
      if (lic?.valid) {
        console.log(`[License] Validated — plan: ${lic.plan?.name || 'custom'}`);
      } else {
        console.warn(`[License] KeyMate rejected: ${lic?.code}`);
        this.loadFromTokenOrDev();
      }
    } catch {
      console.warn('[License] KeyMate unreachable — using fallback');
      this.loadFromTokenOrDev();
    }
  }

  private loadFromTokenOrDev() {
    const token = this.config.get<string>('LICENSE_TOKEN');
    if (token) {
      this.featureFlags.setLicense(token);
      console.log('[License] Initialized from LICENSE_TOKEN');
    } else {
      this.featureFlags.setLicense('dev');
      console.log('[License] Dev mode — all features unrestricted');
    }
  }

  getStatus() {
    return {
      license: this.featureFlags.getLicense(),
      active: this.featureFlags.getLicense()?.valid ?? false,
    };
  }
}
