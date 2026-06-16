import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BlockedEntriesService } from '../blocked-entries/blocked-entries.service';
import { BlockSettingsService } from '../block-settings/block-settings.service';

@Injectable()
export class SecurityService {
  private readonly logger = new Logger(SecurityService.name);
  private failedLogins = new Map<string, { count: number; firstAttempt: number }>();
  private ipOrderCounts = new Map<string, { count: number; firstOrder: number }>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly blockedEntries: BlockedEntriesService,
    private readonly blockSettings: BlockSettingsService,
  ) {
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.cleanupInterval);
  }

  async recordFailedLogin(ip: string) {
    const now = Date.now();
    const entry = this.failedLogins.get(ip) || { count: 0, firstAttempt: now };
    entry.count++;
    if (entry.count === 1) entry.firstAttempt = now;
    this.failedLogins.set(ip, entry);

    const settings = await this.blockSettings.getSettings();
    const threshold = settings.autoBlock.failedLoginThreshold;
    const windowMs = (settings.autoBlock.failedLoginWindowMinutes || 10) * 60_000;

    if (entry.count >= threshold && (now - entry.firstAttempt) <= windowMs) {
      this.failedLogins.delete(ip);
      if (settings.autoBlock.autoFullBlockIp) {
        this.logger.warn(`Auto full-blocking IP ${ip} (${entry.count} failed logins)`);
        await this.blockedEntries.createAutoBlock('ip', ip, 'full', 1440);
      }
    }
  }

  async recordOrder(phone: string, ip: string) {
    const settings = await this.blockSettings.getSettings();

    if (settings.autoBlock?.autoOrderBlockPhone && phone) {
      const count = await this.blockedEntries.countPhoneOrders(phone, settings.phoneOrderRestriction.timeWindowMinutes);
      if (count >= settings.phoneOrderRestriction.maxOrders) {
        this.logger.warn(`Auto order-blocking phone ${phone} (${count} orders)`);
        await this.blockedEntries.createAutoBlock('phone', phone, 'order', settings.phoneOrderRestriction.blockDurationMinutes);
      }
    }

    if (settings.autoBlock?.autoOrderBlockIp && ip) {
      const now = Date.now();
      const windowMs = (settings.ipOrderRestriction.timeWindowMinutes || 60) * 60_000;
      const entry = this.ipOrderCounts.get(ip) || { count: 0, firstOrder: now };
      entry.count++;
      if (entry.count === 1) entry.firstOrder = now;
      if ((now - entry.firstOrder) > windowMs) {
        entry.count = 1;
        entry.firstOrder = now;
      }
      this.ipOrderCounts.set(ip, entry);

      if (entry.count >= settings.ipOrderRestriction.maxOrders) {
        this.ipOrderCounts.delete(ip);
        this.logger.warn(`Auto order-blocking IP ${ip} (${entry.count} orders)`);
        await this.blockedEntries.createAutoBlock('ip', ip, 'order', settings.ipOrderRestriction.blockDurationMinutes);
      }
    }
  }

  async getBlockInfo(phone?: string, ip?: string) {
    const settings = await this.blockSettings.getSettings();
    const result: any = { blocked: false };

    if (ip) {
      const fullBlock = await this.blockedEntries.findFullBlockedIp(ip);
      if (fullBlock) {
        result.blocked = true;
        result.type = 'full_block_ip';
        result.message = settings.blockMessages.fullBlockIp;
        return result;
      }
      const orderBlock = await this.blockedEntries.findOrderBlockedIp(ip);
      if (orderBlock) {
        result.blocked = true;
        result.type = 'order_block_ip';
        result.message = settings.blockMessages.orderBlockIp;
        return result;
      }
    }

    if (phone) {
      const phoneBlock = await this.blockedEntries.findBlockedPhone(phone);
      if (phoneBlock) {
        result.blocked = true;
        result.type = 'order_block_phone';
        result.message = settings.blockMessages.orderBlockPhone;
        return result;
      }
    }

    return result;
  }

  async getAutoBlockStats() {
    const [ipActive, ipAuto, phoneActive, phoneAuto] = await Promise.all([
      this.prisma.blockedIp.count({ where: { isActive: true } }),
      this.prisma.blockedIp.count({ where: { isActive: true, autoBlocked: true } }),
      this.prisma.blockedPhone.count({ where: { isActive: true } }),
      this.prisma.blockedPhone.count({ where: { isActive: true, autoBlocked: true } }),
    ]);
    return { ipBlocks: { total: ipActive, auto: ipAuto }, phoneBlocks: { total: phoneActive, auto: phoneAuto } };
  }

  private cleanup() {
    const now = Date.now();
    for (const [ip, entry] of this.failedLogins.entries()) {
      if (now - entry.firstAttempt > 600_000) {
        this.failedLogins.delete(ip);
      }
    }
    for (const [ip, entry] of this.ipOrderCounts.entries()) {
      if (now - entry.firstOrder > 3_600_000) {
        this.ipOrderCounts.delete(ip);
      }
    }
  }
}
