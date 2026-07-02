import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../common/utils/phone-utils';

@Injectable()
export class BlockedEntriesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BlockedEntriesService.name);
  private expireInterval: ReturnType<typeof setInterval>;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    this.expireInterval = setInterval(() => {
      this.lazyExpire().catch((err) => {
        this.logger.error(`lazyExpire failed: ${err instanceof Error ? err.message : err}`);
      });
    }, 60_000);
  }

  onModuleDestroy() {
    clearInterval(this.expireInterval);
  }

  async findAll(type?: string, search?: string) {
    const ipWhere: any = {};
    const phoneWhere: any = {};

    if (type && type !== 'all' && type !== 'ip') {
      ipWhere.id = '__none__';
    }
    if (type && type !== 'all' && type !== 'phone') {
      phoneWhere.id = '__none__';
    }

    const [ipBlocks, phoneBlocks] = await Promise.all([
      this.prisma.blockedIp.findMany({ where: ipWhere, orderBy: { blockedAt: 'desc' } }),
      this.prisma.blockedPhone.findMany({ where: phoneWhere, orderBy: { blockedAt: 'desc' } }),
    ]);

    let entries = [
      ...ipBlocks.map(b => ({
        id: b.id,
        entryType: 'ip' as const,
        value: b.ip,
        blockType: b.blockType,
        reason: b.reason,
        blockedAt: b.blockedAt,
        blockedBy: b.blockedBy,
        isActive: b.isActive,
        whitelisted: b.whitelisted,
        autoBlocked: b.autoBlocked,
        expiresAt: b.expiresAt,
      })),
      ...phoneBlocks.map(b => ({
        id: b.id,
        entryType: 'phone' as const,
        value: b.phone,
        blockType: 'order' as const,
        reason: b.reason,
        blockedAt: b.blockedAt,
        blockedBy: b.blockedBy,
        isActive: b.isActive,
        whitelisted: b.whitelisted,
        autoBlocked: b.autoBlocked,
        expiresAt: b.expiresAt,
      })),
    ];

    if (search) {
      const q = search.toLowerCase();
      entries = entries.filter(e => e.value.toLowerCase().includes(q));
    }

    return entries;
  }

  async create(dto: { type: 'ip' | 'phone'; value: string; reason?: string; blockType?: string; blockedBy?: string }) {
    const blockType = dto.blockType || 'order';

    if (dto.type === 'ip') {
      const existing = await this.prisma.blockedIp.findUnique({ where: { ip: dto.value } });
      if (existing && existing.isActive) {
        return this.prisma.blockedIp.update({
          where: { ip: dto.value },
          data: {
            blockType: blockType === 'full' ? 'full' : existing.blockType,
            reason: dto.reason ?? existing.reason,
            blockedBy: dto.blockedBy ?? existing.blockedBy,
            blockedAt: new Date(),
            expiresAt: null,
            isActive: true,
          },
        });
      }
      return this.prisma.blockedIp.upsert({
        where: { ip: dto.value },
        update: { blockType, reason: dto.reason, blockedBy: dto.blockedBy, blockedAt: new Date(), isActive: true, expiresAt: null },
        create: { ip: dto.value, blockType, reason: dto.reason, blockedBy: dto.blockedBy },
      });
    } else {
      const phone = normalizePhone(dto.value) || dto.value;
      const existing = await this.prisma.blockedPhone.findUnique({ where: { phone } });
      if (existing && existing.isActive) {
        return this.prisma.blockedPhone.update({
          where: { phone },
          data: { reason: dto.reason ?? existing.reason, blockedBy: dto.blockedBy ?? existing.blockedBy, blockedAt: new Date(), expiresAt: null },
        });
      }
      return this.prisma.blockedPhone.upsert({
        where: { phone },
        update: { reason: dto.reason, blockedBy: dto.blockedBy, blockedAt: new Date(), isActive: true, expiresAt: null },
        create: { phone, reason: dto.reason, blockedBy: dto.blockedBy },
      });
    }
  }

  async createAutoBlock(type: 'ip' | 'phone', value: string, blockType: string, durationMinutes: number) {
    const expiresAt = new Date(Date.now() + durationMinutes * 60_000);

    if (type === 'ip') {
      const existing = await this.prisma.blockedIp.findUnique({ where: { ip: value } });
      if (existing?.whitelisted) return null;
      if (existing && existing.isActive) {
        return this.prisma.blockedIp.update({
          where: { ip: value },
          data: {
            blockType: blockType === 'full' ? 'full' : existing.blockType,
            autoBlocked: true,
            expiresAt,
            blockedAt: new Date(),
            isActive: true,
          },
        });
      }
      return this.prisma.blockedIp.upsert({
        where: { ip: value },
        update: { blockType, autoBlocked: true, expiresAt, blockedAt: new Date(), isActive: true },
        create: { ip: value, blockType, autoBlocked: true, expiresAt },
      });
    } else {
      const phone = normalizePhone(value) || value;
      const existing = await this.prisma.blockedPhone.findUnique({ where: { phone } });
      if (existing?.whitelisted) return null;
      if (existing && existing.isActive) {
        return this.prisma.blockedPhone.update({
          where: { phone },
          data: { autoBlocked: true, expiresAt, blockedAt: new Date(), isActive: true },
        });
      }
      return this.prisma.blockedPhone.upsert({
        where: { phone },
        update: { autoBlocked: true, expiresAt, blockedAt: new Date(), isActive: true },
        create: { phone, autoBlocked: true, expiresAt },
      });
    }
  }

  async unblock(type: string, id: string) {
    if (type === 'ip') {
      await this.prisma.blockedIp.update({ where: { id }, data: { isActive: false } });
    } else {
      await this.prisma.blockedPhone.update({ where: { id }, data: { isActive: false } });
    }
  }

  async toggleWhitelist(type: string, id: string) {
    if (type === 'ip') {
      const entry = await this.prisma.blockedIp.findUnique({ where: { id } });
      await this.prisma.blockedIp.update({ where: { id }, data: { whitelisted: !entry?.whitelisted } });
    } else {
      const entry = await this.prisma.blockedPhone.findUnique({ where: { id } });
      await this.prisma.blockedPhone.update({ where: { id }, data: { whitelisted: !entry?.whitelisted } });
    }
  }

  async findFullBlockedIp(ip: string) {
    return this.prisma.blockedIp.findFirst({
      where: {
        ip, isActive: true, whitelisted: false, blockType: 'full',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
  }

  async findOrderBlockedIp(ip: string) {
    return this.prisma.blockedIp.findFirst({
      where: {
        ip, isActive: true, whitelisted: false, blockType: 'order',
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
  }

  async findBlockedPhone(phone: string) {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    return this.prisma.blockedPhone.findFirst({
      where: {
        phone: normalized, isActive: true, whitelisted: false,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
  }

  async countPhoneOrders(phone: string, windowMinutes: number) {
    const normalized = normalizePhone(phone);
    if (!normalized) return 0;
    const since = new Date(Date.now() - windowMinutes * 60_000);
    return this.prisma.order.count({
      where: {
        createdAt: { gte: since },
        OR: [
          { customer: { phoneNumber: normalized } },
          { guestPhone: normalized },
        ],
      },
    });
  }

  async lazyExpire() {
    const now = new Date();
    await this.prisma.blockedIp.updateMany({
      where: { isActive: true, expiresAt: { lte: now } },
      data: { isActive: false },
    });
    await this.prisma.blockedPhone.updateMany({
      where: { isActive: true, expiresAt: { lte: now } },
      data: { isActive: false },
    });
  }
}
