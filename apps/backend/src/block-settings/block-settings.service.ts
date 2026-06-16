import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_SETTINGS = {
  phoneOrderRestriction: {
    maxOrders: 3,
    timeWindowMinutes: 60,
    blockDurationMinutes: 1440,
  },
  ipOrderRestriction: {
    maxOrders: 10,
    timeWindowMinutes: 60,
    blockDurationMinutes: 1440,
  },
  autoBlock: {
    failedLoginThreshold: 5,
    failedLoginWindowMinutes: 10,
    autoFullBlockIp: true,
    autoOrderBlockIp: true,
    autoOrderBlockPhone: true,
  },
  blockMessages: {
    orderBlockPhone: {
      title: 'Order Blocked',
      message: 'Your phone number has been temporarily blocked. Please contact support for assistance.',
      ctaLabel: 'Call Support',
      ctaAction: 'tel:01700000000',
    },
    orderBlockIp: {
      title: 'Order Restricted',
      message: 'Orders from your IP address are temporarily restricted.',
      ctaLabel: 'Need Help?',
      ctaAction: 'tel:01700000000',
    },
    fullBlockIp: {
      title: 'Access Denied',
      message: 'Your IP address has been blocked. Please contact support.',
      ctaLabel: 'Contact Support',
      ctaAction: 'tel:01700000000',
    },
  },
};

@Injectable()
export class BlockSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(): Promise<any> {
    let settings = await this.prisma.blockSettings.findUnique({ where: { id: 'singleton' } });
    if (!settings) {
      settings = await this.prisma.blockSettings.create({
        data: { id: 'singleton', data: DEFAULT_SETTINGS },
      });
    }
    return settings.data;
  }

  async updateSettings(data: any) {
    const settings = await this.prisma.blockSettings.upsert({
      where: { id: 'singleton' },
      create: { id: 'singleton', data },
      update: { data },
    });
    return settings.data;
  }
}
