import { LicenseInfo, type LicenseInfoResponse } from '@ecomate/shared-types';

export class LicenseEngine {
  private licenseInfo: LicenseInfo | null = null;

  getLicense(): LicenseInfo | null {
    return this.licenseInfo;
  }

  verify(response: LicenseInfoResponse): LicenseInfo {
    this.licenseInfo = new LicenseInfo({
      features: response.features,
      raw: response,
    });
    return this.licenseInfo;
  }

  checkIn(): boolean {
    return this.licenseInfo !== null;
  }
}
