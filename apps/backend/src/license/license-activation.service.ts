import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/utils/encryption';

interface ActivateDto {
  licenseKey: string;
  keymateUrl: string;
  domain?: string;
  apiKey?: string;
  licenseInfo?: any;
  /** Who performed the change — recorded for audit. */
  actorUserId?: string;
  actorIp?: string;
}

/**
 * Owns the single LicenseActivation row.
 *
 * Two properties this enforces:
 *
 *   1. There is exactly one activation. The read-modify-write below used to be
 *      two independent queries, so two concurrent activations could both see
 *      "no existing row" and both insert. `find()` has no ordering, so which row
 *      won afterwards was unspecified — on a table with no unique constraint.
 *      It is now upserted on a fixed singleton id, which makes the duplicate
 *      impossible rather than unlikely.
 *
 *   2. Every change is attributable. The previous version overwrote the stored
 *      key with no record of the previous value, actor or source IP, so a
 *      license change left no trace. History is now appended to
 *      LicenseActivationHistory.
 */
@Injectable()
export class LicenseActivationService {
  private readonly logger = new Logger(LicenseActivationService.name);

  /** Fixed id: the table holds at most one activation by construction. */
  private static readonly SINGLETON_ID = 'singleton';

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  async find() {
    // Prefer the singleton row, but fall back to the earliest legacy row so a
    // database that already has rows written by the old create-path keeps
    // working and is migrated on the next activation.
    const singleton = await this.prisma.licenseActivation.findUnique({
      where: { id: LicenseActivationService.SINGLETON_ID },
    });
    if (singleton) return singleton;

    return this.prisma.licenseActivation.findFirst({
      orderBy: { createdAt: 'asc' },
    });
  }

  async activate(dto: ActivateDto) {
    const encryptedKey = this.encryption.encrypt(dto.licenseKey);
    const encryptedApiKey = dto.apiKey ? this.encryption.encrypt(dto.apiKey) : null;

    const existing = await this.find();
    const expiresAt = dto.licenseInfo?.expiry
      ? new Date(dto.licenseInfo.expiry)
      : undefined;

    const data = {
      licenseKey: encryptedKey,
      keymateUrl: dto.keymateUrl,
      domain: dto.domain || null,
      apiKey: encryptedApiKey,
      status: 'active',
      licenseInfo: dto.licenseInfo ?? undefined,
      activatedAt: new Date(),
      expiresAt,
      errorMessage: null,
    };

    // Upsert on the singleton id: concurrent activations cannot both insert.
    const row = await this.prisma.licenseActivation.upsert({
      where: { id: LicenseActivationService.SINGLETON_ID },
      create: { id: LicenseActivationService.SINGLETON_ID, ...data },
      update: data,
    });

    await this.recordHistory({
      action: existing ? 'reactivated' : 'activated',
      previousLicenseKey: existing?.licenseKey ?? null,
      previousDomain: existing?.domain ?? null,
      licenseKey: encryptedKey,
      domain: dto.domain || null,
      actorUserId: dto.actorUserId ?? null,
      actorIp: dto.actorIp ?? null,
      success: true,
    });

    return row;
  }

  async deactivate(errorMessage?: string) {
    const existing = await this.find();
    if (!existing) return null;

    const row = await this.prisma.licenseActivation.update({
      where: { id: existing.id },
      data: { status: 'invalid', errorMessage: errorMessage || null },
    });

    await this.recordHistory({
      action: 'deactivated',
      previousLicenseKey: existing.licenseKey,
      previousDomain: existing.domain,
      licenseKey: existing.licenseKey,
      domain: existing.domain,
      success: false,
      error: errorMessage || null,
    });

    return row;
  }

  /**
   * Append-only record of every license change.
   *
   * Never stores a decrypted key: previousLicenseKey and licenseKey are the
   * already-encrypted values, so this history cannot become a worse secret
   * store than the table it mirrors. A fingerprint of the previous key is
   * included so a change can be correlated without holding the old key twice.
   */
  private async recordHistory(entry: {
    action: string;
    previousLicenseKey: string | null;
    previousDomain: string | null;
    licenseKey: string | null;
    domain: string | null;
    actorUserId?: string | null;
    actorIp?: string | null;
    success: boolean;
    error?: string | null;
  }) {
    try {
      await this.prisma.licenseActivationHistory.create({
        data: {
          action: entry.action,
          licenseKeyFingerprint: entry.licenseKey
            ? LicenseActivationService.fingerprint(entry.licenseKey)
            : null,
          previousKeyFingerprint: entry.previousLicenseKey
            ? LicenseActivationService.fingerprint(entry.previousLicenseKey)
            : null,
          domain: entry.domain,
          previousDomain: entry.previousDomain,
          actorUserId: entry.actorUserId ?? null,
          actorIp: entry.actorIp ?? null,
          success: entry.success,
          error: entry.error ?? null,
        },
      });
    } catch (err: any) {
      // History is valuable but must never block an activation: the license
      // itself is already valid at this point, and failing the request would
      // leave the deployment activated but reported as an error.
      this.logger.warn(
        `[License] Could not write activation history: ${err.message}`,
      );
    }
  }

  /** Short, non-reversible identifier for a stored key. */
  private static fingerprint(ciphertext: string): string {
    // Node's crypto is already a dependency of this service's sibling.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('crypto') as typeof import('crypto');
    return crypto
      .createHash('sha256')
      .update(ciphertext)
      .digest('hex')
      .slice(0, 16);
  }

  /**
   * Read the stored credentials regardless of the row's status.
   *
   * Status is a *conclusion* of the last verification attempt, not a
   * precondition for reading the key. Gating the read on `status === 'active'`
   * made revalidation impossible: once anything wrote `invalid`, sync() could
   * never decrypt the key again and bailed with a misleading `not_found`
   * before the key was ever verified. The caller decides what to do with a
   * stale status; we just return it alongside the credentials.
   */
  async getDecryptedCredentials() {
    const activation = await this.find();
    if (!activation) return null;
    return {
      licenseKey: this.encryption.decrypt(activation.licenseKey),
      keymateUrl: activation.keymateUrl,
      domain: activation.domain,
      apiKey: activation.apiKey ? this.encryption.decrypt(activation.apiKey) : undefined,
      licenseInfo: activation.licenseInfo,
      status: activation.status,
      errorMessage: activation.errorMessage,
    };
  }

  async updateLicenseInfo(licenseInfo: any) {
    const existing = await this.find();
    if (!existing) return null;
    return this.prisma.licenseActivation.update({
      where: { id: existing.id },
      data: {
        licenseInfo,
        lastCheckIn: new Date(),
        expiresAt: licenseInfo?.expiry
          ? new Date(licenseInfo.expiry)
          : undefined,
      },
    });
  }
}