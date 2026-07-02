import { encrypt, decrypt } from '../encryption';

describe('EncryptionUtils', () => {
  const key =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const plaintext = 'my-secret-license-key-1234';

  beforeEach(() => {
    process.env.LICENSE_ENCRYPTION_KEY = key;
  });

  afterEach(() => {
    delete process.env.LICENSE_ENCRYPTION_KEY;
  });

  it('encrypts and decrypts correctly', () => {
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext each time', () => {
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toBe(b);
  });

  it('uses fallback key when env key is missing', () => {
    delete process.env.LICENSE_ENCRYPTION_KEY;
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('throws on tampered ciphertext', () => {
    const encrypted = encrypt(plaintext);
    const tampered = encrypted.slice(0, -4) + 'ffff';
    expect(() => decrypt(tampered)).toThrow();
  });
});
