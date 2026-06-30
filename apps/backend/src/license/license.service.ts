import { Injectable, OnModuleInit } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { ConfigService } from '@nestjs/config';
import { LicenseActivationService } from './license-activation.service';

@Injectable()
export class LicenseService implements OnModuleInit {
  constructor(
    private featureFlags: FeatureFlagsService,
    private config: ConfigService,
    private licenseActivation: LicenseActivationService,
  ) {}

  async onModuleInit() {
    const activation = await this.licenseActivation.find();

    if (!activation || activation.status !== 'active') {
      console.log('[License] No active activation found — setup required via UI');
      return;
    }

    const creds = await this.licenseActivation.getDecryptedCredentials();
    if (!creds) return;

    const { licenseKey, domain, apiKey } = creds;

    try {
      await this.featureFlags.initialize(licenseKey, domain, apiKey);
      const lic = this.featureFlags.getLicense();
      if (lic?.valid) {
        console.log(`[License] Validated — plan: ${lic.plan?.name || 'custom'}`);
        await this.licenseActivation.updateLicenseInfo(lic);
      } else {
        console.warn(`[License] KeyMate rejected: ${lic?.code}`);
        await this.licenseActivation.deactivate(lic?.code);
      }
    } catch {
      console.warn('[License] KeyMate unreachable — using cached data');
    }
  }

  async activateWithKeymate(licenseKey: string, domain: string, apiKey?: string) {
    const keymateUrl = this.config.get<string>('KEYMATE_API_URL')
      || 'https://keygen-keymate.commercians.com/api/v1/saas';

    try {
      await this.featureFlags.initialize(licenseKey, domain, apiKey);
      const lic = this.featureFlags.getLicense();

      if (lic?.valid) {
        await this.licenseActivation.activate({
          licenseKey,
          keymateUrl,
          domain,
          apiKey,
          licenseInfo: lic,
        });
        return { success: true, license: lic };
      }

      return { success: false, error: lic?.code || 'validation_failed', license: lic };
    } catch (err: any) {
      return { success: false, error: 'keymate_unreachable', detail: err.message };
    }
  }

  getStatus() {
    return {
      license: this.featureFlags.getLicense(),
      active: this.featureFlags.getLicense()?.valid ?? false,
    };
  }
}
