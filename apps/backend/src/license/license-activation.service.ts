import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encrypt, decrypt } from '../common/utils/encryption';

interface ActivateDto {
  licenseKey: string;
  keymateUrl: string;
  domain?: string;
  apiKey?: string;
  licenseInfo?: any;
}

@Injectable()
export class LicenseActivationService {
  constructor(private prisma: PrismaService) {}

  async find() {
    return this.prisma.licenseActivation.findFirst();
  }

  async activate(dto: ActivateDto) {
    const data: any = {
      licenseKey: encrypt(dto.licenseKey),
      keymateUrl: dto.keymateUrl,
      domain: dto.domain || null,
      apiKey: dto.apiKey ? encrypt(dto.apiKey) : null,
      status: 'active',
      licenseInfo: dto.licenseInfo || null,
      activatedAt: new Date(),
      expiresAt: dto.licenseInfo?.expiry ? new Date(dto.licenseInfo.expiry) : null,
      errorMessage: null,
    };

    const existing = await this.find();
    if (existing) {
      return this.prisma.licenseActivation.update({
        where: { id: existing.id },
        data,
      });
    }

    return this.prisma.licenseActivation.create({ data } as any);
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
      licenseKey: decrypt(activation.licenseKey),
      keymateUrl: activation.keymateUrl,
      domain: activation.domain,
      apiKey: activation.apiKey ? decrypt(activation.apiKey) : undefined,
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
        expiresAt: licenseInfo?.expiry ? new Date(licenseInfo.expiry) : undefined,
      },
    });
  }
}
