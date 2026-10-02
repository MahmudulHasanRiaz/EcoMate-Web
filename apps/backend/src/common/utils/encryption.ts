import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * Authenticated encryption for data that must never be readable from a leaked
 * database dump: the stored license key, attendance device credentials, and
 * marketing OAuth tokens.
 *
 * Security posture — fail closed, not open:
 *
 *   An earlier version fell back to a hard-coded key committed to this repo
 *   when LICENSE_ENCRYPTION_KEY was unset. Anyone with source access could then
 *   decrypt every deployment that never overrode it, and the failure was silent
 *   apart from a log warning. Worse, the posture was inverted: NOT setting a
 *   key kept things working, while SETTING a real one made previously stored
 *   rows undecryptable and deactivated the license. A security control that
 *   breaks when used correctly is worse than no control at all.
 *
 *   There is now no fallback. A missing or malformed key throws at startup with
 *   an actionable message, so a deployment is either correctly encrypted or it
 *   refuses to boot. The variable name is LICENSE_ENCRYPTION_KEY for historical
 *   reasons; it protects more than the license (see the usage note below).
 *
 * Key migration: changing this key makes existing ciphertext unreadable. There
 * is no re-encryption routine, so treat the key as permanent and back it up
 * alongside the database. Set it before the first activation.
 *
 * Uses AES-256-GCM with a fresh random 128-bit IV per encryption and the
 * authentication tag stored alongside the ciphertext, so tampering is detected
 * on decrypt rather than producing garbage.
 */
@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly algorithm = 'aes-256-gcm';
  private readonly ivLength = 16;
  private readonly tagLength = 16;
  private readonly expectedKeyBytes = 32;

  private getKey(): Buffer {
    const raw = process.env.LICENSE_ENCRYPTION_KEY;

    if (!raw || !raw.trim()) {
      throw new Error(
        'LICENSE_ENCRYPTION_KEY is not set. It protects the license key, ' +
          'attendance device credentials and marketing OAuth tokens at rest, ' +
          'and has no safe default. Generate one with `openssl rand -hex 32` ' +
          'and set it in the environment BEFORE first activation. ' +
          'Changing it later makes existing encrypted data unreadable.',
      );
    }

    return EncryptionService.parseKey(raw);
  }

  /**
   * Validate and decode a hex key, with a message an operator can act on.
   * Split out so the startup self-provisioning path validates identically.
   */
  private static parseKey(raw: string): Buffer {
    const hex = raw.trim();
    if (!/^[0-9a-fA-F]+$/.test(hex)) {
      throw new Error(
        'LICENSE_ENCRYPTION_KEY must be hexadecimal. Generate one with `openssl rand -hex 32`.',
      );
    }
    if (hex.length !== 32 * 2) {
      throw new Error(
        `LICENSE_ENCRYPTION_KEY must be ${32 * 2} hex characters ` +
          `(32 bytes for AES-256), got ${hex.length}. ` +
          'Generate one with `openssl rand -hex 32`.',
      );
    }
    return Buffer.from(hex, 'hex');
  }

  /** True when a usable key is configured. Safe to call before boot completes. */
  isConfigured(): boolean {
    try {
      this.getKey();
      return true;
    } catch {
      return false;
    }
  }

  encrypt(plaintext: string): string {
    const key = this.getKey();
    const iv = crypto.randomBytes(this.ivLength);
    const cipher = crypto.createCipheriv(this.algorithm, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    if (authTag.length !== this.tagLength) {
      // Defensive: AES-GCM always produces a 16-byte tag. If this ever differs,
      // the ciphertext format would silently change and old rows would fail.
      this.logger.error(
        `[Encryption] Unexpected GCM tag length ${authTag.length}; expected ${this.tagLength}`,
      );
    }
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  decrypt(ciphertext: string): string {
    const key = this.getKey();
    const parts = ciphertext.split(':');
    if (parts.length !== 3) throw new Error('Invalid ciphertext format');
    const [ivHex, tagHex, encrypted] = parts;
    const decipher = crypto.createDecipheriv(
      this.algorithm,
      key,
      Buffer.from(ivHex, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
}