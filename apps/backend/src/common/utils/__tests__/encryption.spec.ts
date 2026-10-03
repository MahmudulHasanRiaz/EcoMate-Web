import { Test, TestingModule } from '@nestjs/testing';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { EncryptionService } from '../encryption';
import { EncryptionKeyProvisioner } from '../encryption-key-provisioner';

describe('EncryptionService', () => {
  let service: EncryptionService;
  const key =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const plaintext = 'my-secret-license-key-1234';

  beforeEach(async () => {
    process.env.LICENSE_ENCRYPTION_KEY = key;
    const module: TestingModule = await Test.createTestingModule({
      providers: [EncryptionService],
    }).compile();
    service = module.get<EncryptionService>(EncryptionService);
  });

  afterEach(() => {
    delete process.env.LICENSE_ENCRYPTION_KEY;
  });

  it('encrypts and decrypts correctly', () => {
    const encrypted = service.encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext each time', () => {
    const a = service.encrypt(plaintext);
    const b = service.encrypt(plaintext);
    expect(a).not.toBe(b);
  });

  it('throws on tampered ciphertext', () => {
    const encrypted = service.encrypt(plaintext);
    const tampered = encrypted.slice(0, -4) + 'ffff';
    expect(() => service.decrypt(tampered)).toThrow();
  });

  /**
   * Regression guard for the removed fallback.
   *
   * The service used to fall back to a hard-coded key committed to this
   * repository, so any deployment without the env var encrypted its license,
   * attendance device credentials and marketing OAuth tokens under a key that
   * anyone with source access could read. There is now no default at all.
   */
  it('refuses to encrypt with no key rather than using a hard-coded default', () => {
    delete process.env.LICENSE_ENCRYPTION_KEY;
    expect(() => service.encrypt(plaintext)).toThrow(
      /LICENSE_ENCRYPTION_KEY is not set/,
    );
  });

  it('rejects a malformed key with an actionable message', () => {
    process.env.LICENSE_ENCRYPTION_KEY = 'not-hex-' + 'z'.repeat(57);
    expect(() => service.encrypt(plaintext)).toThrow(/must be hexadecimal/);

    process.env.LICENSE_ENCRYPTION_KEY = 'abcdef';
    expect(() => service.encrypt(plaintext)).toThrow(/must be 64 hex characters/);
  });

  it('reports whether a usable key is configured', () => {
    delete process.env.LICENSE_ENCRYPTION_KEY;
    expect(service.isConfigured()).toBe(false);

    process.env.LICENSE_ENCRYPTION_KEY = key;
    expect(service.isConfigured()).toBe(true);
  });
});

describe('EncryptionKeyProvisioner', () => {
  const ORIGINAL = process.env.LICENSE_ENCRYPTION_KEY;
  let dir: string;
  let encryption: EncryptionService;

  beforeEach(async () => {
    delete process.env.LICENSE_ENCRYPTION_KEY;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'license-key-'));
    process.env.LICENSE_DATA_DIR = dir;

    const module: TestingModule = await Test.createTestingModule({
      providers: [EncryptionService, EncryptionKeyProvisioner],
    }).compile();
    encryption = module.get(EncryptionService);
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.LICENSE_ENCRYPTION_KEY;
    else process.env.LICENSE_ENCRYPTION_KEY = ORIGINAL;
    delete process.env.LICENSE_DATA_DIR;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // The product requirement is that an owner activates a license from the admin
  // app, not by pasting secrets into Portainer. The provisioner is what makes
  // "no env var" safe without that convenience costing security.
  it('generates a key when none is configured', () => {
    new EncryptionKeyProvisioner(encryption).onModuleInit();

    expect(process.env.LICENSE_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(fs.existsSync(path.join(dir, 'encryption.key'))).toBe(true);
  });

  it('keeps the same key on the next boot', () => {
    new EncryptionKeyProvisioner(encryption).onModuleInit();
    const first = process.env.LICENSE_ENCRYPTION_KEY;

    // Simulate a restart: the in-memory value is gone, the persisted one is not.
    delete process.env.LICENSE_ENCRYPTION_KEY;
    new EncryptionKeyProvisioner(encryption).onModuleInit();

    expect(process.env.LICENSE_ENCRYPTION_KEY).toBe(first);
  });

  it('does not regenerate the key — data encrypted on an earlier boot must stay readable', () => {
    new EncryptionKeyProvisioner(encryption).onModuleInit();
    const ciphertext = encryption.encrypt('LICENSE-KEY-1234');

    delete process.env.LICENSE_ENCRYPTION_KEY;
    new EncryptionKeyProvisioner(encryption).onModuleInit();

    expect(encryption.decrypt(ciphertext)).toBe('LICENSE-KEY-1234');
  });

  it('prefers an environment-supplied key over the stored one', () => {
    process.env.LICENSE_ENCRYPTION_KEY = 'ab'.repeat(32);
    new EncryptionKeyProvisioner(encryption).onModuleInit();
    expect(process.env.LICENSE_ENCRYPTION_KEY).toBe('ab'.repeat(32));
  });

  it('writes the key owner-readable only', () => {
    new EncryptionKeyProvisioner(encryption).onModuleInit();
    if (process.platform === 'win32') return; // POSIX permission bits only
    const mode = fs.statSync(path.join(dir, 'encryption.key')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  /**
   * Regression guard: provisioning must not crash on a developer machine.
   *
   * The directory defaulted to /app/license-data, a container path that does
   * not exist at the filesystem root of a dev machine and cannot be created
   * without elevated privileges. mkdir therefore threw ENOENT inside
   * onModuleInit, which killed Nest before it bound its port. `nest --watch`
   * keeps the dead child alive, so nothing was listening on :4000, each
   * frontend's scripts/wait-for-backend.js timed out and took the whole
   * `npm run dev` group down, and the license activation page reported
   * "Unable to reach server" — which looked like a license server outage but
   * was a boot crash.
   *
   * So with no LICENSE_DATA_DIR set, provisioning has to resolve to a path
   * that actually exists and works off Docker.
   */
  describe('without LICENSE_DATA_DIR', () => {
    const originalCwd = process.cwd();

    beforeEach(() => {
      delete process.env.LICENSE_DATA_DIR;
    });

    afterEach(() => {
      process.chdir(originalCwd);
    });

    it('provisions a key off Docker instead of throwing', () => {
      // A temp cwd stands in for the repo root on a developer machine.
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'license-cwd-'));
      process.chdir(cwd);
      try {
        expect(() =>
          new EncryptionKeyProvisioner(encryption).onModuleInit(),
        ).not.toThrow();
        expect(process.env.LICENSE_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
        expect(fs.existsSync(path.join(cwd, '.license-data', 'encryption.key'))).toBe(
          true,
        );
      } finally {
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    });

    it('never falls back to the unwritable container path', () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'license-cwd-'));
      process.chdir(cwd);
      try {
        new EncryptionKeyProvisioner(encryption).onModuleInit();
        const stored = process.env.LICENSE_ENCRYPTION_KEY;
        delete process.env.LICENSE_ENCRYPTION_KEY;

        // A second boot must reuse the same key from the local directory.
        new EncryptionKeyProvisioner(encryption).onModuleInit();
        expect(process.env.LICENSE_ENCRYPTION_KEY).toBe(stored);
        expect(stored).not.toBeUndefined();
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(cwd, { recursive: true, force: true });
      }
    });
  });
});