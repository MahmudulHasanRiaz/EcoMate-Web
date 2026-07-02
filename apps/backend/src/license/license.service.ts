import { Injectable, OnModuleInit } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { ConfigService } from '@nestjs/config';
import { LicenseActivationService } from './license-activation.service';

const ERROR_MESSAGES: Record<string, string> = {
  not_found: 'License key not found in system. Please verify your license key.',
  domain_mismatch:
    'Domain mismatch. This license is not valid for this domain.',
  expired: 'License has expired. Please renew your license to continue.',
  invalid_api_key: 'Invalid API key. The KeyMate server rejected the request.',
  unauthorized: 'Authorization failed. Please check your API key.',
  unreachable:
    'Cannot reach KeyMate server. Check KEYMATE_API_URL, server status, and network.',
  engine_unavailable:
    'License engine failed to load. Please restart the application.',
  not_verified:
    'License not yet verified. Please wait for initialization to complete.',
  validation_failed:
    'License validation failed. Please contact support with your license key.',
  invalid_token: 'Invalid license token. Please reactivate your license.',
  keymate_unreachable:
    'Cannot reach KeyMate server. Check KEYMATE_API_URL, server status, and network.',
  offline_cache:
    'License server unreachable — using cached license. Some features may be limited.',
};

function friendlyError(code?: string, fallback?: string): string {
  if (!code) return fallback || 'An unknown error occurred.';
  return ERROR_MESSAGES[code] || `License error: ${code}`;
}

@Injectable()
export class LicenseService implements OnModuleInit {
  constructor(
    private featureFlags: FeatureFlagsService,
    private config: ConfigService,
    private licenseActivation: LicenseActivationService,
  ) {}

  async onModuleInit() {
    try {
      const activation = await this.licenseActivation.find();
      if (!activation || activation.status !== 'active') {
        const msg =
          process.env.NODE_ENV === 'production'
            ? '[License] NO ACTIVE LICENSE — gating all routes'
            : '[License] No active activation found — setup required via UI';
        console.warn(msg);
        return;
      }

      let creds;
      try {
        creds = await this.licenseActivation.getDecryptedCredentials();
      } catch (err: any) {
        console.warn(
          '[License] Failed to decrypt stored credentials — encryption key may have changed',
        );
        await this.licenseActivation.deactivate('decryption_failed');
        return;
      }
      if (!creds) return;

      const { licenseKey, domain, apiKey } = creds;

      await this.featureFlags.initialize(
        licenseKey,
        domain ?? undefined,
        apiKey ?? undefined,
      );
      const lic = this.featureFlags.getLicense();
      if (lic?.valid) {
        console.log(
          `[License] Validated — plan: ${lic.plan?.name || 'custom'}`,
        );
        await this.licenseActivation.updateLicenseInfo(lic);
      } else {
        const code = lic?.code || 'unknown';
        console.warn(`[License] ${friendlyError(code)}`);
        await this.licenseActivation.deactivate(code);
      }
    } catch (err: any) {
      if (
        err?.message?.toLowerCase().includes('fetch') ||
        err?.message?.toLowerCase().includes('econnrefused') ||
        err?.message?.toLowerCase().includes('network')
      ) {
        console.warn(
          '[License] KeyMate server unreachable — will retry on next request',
        );
      } else if (err?.message?.toLowerCase().includes('decrypt')) {
        console.warn('[License] Failed to decrypt stored credentials');
      } else {
        console.warn(
          '[License] Failed to validate license:',
          err?.message || err,
        );
      }
    }
  }

  async activateWithKeymate(
    licenseKey: string,
    domain: string,
    apiKey?: string,
  ) {
    const keymateUrl =
      this.config.get<string>('KEYMATE_API_URL') ||
      'https://keygen-keymate.commercians.com/v1/saas';

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

      const code = lic?.code || 'validation_failed';
      return {
        success: false,
        error: code,
        message: friendlyError(
          code,
          'Activation failed. Please check your license key.',
        ),
        license: lic,
      };
    } catch (err: any) {
      return {
        success: false,
        error: 'keymate_unreachable',
        message: friendlyError('keymate_unreachable'),
        detail: err.message,
      };
    }
  }

  async sync() {
    const activation = await this.licenseActivation.find();
    if (!activation) {
      return {
        success: false,
        error: 'not_found',
        message: 'No active license found to sync.',
      };
    }
    let creds;
    try {
      creds = await this.licenseActivation.getDecryptedCredentials();
    } catch (err: any) {
      return {
        success: false,
        error: 'decryption_failed',
        message: 'Failed to decrypt stored credentials.',
      };
    }
    if (!creds) {
      return {
        success: false,
        error: 'not_found',
        message: 'License credentials not found.',
      };
    }

    const { licenseKey, domain, apiKey } = creds;
    return this.activateWithKeymate(licenseKey, domain, apiKey || undefined);
  }

  getStatus() {
    const lic = this.featureFlags.getLicense();
    const active = lic?.valid ?? false;
    let state = 'unknown';
    if (!lic) state = 'uninitialized';
    else if (active) state = 'active';
    else if (lic.code === 'unreachable' || lic.code === 'offline_cache')
      state = 'offline';
    else if (lic.code === 'expired') state = 'expired';
    else if (lic.code) state = lic.code;
    else state = 'invalid';

    return {
      active,
      state,
      message: active
        ? `License active — ${lic?.plan?.name || 'custom'} plan`
        : friendlyError(lic?.code, 'License not activated'),
      license: lic,
      code: lic?.code || null,
    };
  }
}
