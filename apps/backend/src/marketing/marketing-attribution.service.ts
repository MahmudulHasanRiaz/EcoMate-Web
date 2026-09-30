import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CaptureSessionDto } from './dto/marketing.dto';

export interface AttributionInput {
  sourcePlatform?: string | null;
  sourceType?: string | null;
  sourceEntity?: string | null;
  trackingSessionId?: string | null;
  attribution?: Record<string, any> | null;
}

/**
 * Every key an order payload may use for a platform click id, strongest first.
 * A click id is the only proof that a click came from a paid ad, so the
 * resolver accepts all of them rather than only the Meta one.
 */
const CLICK_ID_KEYS = [
  'clickId',
  'click_id',
  'fbclid',
  'fb_click_id',
  'gclid',
  'wbraid',
  'gbraid',
  'msclkid',
  'ttclid',
  'twclid',
  'igshid',
] as const;

/** First non-empty value, in the caller-supplied precedence order. */
function firstClickId(values: Array<string | undefined | null>): string | null {
  for (const value of values) {
    if (value) return value;
  }
  return null;
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

    // One generic clickId column holds whichever provider id this journey
    // produced (Meta / Google / Bing / TikTok / X / Instagram).
    const incomingClickId = firstClickId([
      dto.clickId,
      dto.fbclid,
      dto.gclid,
      dto.wbraid,
      dto.gbraid,
      dto.msclkid,
      dto.ttclid,
      dto.twclid,
      dto.igshid,
    ]);

    const data = {
      visitorId: dto.visitorId ?? 'anonymous',
      fbclid: dto.fbclid || existing?.fbclid || null,
      clickId: incomingClickId || existing?.clickId || null,
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

    // The session row the resolution landed on, if any — it may already carry
    // the ad set / ad the journey was attributed to.
    let sessionRow: { id: string; adSetId?: string | null; adId?: string | null } | null =
      null;

    const sessionToken = input.trackingSessionId;
    // The campaign dimension may be carried by utm_campaign or by an explicit
    // sourceEntity. utm_campaign is checked FIRST: sourceEntity is the storefront
    // identity (store name) and would otherwise permanently shadow the campaign.
    const campaignValue =
      (input.attribution?.utm_campaign as string) ||
      (input.attribution?.utmCampaign as string) ||
      input.sourceEntity ||
      null;

    if (sessionToken) {
      const session = await this.prisma.marketingSession.findUnique({
        where: { sessionToken },
      });
      if (session) {
        sessionRow = session;
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
      const clickId = firstClickId(
        CLICK_ID_KEYS.map((key) => input.attribution?.[key] as string | undefined),
      );
      if (clickId) {
        const session = await this.prisma.marketingSession.findFirst({
          where: {
            OR: [{ clickId }, { fbclid: clickId }],
          },
          orderBy: { createdAt: 'desc' },
        });
        if (session?.campaignId) {
          sessionRow = session;
          target = {
            sessionId: session.id,
            campaignId: session.campaignId,
            method: 'click_id',
            confidence: 90,
            explanation: `click_id ${clickId} matched landing session`,
          };
        } else if (session) {
          sessionRow = session;
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

    // Ad set / ad: taken from the journey session when it knows them, otherwise
    // resolved from provider ids carried in utm_content (ad) / utm_term (ad set).
    // Exact lookups on unique provider ids only — a keyword in utm_term simply
    // does not match, so nothing is ever guessed.
    const adTarget = await this.resolveAdTarget(
      input.attribution,
      sessionRow,
    );
    if (!target?.campaignId && adTarget?.campaignId) {
      target = {
        sessionId: target?.sessionId,
        campaignId: adTarget.campaignId,
        method: 'utm',
        confidence: 70,
        explanation: `Ad ${adTarget.adId ?? adTarget.adSetId} belongs to campaign ${adTarget.campaignName ?? adTarget.campaignId}`,
      };
    }

    // An ad id with no campaign is still a fact worth recording (the campaign
    // simply is not synced yet) — the row keeps the ad link for later repair.
    if (!target && adTarget) {
      target = {
        method: 'utm',
        confidence: 50,
        explanation: `Ad ${adTarget.adId ?? adTarget.adSetId} matched but its campaign is not resolved`,
      };
    }

    if (!target) {
      return null;
    }

    return this.prisma.orderAttribution.create({
      data: {
        orderId,
        sessionId: target.sessionId ?? null,
        campaignId: target.campaignId ?? null,
        adSetId: adTarget?.adSetId ?? null,
        adId: adTarget?.adId ?? null,
        confidence: target.confidence,
        method: target.method,
        explanation: target.explanation,
        attributionVersion: 1,
      },
    });
  }

  /**
   * Resolve the ad set / ad an order belongs to, deterministically.
   *
   * Sources, in order: the journey session (it recorded them at capture), then
   * `utm_content` holding a provider AD id, then `utm_term` holding a provider
   * AD SET id. The campaign is taken from the ad's own ad set so an order that
   * matched no campaign elsewhere can still be attributed through its ad.
   */
  private async resolveAdTarget(
    attribution: Record<string, any> | null | undefined,
    session: { adSetId?: string | null; adId?: string | null } | null,
  ): Promise<{
    adId: string | null;
    adSetId: string | null;
    campaignId: string | null;
    campaignName: string | null;
  } | null> {
    let adId: string | null = session?.adId ?? null;
    let adSetId: string | null = session?.adSetId ?? null;
    let campaignId: string | null = null;
    let campaignName: string | null = null;

    const contentValue = (attribution?.utm_content ?? attribution?.utmContent) as
      | string
      | undefined;
    if (!adId && contentValue) {
      const ad = await this.prisma.marketingAd.findFirst({
        where: { providerAdId: contentValue },
        select: {
          id: true,
          adSetId: true,
          adSet: { select: { campaignId: true, campaign: { select: { name: true } } } },
        },
      });
      if (ad) {
        adId = ad.id;
        adSetId = adSetId ?? ad.adSetId;
        campaignId = ad.adSet.campaignId;
        campaignName = ad.adSet.campaign?.name ?? null;
      }
    }

    const termValue = (attribution?.utm_term ?? attribution?.utmTerm) as
      | string
      | undefined;
    if (!adSetId && termValue) {
      const adSet = await this.prisma.marketingAdSet.findFirst({
        where: { providerAdSetId: termValue },
        select: { id: true, campaignId: true, campaign: { select: { name: true } } },
      });
      if (adSet) {
        adSetId = adSet.id;
        campaignId = campaignId ?? adSet.campaignId;
        campaignName = campaignName ?? adSet.campaign?.name ?? null;
      }
    }

    if (!adId && !adSetId) return null;
    return { adId, adSetId, campaignId, campaignName };
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
      where: { ...where, kind: 'SALE' },
      take: 500,
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        sourcePlatform: true,
        sourceType: true,
        sourceEntity: true,
        trackingSessionId: true,
        // The order's own frozen landing signals — far better raw input than
        // nothing, and it survives a pruned/overwritten journey session.
        attribution: true,
      },
    });

    const results: Array<{ orderId: string; attributed: boolean }> = [];
    for (const order of orders) {
      const snapshot = (order.attribution as Record<string, any> | null) ?? null;
      const attribution = await this.resolveFromOrder(order.id, {
        sourcePlatform: order.sourcePlatform,
        sourceType: order.sourceType,
        sourceEntity: order.sourceEntity,
        trackingSessionId: order.trackingSessionId,
        attribution: snapshot
          ? {
              utmSource: snapshot.utm?.source,
              utmMedium: snapshot.utm?.medium,
              utmCampaign: snapshot.utm?.campaign,
              utmContent: snapshot.utm?.content,
              utmTerm: snapshot.utm?.term,
              referrer: snapshot.referrer,
              ...(snapshot.clickIds ?? {}),
            }
          : null,
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
  /**
   * Resolve a utm_campaign / sourceEntity value to a synced campaign.
   *
   * Matching is deliberately conservative but no longer brittle:
   *   1. exact provider campaign id or campaign name
   *   2. the same, case-insensitive and trimmed (utm values are hand-typed)
   *   3. an explicit alias the operator mapped in the attribution settings
   * Anything else returns null — the resolver never guesses a campaign.
   */
  async matchCampaign(value?: string | null) {
    const raw = (value || '').trim();
    if (!raw) return null;

    const exact = await this.prisma.marketingCampaign.findFirst({
      where: {
        deletedFromProvider: false,
        OR: [{ providerCampaignId: raw }, { name: raw }],
      },
    });
    if (exact) return exact;

    const insensitive = await this.prisma.marketingCampaign.findFirst({
      where: {
        deletedFromProvider: false,
        OR: [
          { providerCampaignId: { equals: raw, mode: 'insensitive' } },
          { name: { equals: raw, mode: 'insensitive' } },
        ],
      },
    });
    if (insensitive) return insensitive;

    const aliasedId = (await this.campaignAliases())[raw.toLowerCase()];
    if (!aliasedId) return null;
    return this.prisma.marketingCampaign.findFirst({
      where: { id: aliasedId, deletedFromProvider: false },
    });
  }

  /** SystemSetting key holding the operator-defined utm value → campaign map. */
  static readonly CAMPAIGN_ALIAS_KEY = 'marketing_campaign_aliases';

  /** Raw alias map: lowercased utm/source value → campaign id. */
  private async campaignAliases(): Promise<Record<string, string>> {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: MarketingAttributionService.CAMPAIGN_ALIAS_KEY },
    });
    if (!setting?.value) return {};
    try {
      const parsed = JSON.parse(setting.value);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: Record<string, string> = {};
      for (const [key, id] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof id === 'string' && id) out[key.trim().toLowerCase()] = id;
      }
      return out;
    } catch {
      // A malformed setting must never break attribution — treat as no aliases.
      this.logger.warn('marketing_campaign_aliases is not valid JSON; ignoring');
      return {};
    }
  }

  /** Aliases with the campaign they point at, for the settings UI. */
  async listCampaignAliases(): Promise<
    Array<{ utmValue: string; campaignId: string; campaignName: string | null }>
  > {
    const map = await this.campaignAliases();
    const ids = [...new Set(Object.values(map))];
    if (!ids.length) return [];
    const campaigns = await this.prisma.marketingCampaign.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    const nameById = new Map(campaigns.map((c) => [c.id, c.name]));
    return Object.entries(map)
      .map(([utmValue, campaignId]) => ({
        utmValue,
        campaignId,
        campaignName: nameById.get(campaignId) ?? null,
      }))
      .sort((a, b) => a.utmValue.localeCompare(b.utmValue));
  }

  /**
   * Replace the alias map. Campaign ids are verified first so an alias can never
   * point at a campaign that does not exist.
   */
  async setCampaignAliases(
    aliases: Array<{ utmValue: string; campaignId: string }>,
  ): Promise<Array<{ utmValue: string; campaignId: string; campaignName: string | null }>> {
    const cleaned = aliases
      .map((a) => ({
        utmValue: (a.utmValue || '').trim(),
        campaignId: (a.campaignId || '').trim(),
      }))
      .filter((a) => a.utmValue && a.campaignId);

    for (const alias of cleaned) {
      const exists = await this.prisma.marketingCampaign.findUnique({
        where: { id: alias.campaignId },
        select: { id: true },
      });
      if (!exists) {
        throw new BadRequestException(
          `Unknown campaign for alias "${alias.utmValue}"`,
        );
      }
    }

    const map: Record<string, string> = {};
    for (const alias of cleaned) map[alias.utmValue.toLowerCase()] = alias.campaignId;

    await this.prisma.systemSetting.upsert({
      where: { key: MarketingAttributionService.CAMPAIGN_ALIAS_KEY },
      create: {
        key: MarketingAttributionService.CAMPAIGN_ALIAS_KEY,
        value: JSON.stringify(map),
      },
      update: { value: JSON.stringify(map) },
    });

    return this.listCampaignAliases();
  }
}