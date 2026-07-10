import { Test, TestingModule } from '@nestjs/testing';
import { EncryptionService } from '../encryption';

describe('EncryptionService', () => {
  let service: EncryptionService;
  const key =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const plaintext = 'my-secret-license-key-1234';

  beforeAll(async () => {
    process.env.LICENSE_ENCRYPTION_KEY = key;
  });

  afterAll(() => {
    delete process.env.LICENSE_ENCRYPTION_KEY;
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [EncryptionService],
    }).compile();
    service = module.get<EncryptionService>(EncryptionService);
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

  it('uses fallback key when env key is missing', () => {
    delete process.env.LICENSE_ENCRYPTION_KEY;
    const encrypted = service.encrypt(plaintext);
    expect(encrypted).not.toBe(plaintext);
    const decrypted = service.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('throws on tampered ciphertext', () => {
    const encrypted = service.encrypt(plaintext);
    const tampered = encrypted.slice(0, -4) + 'ffff';
    expect(() => service.decrypt(tampered)).toThrow();
  });
});
