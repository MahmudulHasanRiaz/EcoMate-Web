import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { FeatureFlagsService } from '@ecomate/feature-flags';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
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

/**
 * Verification codes that describe the licence itself rather than the state of
 * the connection to the licence server. Only these may persist
 * `status: 'invalid'` on the activation row.
 *
 * The transient codes (`unreachable`, `offline_cache`, `not_verified`,
 * `engine_unavailable`) describe a temporarily unavailable server or a
 * not-yet-finished startup. Persisting them as terminal `invalid` used to
 * permanently brick the licence after a momentary KeyMate outage, which forced
 * a manual re-submit — the opposite of the log message ("will retry on next
 * request") that claimed a retry existed.
 */
const TERMINAL_CODES = new Set([
  'expired',
  'domain_mismatch',
  'unauthorized',
  'invalid_api_key',
  'validation_failed',
  'invalid_token',
  'not_found',
]);

/**
 * Normalise a hostname for licence verification: lowercase and port-stripped.
 * Handles IPv6 literals (`[::1]:4000`) by leaving the bracketed form intact.
 */
export function normalizeDomain(host?: string | null): string | undefined {
  if (!host) return undefined;
  let h = host.trim().toLowerCase();
  const ipv6 = h.startsWith('[');
  if (ipv6) {
    const close = h.indexOf(']');
    return close >= 0 ? h.slice(0, close + 1) : h;
  }
  const portIdx = h.lastIndexOf(':');
  if (portIdx > 0) h = h.slice(0, portIdx);
  return h || undefined;
}

function friendlyError(code?: string, fallback?: string): string {
  if (!code) return fallback || 'An unknown error occurred.';
  return ERROR_MESSAGES[code] || `License error: ${code}`;
}

@Injectable()
export class LicenseService implements OnModuleInit {
  private readonly logger = new Logger(LicenseService.name);

  constructor(
    private prisma: PrismaService,
    private featureFlags: FeatureFlagsService,
    private config: ConfigService,
    private licenseActivation: LicenseActivationService,
  ) {}

  async onModuleInit() {
    if (await this.prisma.isRestoreWriteBlocked()) {
      this.logger.warn(
        '[License] Initialization deferred while a database restore is active',
      );
      const retry = setTimeout(() => void this.onModuleInit(), 60_000);
      retry.unref();
      return;
    }

    try {
      const activation = await this.licenseActivation.find();
      if (!activation) {
        const msg =
          process.env.NODE_ENV === 'production'
            ? '[License] NO ACTIVE LICENSE — gating all routes'
            : '[License] No active activation found — setup required via UI';
        this.logger.warn(msg);
        return;
      }

      let creds;
      try {
        creds = await this.licenseActivation.getDecryptedCredentials();
      } catch (err: any) {
        this.logger.warn(
          '[License] Failed to decrypt stored credentials — encryption key may have changed',
        );
        if (
          process.env.SKIP_LICENSE_CHECK !== 'true' &&
          !(await this.prisma.isRestoreWriteBlocked())
        ) {
          await this.licenseActivation.deactivate('decryption_failed');
        }
        return;
      }
      if (!creds) return;

      const { licenseKey, domain, apiKey } = creds;

      await this.featureFlags.initializeWithEngine(
        licenseKey,
        domain ?? undefined,
        apiKey ?? undefined,
      );
      const lic = this.featureFlags.getLicense();
      if (lic?.valid) {
        this.logger.log(
          `[License] Validated — plan: ${lic.plan?.name || 'custom'}`,
        );
        if (!(await this.prisma.isRestoreWriteBlocked())) {
          if (activation.status === 'active') {
            await this.licenseActivation.updateLicenseInfo(lic);
          } else {
            // A previously invalid row re-verified successfully (e.g. after a
            // transient outage or a renewed key on the licence server). Reactivate
            // it so the guard stops gating — no manual re-submit required.
            this.logger.log(
              '[License] Previously invalid license re-validated — reactivating',
            );
            await this.licenseActivation.activate({
              licenseKey,
              keymateUrl: creds.keymateUrl,
              domain: domain ?? undefined,
              apiKey,
              licenseInfo: lic,
            });
          }
        }
      } else if (process.env.SKIP_LICENSE_CHECK !== 'true') {
        const code = lic?.code || 'unknown';
        if (TERMINAL_CODES.has(code)) {
          this.logger.warn(`[License] ${friendlyError(code)}`);
          if (!(await this.prisma.isRestoreWriteBlocked())) {
            await this.licenseActivation.deactivate(code);
          }
        } else {
          // Transient failure (server unreachable, engine still loading, ...).
          // Leave the stored row untouched: it may still be 'active', and once
          // the licence server is reachable again the next startup or sync
          // recovers without re-entering the key.
          this.logger.warn(
            `[License] Transient verification failure (${code}) — retry will happen on next startup or sync`,
          );
        }
      }
    } catch (err: any) {
      if (
        err?.message?.toLowerCase().includes('fetch') ||
        err?.message?.toLowerCase().includes('econnrefused') ||
        err?.message?.toLowerCase().includes('network')
      ) {
        this.logger.warn(
          '[License] KeyMate server unreachable — will retry on next startup or sync',
        );
      } else if (err?.message?.toLowerCase().includes('decrypt')) {
        this.logger.warn('[License] Failed to decrypt stored credentials');
      } else {
        this.logger.warn(
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
    actorUserId?: string,
    actorIp?: string,
  ) {
    const keymateUrl =
      this.config.get<string>('KEYMATE_API_URL') ||
      'https://keygen-keymate.commercians.com/v1/saas';

    try {
      await this.featureFlags.initializeWithEngine(licenseKey, domain, apiKey);
      const lic = this.featureFlags.getLicense();

      if (lic?.valid) {
        await this.licenseActivation.activate({
          licenseKey,
          keymateUrl,
          domain,
          apiKey,
          licenseInfo: lic,
          // Recorded so a license change is attributable. Previously the
          // endpoint was anonymous and nothing recorded who changed it.
          actorUserId,
          actorIp,
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

  /**
   * Re-verify the stored license ("Sync & Revalidate").
   *
   * Reads the stored key regardless of the row's current status — the old
   * `status === 'active'` gate made this a permanent deadlock: once anything
   * wrote `invalid`, the key could never be read again and sync always
   * reported `not_found` before verification even happened.
   *
   * Domain handling is self-healing: the licence server is asked about the
   * *current* hostname first (so a redeploy behind a new host works), and if it
   * answers `domain_mismatch` the *stored* domain is retried (so installs whose
   * licensed domain is not the current Host header keep working). Only when
   * both fail is the failure persisted.
   *
   * Transient failures (server unreachable, engine loading) never persist
   * `invalid`; terminal failures (expired, domain mismatch, bad API key) do.
   */
  async sync(currentDomain?: string) {
    const activation = await this.licenseActivation.find();
    if (!activation) {
      return {
        success: false,
        error: 'not_found',
        message: 'No license found to sync.',
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

    const oldFeatures = this.featureFlags.getActiveFeatures();
    const { licenseKey, keymateUrl, domain: storedDomain, apiKey } = creds;

    const current = normalizeDomain(currentDomain);
    const stored = normalizeDomain(storedDomain);

    let result = await this.activateWithKeymate(
      licenseKey,
      current ?? stored ?? '',
      apiKey || undefined,
    );

    if (
      !result.success &&
      result.error === 'domain_mismatch' &&
      stored &&
      stored !== current
    ) {
      result = await this.activateWithKeymate(
        licenseKey,
        stored,
        apiKey || undefined,
      );
    }

    if (result.success) {
      // activateWithKeymate already reset status to 'active' via the upsert;
      // this records a fresh check-in so the audit trail shows the revalidation.
      if (!(await this.prisma.isRestoreWriteBlocked())) {
        await this.licenseActivation.updateLicenseInfo(result.license);
      }
      const newFeatures = result.license?.features ?? [];
      await this.handleDowngrade(oldFeatures, newFeatures);
      return result;
    }

    if (result.error && TERMINAL_CODES.has(result.error)) {
      if (!(await this.prisma.isRestoreWriteBlocked())) {
        await this.licenseActivation.deactivate(result.error);
      }
    }
    // Transient failures: return the honest result and leave the stored row
    // untouched — the next sync or restart can still recover.

    return result;
  }

  private async handleDowngrade(oldFeatures: string[], newFeatures: string[]) {
    const newSet = new Set(newFeatures);
    const removed = oldFeatures.filter((f) => !newSet.has(f));

    for (const feature of removed) {
      switch (feature) {
        case 'admin_inventory':
          await this.revertInventoryControlledProducts();
          break;
      }
    }
  }

  private async revertInventoryControlledProducts() {
    const result = await this.prisma.product.updateMany({
      where: { availabilityMode: 'INVENTORY_CONTROLLED' },
      data: { availabilityMode: 'MANAGED_STOCK' },
    });
    if (result.count > 0) {
      this.logger.log(
        `[License] Downgrade: reverted ${result.count} products from INVENTORY_CONTROLLED to MANAGED_STOCK`,
      );
    }
  }

  /**
   * @param includeDetails when false (anonymous callers) the response is reduced
   * to what the sign-in screen needs. The full payload names the plan, its
   * price, every unlocked feature, the usage limits and the authorised
   * domains — useful reconnaissance for anyone who can reach the endpoint.
   */
  getStatus(opts: { includeDetails?: boolean } = {}) {
    const includeDetails = opts.includeDetails !== false;
    const lic = this.featureFlags.getLicense();
    const features = this.featureFlags.getActiveFeatures();
    const isDevMode = !lic && features.length === 0;
    const active = isDevMode || (lic?.valid ?? false);
    const effectiveFeatures = isDevMode ? ['*'] : (lic?.features ?? []);
    let state = 'unknown';
    if (!lic && !isDevMode) state = 'uninitialized';
    else if (isDevMode) state = 'active';
    else if (active) state = 'active';
    else if (lic?.code === 'unreachable' || lic?.code === 'offline_cache')
      state = 'offline';
    else if (lic.code === 'expired') state = 'expired';
    else if (lic.code) state = lic.code;
    else state = 'invalid';

    const keymateApiUrl =
      this.config.get<string>('KEYMATE_API_URL') ||
      'https://keygen-keymate.commercians.com/v1/saas';
    const dashboardUrl = keymateApiUrl.replace(/\/v1\/saas\/?$/, '');
    const dashboardUrlFinal = dashboardUrl || keymateApiUrl;

    return {
      active,
      state,
      // The feature list drives client-side gating, so the active set is
      // always returned; it is not sensitive on its own.
      features: effectiveFeatures,
      dashboardUrl: dashboardUrlFinal,
      message: active
        ? `License active — ${lic?.plan?.name || 'custom'} plan`
        : friendlyError(lic?.code, 'License not activated'),
      code: lic?.code || null,
      // Plan, price, limits, domains and the full license object are admin-only.
      ...(includeDetails ? { license: lic } : {}),
    };
  }
}
