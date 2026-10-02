import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { EncryptionService } from './encryption';

/**
 * Ensures LICENSE_ENCRYPTION_KEY exists before anything tries to encrypt.
 *
 * The product decision is that licensing is provisioned through the admin app
 * by an owner, NOT through Portainer environment variables — so requiring an
 * operator to paste a 64-character hex secret into the deployment UI is both
 * inconvenient and a step they will get wrong.
 *
 * What this does instead:
 *
 *   1. If the environment variable is set, use it (an operator who manages the
 *      secret externally keeps full control, and that value wins).
 *   2. Otherwise read the key from the persistent license volume, so it
 *      survives restarts and redeploys.
 *   3. Otherwise generate 32 random bytes, write them to that volume with
 *      owner-only permissions, and use them.
 *
 * The important property is that the key is generated ONCE and then pinned. It
 * is never regenerated on a later boot, because doing so would make every
 * previously encrypted row — the license key, attendance device credentials,
 * marketing OAuth tokens — permanently unreadable.
 *
 * The volume is not shared with uploads, backups or mobile builds, so it is
 * not readable by anything else in the container.
 */
@Injectable()
export class EncryptionKeyProvisioner implements OnModuleInit {
  private readonly logger = new Logger(EncryptionKeyProvisioner.name);

  /** Where the generated key lives when no env var is supplied. */
  private readonly keyFile: string;

  constructor(private readonly encryption: EncryptionService) {
    const dir = process.env.LICENSE_DATA_DIR || '/app/license-data';
    this.keyFile = path.join(dir, 'encryption.key');
  }

  onModuleInit() {
    if (this.encryption.isConfigured()) {
      this.logger.log('[Encryption] Using LICENSE_ENCRYPTION_KEY from the environment');
      return;
    }

    try {
      const existing = this.readStoredKey();
      if (existing) {
        process.env.LICENSE_ENCRYPTION_KEY = existing;
        this.logger.log(
          `[Encryption] Using the encryption key stored in ${this.keyFile} ` +
            '(keep this volume; losing it makes encrypted data unreadable)',
        );
        return;
      }

      const generated = crypto.randomBytes(32).toString('hex');
      this.writeStoredKey(generated);
      process.env.LICENSE_ENCRYPTION_KEY = generated;
      this.logger.log(
        `[Encryption] Generated a new encryption key and stored it in ${this.keyFile}. ` +
          'Back up this volume — it is required to decrypt stored credentials.',
      );
    } catch (err: any) {
      // Fail loudly rather than falling back to anything predictable. An
      // operator needs to know the key was not persisted.
      this.logger.error(
        `[Encryption] Could not provision an encryption key: ${err.message}. ` +
          'Set LICENSE_ENCRYPTION_KEY explicitly, or make the license volume writable.',
      );
      throw err;
    }
  }

  private readStoredKey(): string | null {
    if (!fs.existsSync(this.keyFile)) return null;
    const value = fs.readFileSync(this.keyFile, 'utf8').trim();
    return value.length === 64 ? value : null;
  }

  private writeStoredKey(key: string) {
    fs.mkdirSync(path.dirname(this.keyFile), { recursive: true });
    // 0600: readable only by the container user that runs the app.
    fs.writeFileSync(this.keyFile, key, { mode: 0o600 });
    fs.chmodSync(this.keyFile, 0o600);
  }
}
