import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY || 'default-dev-key-change-in-production-1234';
  return crypto.scryptSync(key, 'salt', 32);
}

@Injectable()
export class AuthSettingsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    const settings = await this.prisma.authSettings.findMany();
    return settings.map((s) => ({
      ...s,
      clientId: this.decrypt(s.clientId),
      clientSecret: s.clientSecret ? this.decrypt(s.clientSecret) : '',
    }));
  }

  async upsert(providerName: string, data: { isEnabled?: boolean; clientId?: string; clientSecret?: string }) {
    const updateData: any = {};
    if (data.isEnabled !== undefined) updateData.isEnabled = data.isEnabled;
    if (data.clientId !== undefined) updateData.clientId = this.encrypt(data.clientId);
    if (data.clientSecret !== undefined) updateData.clientSecret = this.encrypt(data.clientSecret);

    return this.prisma.authSettings.upsert({
      where: { providerName },
      create: { providerName, ...updateData },
      update: updateData,
    });
  }

  private encrypt(text: string): string {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  }

  private decrypt(encryptedText: string): string {
    try {
      const key = getEncryptionKey();
      const parts = encryptedText.split(':');
      const iv = Buffer.from(parts[0], 'hex');
      const authTag = Buffer.from(parts[1], 'hex');
      const encrypted = parts[2];
      const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
      decipher.setAuthTag(authTag);
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch {
      return encryptedText;
    }
  }
}
