import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CaptureSessionDto } from './dto/marketing.dto';

export interface AttributionInput {
  sourcePlatform?: string | null;
  sourceType?: string | null;
  sourceEntity?: string | null;
  trackingSessionId?: string | null;
  attribution?: Record<string, any> | null;
}

@Injectable()
export class MarketingAttributionService {
  private readonly logger = new Logger(MarketingAttributionService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Store a landing/journey session (called by the storefront capture
   * endpoint, rate-limited). Campaign is matched at capture time when the UTM
   * campaign value equals a synced campaign id or name (deterministic match —
   * never guessed).
   */
  async captureSession(
    dto: CaptureSessionDto,
    ip?: string,
  ): Promise<{ id: string; created: boolean }> {
    const campaign = await this.matchCampaign(dto.utmCampaign);

    const existing = await this.prisma.marketingSession.findUnique({
      where: { sessionToken: dto.sessionToken },
    });

    const data = {
      visitorId: dto.visitorId ?? 'anonymous',
      fbclid: dto.fbclid || existing?.fbclid || null,
      clickId: dto.clickId || dto.fbclid || existing?.clickId || null,
      utmSource: dto.utmSource || existing?.utmSource || null,
      utmMedium: dto.utmMedium || existing?.utmMedium || null,
      utmCampaign: dto.utmCampaign || existing?.utmCampaign || null,
      utmContent: dto.utmContent || existing?.utmContent || null,
      utmTerm: dto.utmTerm || existing?.utmTerm || null,
      referrer: dto.referrer || existing?.referrer || null,
      landingUrl: dto.landingUrl || existing?.landingUrl || null,
      ip: ip || existing?.ip || null,
      userAgent: dto.userAgent || existing?.userAgent || null,
      campaignId: campaign?.id ?? existing?.campaignId ?? null,
      endedAt: null,
    };

    if (existing) {
      await this.prisma.marketingSession.update({
        where: { id: existing.id },
        data,
      });
      return { id: existing.id, created: false };
    }

    const created = await this.prisma.marketingSession.create({
      data: { sessionToken: dto.sessionToken, ...data },
    });
    return { id: created.id, created: true };
  }

  /**
   * Deterministic single-touch attribution resolution for a freshly created
   * order. Resolution order (first match wins, each hop is explicit):
   *  1. session-matched campaign (tracking journey link)
   *  2. click_id (generic) — most recent session carrying a click identifier
   *  3. UTM campaign value matching a synced campaign id/name
   * Records an OrderAttribution (orderId unique — exactly one record per
   * order; later resolutions never overwrite the first outcome).
   */
  async resolveFromOrder(
    orderId: string,
    input: AttributionInput,
  ): Promise<any | null> {
    const existing = await this.prisma.orderAttribution.findUnique({
      where: { orderId },
    });
    if (existing) return null;

    let target: {
      sessionId?: string;
      campaignId?: string;
      method: 'click_id' | 'conversion_api' | 'pixel' | 'session' | 'utm';
      confidence: number;
      explanation: string;
    } | null = null;

    const sessionToken = input.trackingSessionId;
    const campaignValue =
      input.sourceEntity ||
      (input.attribution?.utm_campaign as string) ||
      null;

    if (sessionToken) {
      const session = await this.prisma.marketingSession.findUnique({
        where: { sessionToken },
      });
      if (session) {
        if (session.campaignId) {
          target = {
            sessionId: session.id,
            campaignId: session.campaignId,
            method: 'session',
            confidence: 95,
            explanation: `Tracking session ${sessionToken} matched campaign at landing`,
          };
        } else {
          target = {
            sessionId: session.id,
            method: 'session',
            confidence: 40,
            explanation: `Tracking session matched but campaign was not resolved`,
          };
        }
      }
    }

    if (!target?.campaignId) {
      const clickId =
        (input.attribution?.clickId as string) ||
        (input.attribution?.click_id as string) ||
        (input.attribution?.fbclid as string) ||
        (input.attribution?.fb_click_id as string) ||
        null;
      if (clickId) {
        const session = await this.prisma.marketingSession.findFirst({
          where: {
            OR: [{ clickId }, { fbclid: clickId }],
          },
          orderBy: { createdAt: 'desc' },
        });
        if (session?.campaignId) {
          target = {
            sessionId: session.id,
            campaignId: session.campaignId,
            method: 'click_id',
            confidence: 90,
            explanation: `click_id ${clickId} matched landing session`,
          };
        } else if (session) {
          target = {
            sessionId: session.id,
            method: 'click_id',
            confidence: 30,
            explanation: 'click_id matched a session without a campaign',
          };
        }
      }
    }

    if (!target?.campaignId && campaignValue) {
      const campaign = await this.matchCampaign(campaignValue);
      const isAdPlatform = input.sourceType === 'ad';
      if (campaign) {
        target = {
          campaignId: campaign.id,
          method: 'utm',
          confidence: isAdPlatform ? 80 : 65,
          explanation: `utm campaign "${campaignValue}" matched ${campaign.name}`,
        };
      }
    }

    if (!target) {
      return null;
    }

    return this.prisma.orderAttribution.create({
      data: {
        orderId,
        sessionId: target.sessionId ?? null,
        campaignId: target.campaignId ?? null,
        adSetId: null,
        adId: null,
        confidence: target.confidence,
        method: target.method,
        explanation: target.explanation,
        attributionVersion: 1,
      },
    });
  }

  /**
   * Re-run attribution for orders that have no record yet (admin-triggered,
   * explicit range or the last 30 days). Deterministic: only fills gaps,
   * never overwrites existing rows.
   */
  async rebuildMissing(fromDate?: string, toDate?: string) {
    const where: any = {
      orderAttribution: { is: null },
    };
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = new Date(`${fromDate}T00:00:00Z`);
      if (toDate) where.createdAt.lte = new Date(`${toDate}T23:59:59Z`);
    }

    const orders = await this.prisma.order.findMany({
      where,
      take: 500,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        sourcePlatform: true,
        sourceType: true,
        sourceEntity: true,
        trackingSessionId: true,
      },
    });

    const results: Array<{ orderId: string; attributed: boolean }> = [];
    for (const order of orders) {
      const attribution = await this.resolveFromOrder(order.id, {
        sourcePlatform: order.sourcePlatform,
        sourceType: order.sourceType,
        sourceEntity: order.sourceEntity,
        trackingSessionId: order.trackingSessionId,
        attribution: null,
      });
      results.push({ orderId: order.id, attributed: !!attribution });
    }

    return { scanned: orders.length, attributed: results.filter((r) => r.attributed).length };
  }

  async listSessions(page = 1, perPage = 20, utmCampaign?: string) {
    const where: any = {};
    if (utmCampaign) where.utmCampaign = utmCampaign;
    const [data, total] = await Promise.all([
      this.prisma.marketingSession.findMany({
        where,
        include: {
          campaign: { select: { id: true, name: true } },
          orderAttributions: { select: { orderId: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.marketingSession.count({ where }),
    ]);
    return {
      data,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    };
  }

  async listAttributions(page = 1, perPage = 20, campaignId?: string) {
    const where: any = {};
    if (campaignId) where.campaignId = campaignId;
    const [data, total] = await Promise.all([
      this.prisma.orderAttribution.findMany({
        where,
        include: {
          order: { select: { id: true, displayId: true, total: true, createdAt: true } },
          campaign: { select: { id: true, name: true } },
        },
        orderBy: { attributedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.orderAttribution.count({ where }),
    ]);
    return {
      data,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    };
  }

  /**
   * Match a campaign value (provider id or name) against synced campaigns.
   * Only exact matches — no fuzzy guessing.
   */
  async matchCampaign(value?: string | null) {
    if (!value) return null;
    return this.prisma.marketingCampaign.findFirst({
      where: {
        deletedFromProvider: false,
        OR: [{ providerCampaignId: value }, { name: value }],
      },
    });
  }
}