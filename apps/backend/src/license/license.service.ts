import { Injectable, OnModuleInit } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LicenseService implements OnModuleInit {
  constructor(
    private featureFlags: FeatureFlagsService,
    private config: ConfigService,
  ) {}

  onModuleInit() {
    const licenseToken = this.config.get<string>('LICENSE_TOKEN');
    if (licenseToken) {
      this.featureFlags.setLicense(licenseToken);
      console.log('[License] License initialized from LICENSE_TOKEN');
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
