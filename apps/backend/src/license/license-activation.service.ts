import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/utils/encryption';

interface ActivateDto {
  licenseKey: string;
  keymateUrl: string;
  domain?: string;
  apiKey?: string;
  licenseInfo?: any;
}

@Injectable()
export class LicenseActivationService {
  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
  ) {}

  async find() {
    return this.prisma.licenseActivation.findFirst();
  }

  async activate(dto: ActivateDto) {
    const encryptedKey = this.encryption.encrypt(dto.licenseKey);
    const encryptedApiKey = dto.apiKey ? this.encryption.encrypt(dto.apiKey) : null;

    const existing = await this.find();
    if (existing) {
      return this.prisma.licenseActivation.update({
        where: { id: existing.id },
        data: {
          licenseKey: encryptedKey,
          keymateUrl: dto.keymateUrl,
          domain: dto.domain || null,
          apiKey: encryptedApiKey,
          status: 'active',
          licenseInfo: dto.licenseInfo ?? undefined,
          activatedAt: new Date(),
          expiresAt: dto.licenseInfo?.expiry
            ? new Date(dto.licenseInfo.expiry)
            : undefined,
          errorMessage: null,
        },
      });
    }

    return this.prisma.licenseActivation.create({
      data: {
        licenseKey: encryptedKey,
        keymateUrl: dto.keymateUrl,
        domain: dto.domain || null,
        apiKey: encryptedApiKey,
        status: 'active',
        licenseInfo: dto.licenseInfo ?? undefined,
        activatedAt: new Date(),
        expiresAt: dto.licenseInfo?.expiry
          ? new Date(dto.licenseInfo.expiry)
          : undefined,
        errorMessage: null,
      },
    });
  }

  async deactivate(errorMessage?: string) {
    const existing = await this.find();
    if (!existing) return null;
    return this.prisma.licenseActivation.update({
      where: { id: existing.id },
      data: { status: 'invalid', errorMessage: errorMessage || null },
    });
  }

  async getDecryptedCredentials() {
    const activation = await this.find();
    if (!activation || activation.status !== 'active') return null;
    return {
      licenseKey: this.encryption.decrypt(activation.licenseKey),
      keymateUrl: activation.keymateUrl,
      domain: activation.domain,
      apiKey: activation.apiKey ? this.encryption.decrypt(activation.apiKey) : undefined,
      licenseInfo: activation.licenseInfo,
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
