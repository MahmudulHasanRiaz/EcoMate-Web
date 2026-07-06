import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { baPrisma } from '../better-auth/prisma';

@Injectable()
export class CustomerLinkingService {
  constructor(private prisma: PrismaService) {}

  async linkByEmail(customerProfileId: string, email: string) {
    if (!email) return;

    const baUser = await baPrisma.betterAuthUser.findUnique({
      where: { email },
    });
    if (!baUser) return;

    const profile = await this.prisma.customerProfile.findUnique({
      where: { id: customerProfileId },
    });
    if (profile?.betterAuthUserId) return;

    await this.prisma.customerProfile.update({
      where: { id: customerProfileId },
      data: { betterAuthUserId: baUser.id },
    });
  }

  async linkByPhone(betterAuthUserId: string, phone: string) {
    if (!phone) return;

    const profile = await this.prisma.customerProfile.findFirst({
      where: { phone, betterAuthUserId: null },
    });
    if (!profile) return;

    await this.prisma.customerProfile.update({
      where: { id: profile.id },
      data: { betterAuthUserId },
    });
  }
}
