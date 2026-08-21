import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EncryptionService } from '../common/utils/encryption';
import { MarketingPlatformsService } from './marketing-platforms.service';
import { ProviderAdapterFactory } from './provider-factory';
import {
  CreateConnectionDto,
  UpdateConnectionDto,
  AddAdAccountDto,
} from './dto/marketing.dto';
import { MARKETING_PLATFORMS } from './marketing.constants';

const APP_ID_SETTING = 'marketing_app_id';
const APP_SECRET_SETTING = 'marketing_app_secret';

@Injectable()
export class MarketingConnectionsService {
  private readonly logger = new Logger(MarketingConnectionsService.name);

  constructor(
    private prisma: PrismaService,
    private encryption: EncryptionService,
    private platforms: MarketingPlatformsService,
    private providerFactory: ProviderAdapterFactory,
  ) {}

  async create(dto: CreateConnectionDto, userId?: string) {
    await this.platforms.ensureDefaults();
    const platform = await this.prisma.marketingPlatform.findUnique({
      where: { slug: dto.provider as any },
    });
    if (!platform) {
      const supported = MARKETING_PLATFORMS.map((p) => p.slug).join(', ');
      throw new BadRequestException(
        `Unsupported provider "${dto.provider}". Supported: ${supported}`,
      );
    }

    let providerUserId = dto.providerUserId;
    if (!providerUserId) {
      const adapter = this.providerFactory.getAdapter(platform.slug);
      try {
        const result = await adapter.validateConnection(dto.accessToken);
        providerUserId = result.providerUserId;
      } catch (err) {
        throw new BadRequestException(
          `Token validation failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
      }
    }

    const connection = await this.prisma.marketingConnection.create({
      data: {
        platformId: platform.id,
        providerUserId,
        accessTokenEnc: this.encryption.encrypt(dto.accessToken),
        refreshTokenEnc: dto.refreshToken
          ? this.encryption.encrypt(dto.refreshToken)
          : null,
        tokenExpiry: dto.tokenExpiry ? new Date(dto.tokenExpiry) : null,
        status: 'connected',
      },
      include: { platform: true, _count: { select: { adAccounts: true } } },
    });

    await this.prisma.marketingAuditLog.create({
      data: {
        action: 'connection.create',
        entityType: 'connection',
        entityId: connection.id,
        actorId: userId,
        metadata: { provider: platform.slug },
      },
    });

    return this.sanitize(connection);
  }

  async list() {
    const connections = await this.prisma.marketingConnection.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        platform: true,
        _count: { select: { adAccounts: true } },
      },
    });
    return connections.map((c) => {
      const { accessTokenEnc, refreshTokenEnc, ...rest } = c as any;
      return rest;
    });
  }

  async findOne(id: string) {
    const connection = await this.prisma.marketingConnection.findUnique({
      where: { id },
      include: { platform: true, adAccounts: true },
    });
    if (!connection) throw new NotFoundException('Connection not found');
    return this.sanitize(connection as any);
  }

  async update(id: string, dto: UpdateConnectionDto, userId?: string) {
    const existing = await this.prisma.marketingConnection.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Connection not found');

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.providerUserId !== undefined) {
      data.providerUserId = dto.providerUserId;
    } else if (dto.accessToken) {
      // Resolve platform from connection → platform
      const connWithPlatform = await this.prisma.marketingConnection.findUnique({
        where: { id },
        include: { platform: true },
      });
      const adapter = this.providerFactory.getAdapter(connWithPlatform?.platform?.slug ?? 'facebook');
      try {
        const result = await adapter.validateConnection(dto.accessToken);
        data.providerUserId = result.providerUserId;
      } catch (err) {
        throw new BadRequestException(
          `Token validation failed: ${err instanceof Error ? err.message : 'unknown error'}`,
        );
      }
    }
    if (dto.accessToken) data.accessTokenEnc = this.encryption.encrypt(dto.accessToken);
    if (dto.refreshToken) data.refreshTokenEnc = this.encryption.encrypt(dto.refreshToken);
    if (dto.tokenExpiry) data.tokenExpiry = new Date(dto.tokenExpiry);

    const connection = await this.prisma.marketingConnection.update({
      where: { id },
      data,
      include: { platform: true },
    });

    await this.prisma.marketingAuditLog.create({
      data: {
        action: 'connection.update',
        entityType: 'connection',
        entityId: id,
        actorId: userId,
      },
    });

    return this.sanitize(connection as any);
  }

  async disconnect(id: string, userId?: string) {
    const existing = await this.prisma.marketingConnection.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Connection not found');
    const connection = await this.prisma.marketingConnection.update({
      where: { id },
      data: { status: 'disconnected' },
    });
    await this.prisma.marketingAuditLog.create({
      data: {
        action: 'connection.disconnect',
        entityType: 'connection',
        entityId: id,
        actorId: userId,
      },
    });
    return this.sanitize(connection as any);
  }

  async remove(id: string, userId?: string) {
    const existing = await this.prisma.marketingConnection.findUnique({
      where: { id },
      include: { _count: { select: { adAccounts: true } } },
    });
    if (!existing) throw new NotFoundException('Connection not found');
    if (existing._count.adAccounts > 0) {
      throw new ConflictException(
        'Connection has ad accounts. Remove them first.',
      );
    }
    await this.prisma.marketingConnection.delete({ where: { id } });
    await this.prisma.marketingAuditLog.create({
      data: {
        action: 'connection.delete',
        entityType: 'connection',
        entityId: id,
        actorId: userId,
      },
    });
    return { success: true };
  }

  async addAdAccount(dto: AddAdAccountDto, userId?: string) {
    const connection = await this.prisma.marketingConnection.findUnique({
      where: { id: dto.connectionId },
    });
    if (!connection) throw new NotFoundException('Connection not found');

    const existing = await this.prisma.adAccount.findUnique({
      where: { providerAccountId: dto.providerAccountId },
    });
    if (existing) throw new ConflictException('Ad account already connected');

    const adAccount = await this.prisma.adAccount.create({
      data: {
        connectionId: connection.id,
        providerAccountId: dto.providerAccountId,
        name: dto.name,
        currency: dto.currency ?? 'USD',
        timezone: dto.timezone,
        status: dto.status ?? 'ACTIVE',
      },
      include: { connection: { include: { platform: true } } },
    });

    await this.prisma.marketingAuditLog.create({
      data: {
        action: 'ad_account.add',
        entityType: 'ad_account',
        entityId: adAccount.id,
        actorId: userId,
        metadata: { providerAccountId: dto.providerAccountId },
      },
    });

    return adAccount;
  }

  async discoverAdAccounts(dto: { connectionId: string }, userId?: string) {
    const connection = await this.prisma.marketingConnection.findUnique({
      where: { id: dto.connectionId },
      include: { platform: true },
    });
    if (!connection) throw new NotFoundException('Connection not found');

    const token = this.encryption.decrypt(connection.accessTokenEnc);
    const adapter = this.providerFactory.getAdapter(connection.platform?.slug ?? 'facebook');
    let accounts;
    try {
      accounts = await adapter.listAdAccounts(token);
    } catch (err) {
      throw new BadRequestException(
        `Failed to list ad accounts: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }

    const results: any[] = [];
    for (const acc of accounts) {
      const existing = await this.prisma.adAccount.findUnique({
        where: { providerAccountId: acc.id },
      });
      if (existing) {
        results.push(await this.prisma.adAccount.update({
          where: { id: existing.id },
          data: { name: acc.name, status: 'ACTIVE' },
        }));
        continue;
      }
      results.push(
        await this.prisma.adAccount.create({
          data: {
            connectionId: connection.id,
            providerAccountId: acc.id,
            name: acc.name,
            currency: acc.currency ?? 'USD',
            timezone: acc.timezone_name,
            status: acc.account_status === 1 ? 'ACTIVE' : String(acc.account_status),
          },
        }),
      );
    }

    await this.prisma.marketingAuditLog.create({
      data: {
        action: 'ad_account.discover',
        entityType: 'connection',
        entityId: connection.id,
        actorId: userId,
        metadata: { discovered: results.length },
      },
    });

    return { discovered: results.length, adAccounts: results };
  }

  async updateAdAccount(id: string, dto: any) {
    const existing = await this.prisma.adAccount.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Ad account not found');
    return this.prisma.adAccount.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    });
  }

  async removeAdAccount(id: string, userId?: string) {
    const existing = await this.prisma.adAccount.findUnique({
      where: { id },
      include: {
        _count: { select: { campaigns: true, fundingEntries: true } },
      },
    });
    if (!existing) throw new NotFoundException('Ad account not found');
    if (existing._count.campaigns > 0 || existing._count.fundingEntries > 0) {
      throw new ConflictException(
        'Ad account has synced campaigns or funding. Deactivate it instead.',
      );
    }
    await this.prisma.adAccount.delete({ where: { id } });
    await this.prisma.marketingAuditLog.create({
      data: {
        action: 'ad_account.delete',
        entityType: 'ad_account',
        entityId: id,
        actorId: userId,
      },
    });
    return { success: true };
  }

  async listAdAccountsPaginated(page = 1, perPage = 20, connectionId?: string) {
    const where: any = {};
    if (connectionId) where.connectionId = connectionId;
    const [data, total] = await Promise.all([
      this.prisma.adAccount.findMany({
        where,
        include: {
          connection: { include: { platform: true } },
          _count: { select: { campaigns: true } },
          syncStatus: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.adAccount.count({ where }),
    ]);
    return {
      data,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async getAdAccount(id: string) {
    const adAccount = await this.prisma.adAccount.findUnique({
      where: { id },
      include: {
        connection: { include: { platform: true } },
        syncStatus: true,
        campaigns: { orderBy: { name: 'asc' } },
      },
    });
    if (!adAccount) throw new NotFoundException('Ad account not found');
    return adAccount;
  }

  async listCampaigns(
    page = 1,
    perPage = 20,
    adAccountId?: string,
    status?: string,
    search?: string,
  ) {
    const where: any = {};
    if (adAccountId) where.adAccountId = adAccountId;
    if (status) where.status = status;
    if (search) {
      where.OR = [{ name: { contains: search, mode: 'insensitive' } }];
    }
    const [data, total] = await Promise.all([
      this.prisma.marketingCampaign.findMany({
        where,
        include: {
          adAccount: { select: { id: true, name: true, providerAccountId: true } },
          _count: { select: { adSets: true, orderAttributions: true } },
        },
        orderBy: [{ updatedAt: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.marketingCampaign.count({ where }),
    ]);
    return {
      data,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async getCampaign(id: string) {
    const campaign = await this.prisma.marketingCampaign.findUnique({
      where: { id },
      include: {
        adAccount: { include: { connection: { include: { platform: true } } } },
        adSets: { include: { ads: true } },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async updateCampaign(id: string, dto: any) {
    const existing = await this.prisma.marketingCampaign.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Campaign not found');
    return this.prisma.marketingCampaign.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.isArchived !== undefined ? { isArchived: dto.isArchived } : {}),
      },
    });
  }

  async listInsights(
    campaignId?: string,
    adAccountId?: string,
    fromDate?: string,
    toDate?: string,
    page = 1,
    perPage = 20,
  ) {
    const where: any = {};
    if (campaignId) where.campaignId = campaignId;
    if (adAccountId) where.campaign = { adAccountId };
    if (fromDate || toDate) {
      where.date = {};
      if (fromDate) where.date.gte = new Date(`${fromDate}T00:00:00Z`);
      if (toDate) where.date.lte = new Date(`${toDate}T23:59:59Z`);
    }
    const [data, total] = await Promise.all([
      this.prisma.marketingCampaignInsight.findMany({
        where,
        include: { campaign: { select: { id: true, name: true } } },
        orderBy: [{ date: 'desc' }],
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.marketingCampaignInsight.count({ where }),
    ]);
    return {
      data,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async listAudit(page = 1, perPage = 20) {
    const [data, total] = await Promise.all([
      this.prisma.marketingAuditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.marketingAuditLog.count(),
    ]);
    return {
      data,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    };
  }

  getDecryptedToken(connection): { token: string; refreshToken: string | null } {
    return {
      token: this.encryption.decrypt(connection.accessTokenEnc),
      refreshToken: connection.refreshTokenEnc
        ? this.encryption.decrypt(connection.refreshTokenEnc)
        : null,
    };
  }

  async refreshLongLivedToken(connectionId: string) {
    const connection = await this.prisma.marketingConnection.findUnique({
      where: { id: connectionId },
      include: { platform: true },
    });
    if (!connection) {
      this.logger.warn(`Token refresh skipped: connection ${connectionId} not found`);
      return null;
    }

    const [appIdSetting, appSecretSetting] = await Promise.all([
      this.prisma.systemSetting.findUnique({ where: { key: APP_ID_SETTING } }),
      this.prisma.systemSetting.findUnique({ where: { key: APP_SECRET_SETTING } }),
    ]);
    if (!appIdSetting?.value || !appSecretSetting?.value) {
      this.logger.warn(
        `Token refresh skipped: ${APP_ID_SETTING} or ${APP_SECRET_SETTING} not configured`,
      );
      return null;
    }

    const { token } = this.getDecryptedToken(connection);
    const adapter = this.providerFactory.getAdapter(connection.platform?.slug ?? 'facebook');
    try {
      const result = await adapter.refreshToken(
        token,
        appIdSetting.value,
        appSecretSetting.value,
      );
      if (!result?.accessToken) {
        this.logger.warn(
          `Token refresh failed for connection ${connectionId}: no access_token returned`,
        );
        return null;
      }

      const updated = await this.prisma.marketingConnection.update({
        where: { id: connectionId },
        data: {
          accessTokenEnc: this.encryption.encrypt(result.accessToken),
          tokenExpiry: result.expiresIn
            ? new Date(Date.now() + Number(result.expiresIn) * 1000)
            : null,
          status: 'connected',
        },
        include: { platform: true },
      });
      await this.prisma.marketingAuditLog.create({
        data: {
          action: 'connection.token_refresh',
          entityType: 'connection',
          entityId: connectionId,
          metadata: { provider: connection.platform?.slug ?? null },
        },
      });
      this.logger.log(`Long-lived token refreshed for connection ${connectionId}`);
      return this.sanitize(updated as any);
    } catch (err) {
      this.logger.warn(
        `Token refresh failed for connection ${connectionId}: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  async pauseCampaign(campaignId: string, userId?: string) {
    return this.setCampaignStatus(campaignId, 'PAUSED', userId);
  }

  async resumeCampaign(campaignId: string, userId?: string) {
    return this.setCampaignStatus(campaignId, 'ACTIVE', userId);
  }

  private async setCampaignStatus(
    campaignId: string,
    status: 'PAUSED' | 'ACTIVE',
    userId?: string,
  ) {
    const campaign = await this.prisma.marketingCampaign.findUnique({
      where: { id: campaignId },
      include: { adAccount: { include: { connection: { include: { platform: true } } } } },
    });
    if (!campaign || !campaign.adAccount?.connection) {
      throw new BadRequestException('Campaign not found');
    }
    const { token } = this.getDecryptedToken(campaign.adAccount.connection);
    const adapter = this.providerFactory.getAdapter(campaign.adAccount.connection.platform?.slug ?? 'facebook');
    const verb = status === 'PAUSED' ? 'pause' : 'resume';
    try {
      if (status === 'PAUSED') {
        await adapter.pauseCampaign(token, campaign.providerCampaignId);
      } else {
        await adapter.resumeCampaign(token, campaign.providerCampaignId);
      }
    } catch (err) {
      throw new BadRequestException(
        `Failed to ${verb} campaign: ${err instanceof Error ? err.message : 'unknown error'}`,
      );
    }
    const updated = await this.prisma.marketingCampaign.update({
      where: { id: campaignId },
      data: { status, effectiveStatus: status, lastSyncedAt: new Date() },
    });
    await this.prisma.marketingAuditLog.create({
      data: {
        action: `campaign.${verb}`,
        entityType: 'campaign',
        entityId: campaignId,
        actorId: userId,
      },
    });
    return { ok: true, status: updated.status };
  }

  private sanitize(connection: any) {
    const { accessTokenEnc, refreshTokenEnc, ...rest } = connection;
    return rest;
  }
}