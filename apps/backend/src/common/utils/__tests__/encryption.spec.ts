import { encrypt, decrypt } from '../encryption';

describe('EncryptionUtils', () => {
  const key = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
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

  it('throws on missing encryption key', () => {
    delete process.env.LICENSE_ENCRYPTION_KEY;
    expect(() => encrypt(plaintext)).toThrow('LICENSE_ENCRYPTION_KEY');
  });

  it('throws on tampered ciphertext', () => {
    const encrypted = encrypt(plaintext);
    const tampered = encrypted.slice(0, -4) + 'ffff';
    expect(() => decrypt(tampered)).toThrow();
  });
});
