import { Test, TestingModule } from '@nestjs/testing';
import { MarketingAttributionService } from './marketing-attribution.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MarketingAttributionService', () => {
  let service: MarketingAttributionService;
  let prisma: PrismaService;

  const mockPrisma = () => ({
    marketingSession: { findUnique: jest.fn(), findFirst: jest.fn(), upsert: jest.fn(), create: jest.fn(), update: jest.fn() },
    marketingCampaign: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    marketingAd: { findFirst: jest.fn().mockResolvedValue(null) },
    marketingAdSet: { findFirst: jest.fn().mockResolvedValue(null) },
    orderAttribution: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    order: { findMany: jest.fn() },
    // Campaign aliases live in SystemSetting; absent by default.
    systemSetting: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingAttributionService,
        { provide: PrismaService, useValue: mockPrisma() },
      ],
    }).compile();
    service = module.get(MarketingAttributionService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => jest.clearAllMocks());

  const input = (over: Partial<any> = {}) => ({
    sourcePlatform: 'facebook',
    sourceType: 'ad',
    sourceEntity: 'campaign_name_123',
    trackingSessionId: 'ctx-abc',
    attribution: { fbclid: 'fb.1.123.456', utm_campaign: 'launch' },
    ...over,
  });

  describe('resolveFromOrder — determinism', () => {
    it('never overwrites an existing attribution (one record per order)', async () => {
      (prisma.orderAttribution.findUnique as jest.Mock).mockResolvedValue({
        id: 'attr-existing',
        orderId: 'order-1',
      });
      const res = await service.resolveFromOrder('order-1', input());
      expect(res).toBeNull();
      expect(prisma.orderAttribution.create).not.toHaveBeenCalled();
      expect(prisma.marketingSession.findUnique).not.toHaveBeenCalled();
    });

    it('returns null when nothing matches (no session, no fbclid session, no campaign)', async () => {
      (prisma.orderAttribution.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.marketingSession.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.marketingSession.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.marketingCampaign.findUnique as jest.Mock).mockResolvedValue(null);

      const res = await service.resolveFromOrder('order-1', {
        sourcePlatform: 'website',
        sourceType: 'organic',
        trackingSessionId: 'ctx-nomatch',
        attribution: { fbclid: 'unknown-click-id' },
      });
      expect(res).toBeNull();
      expect(prisma.orderAttribution.create).not.toHaveBeenCalled();
    });

    it('prefers a session-matched campaign over fbclid (first match wins)', async () => {
      (prisma.orderAttribution.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.marketingSession.findUnique as jest.Mock).mockResolvedValue({
        id: 'session-1',
        sessionToken: 'ctx-abc',
        campaignId: 'camp-1',
        fbclid: null,
        utmSource: 'facebook',
      });
      // Even though fbclid would also match, session must win.
      (prisma.orderAttribution.create as jest.Mock).mockResolvedValue({ id: 'attr-1' });

      await service.resolveFromOrder('order-1', input());
      const created = (prisma.orderAttribution.create as jest.Mock).mock.calls[0][0].data;
      expect(created.method).toBe('session');
      expect(created.campaignId).toBe('camp-1');
      expect(created.sessionId).toBe('session-1');
      expect(created.confidence).toBe(95);
      expect(prisma.marketingSession.findFirst).not.toHaveBeenCalled();
    });

    it('falls back to click_id when the session exists but has no campaign', async () => {
      (prisma.orderAttribution.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.marketingSession.findUnique as jest.Mock).mockResolvedValue({
        id: 'session-1',
        campaignId: null,
      });
      (prisma.marketingSession.findFirst as jest.Mock).mockResolvedValue({
        id: 'session-2',
        campaignId: 'camp-fb',
        clickId: 'fb.1.123.456',
      });
      (prisma.orderAttribution.create as jest.Mock).mockResolvedValue({ id: 'attr-1' });

      await service.resolveFromOrder('order-1', input());
      const created = (prisma.orderAttribution.create as jest.Mock).mock.calls[0][0].data;
      expect(created.method).toBe('click_id');
      expect(created.campaignId).toBe('camp-fb');
      expect(created.sessionId).toBe('session-2');
      expect(created.confidence).toBe(90);
    });

    it('falls back to UTM campaign match when no session or fbclid resolves', async () => {
      (prisma.orderAttribution.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.marketingSession.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.marketingSession.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.marketingCampaign.findFirst as jest.Mock).mockResolvedValue({
        id: 'camp-utm-1',
        name: 'launch',
      });
      (prisma.orderAttribution.create as jest.Mock).mockResolvedValue({ id: 'attr-1' });

      await service.resolveFromOrder('order-1', input());
      const created = (prisma.orderAttribution.create as jest.Mock).mock.calls[0][0].data;
      expect(created.method).toBe('utm');
      expect(created.campaignId).toBe('camp-utm-1');
      // facebook platform + sourceType 'ad' → higher confidence
      expect(created.confidence).toBe(80);
      expect(created.explanation).toContain('launch');
    });
  });

  describe('captureSession', () => {
    it('creates a session when none exists and links the matched campaign', async () => {
      (prisma.marketingSession.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.marketingCampaign.findFirst as jest.Mock).mockResolvedValue({ id: 'camp-1', name: 'launch' });
      (prisma.marketingSession.create as jest.Mock).mockResolvedValue({ id: 'session-1' });
      await service.captureSession({
        sessionToken: 'ctx-abc',
        fbclid: 'fb.1.1.2',
        utmSource: 'facebook',
        utmCampaign: 'launch',
        utmMedium: 'cpc',
        referrer: 'https://facebook.com',
      });
      const args = (prisma.marketingSession.create as jest.Mock).mock.calls[0][0];
      expect(args.data.sessionToken).toBe('ctx-abc');
      expect(args.data.fbclid).toBe('fb.1.1.2');
      expect(args.data.campaignId).toBe('camp-1');
    });

    it('updates an existing session with new signals, keeping old ones when omitted', async () => {
      (prisma.marketingSession.findUnique as jest.Mock).mockResolvedValue({
        id: 'session-1',
        fbclid: 'fb-old',
        campaignId: 'camp-1',
        utmSource: 'facebook',
        utmCampaign: 'launch',
        utmMedium: 'cpc',
        utmContent: null,
        utmTerm: null,
        referrer: null,
        landingUrl: null,
        ip: null,
        userAgent: null,
      });
      (prisma.marketingSession.update as jest.Mock).mockResolvedValue({ id: 'session-1' });
      const res = await service.captureSession({ sessionToken: 'ctx-abc', utmSource: 'facebook' });
      const args = (prisma.marketingSession.update as jest.Mock).mock.calls[0][0];
      expect(res).toEqual({ id: 'session-1', created: false });
      expect(args.where).toEqual({ id: 'session-1' });
      expect(args.data.fbclid).toBe('fb-old');
      expect(args.data.campaignId).toBe('camp-1');
      expect(args.data.sessionToken).toBeUndefined();
    });
  });

  describe('matchCampaign — normalization and aliases', () => {
    it('matches an exact provider id or name first', async () => {
      (prisma.marketingCampaign.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'camp-1', name: 'Ramadan' });
      const res = await service.matchCampaign('123456');
      expect(res).toEqual({ id: 'camp-1', name: 'Ramadan' });
      // No normalization lookup needed once the exact match hits.
      expect(prisma.marketingCampaign.findFirst).toHaveBeenCalledTimes(1);
    });

    it('falls back to a trimmed, case-insensitive match', async () => {
      (prisma.marketingCampaign.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'camp-2', name: 'Ramadan Sale' });
      const res = await service.matchCampaign('  ramadan sale ');
      expect(res).toEqual({ id: 'camp-2', name: 'Ramadan Sale' });
    });

    it('resolves an operator-defined alias when no name matches', async () => {
      (prisma.marketingCampaign.findFirst as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'camp-3', name: 'Eid Campaign' });
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: 'marketing_campaign_aliases',
        value: JSON.stringify({ fb_eid_2: 'camp-3' }),
      });

      const res = await service.matchCampaign('fb_eid_2');
      expect(res).toEqual({ id: 'camp-3', name: 'Eid Campaign' });
    });

    it('ignores a malformed alias setting instead of throwing', async () => {
      (prisma.marketingCampaign.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.systemSetting.findUnique as jest.Mock).mockResolvedValue({
        key: 'marketing_campaign_aliases',
        value: 'not-json{',
      });

      await expect(service.matchCampaign('whatever')).resolves.toBeNull();
    });

    it('never guesses: an unmapped value resolves to null', async () => {
      (prisma.marketingCampaign.findFirst as jest.Mock).mockResolvedValue(null);
      expect(await service.matchCampaign('totally-unknown')).toBeNull();
      expect(await service.matchCampaign('   ')).toBeNull();
      expect(await service.matchCampaign(null)).toBeNull();
    });
  });

  describe('resolveFromOrder — ad set / ad resolution', () => {
    const base = {
      sourcePlatform: 'facebook',
      sourceType: 'AD',
      trackingSessionId: null,
      attribution: { utm_campaign: 'brand', utm_content: 'ad-777' },
    };

    it('links the ad and its campaign when utm_content carries a provider ad id', async () => {
      (prisma.orderAttribution.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.marketingCampaign.findFirst as jest.Mock).mockResolvedValue({
        id: 'camp-9',
        name: 'Brand',
      });
      (prisma.marketingAd.findFirst as jest.Mock).mockResolvedValue({
        id: 'ad-row-1',
        adSetId: 'adset-row-1',
        adSet: { campaignId: 'camp-9', campaign: { name: 'Brand' } },
      });
      (prisma.orderAttribution.create as jest.Mock).mockImplementation(({ data }) => data);

      await service.resolveFromOrder('order-9', base);

      expect(prisma.orderAttribution.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'order-9',
          campaignId: 'camp-9',
          adId: 'ad-row-1',
          adSetId: 'adset-row-1',
        }),
      });
    });

    it('attributes through the ad even when the campaign name does not match', async () => {
      (prisma.orderAttribution.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.marketingCampaign.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.marketingAd.findFirst as jest.Mock).mockResolvedValue({
        id: 'ad-row-2',
        adSetId: 'adset-row-2',
        adSet: { campaignId: 'camp-42', campaign: { name: 'Unsynced name' } },
      });
      (prisma.orderAttribution.create as jest.Mock).mockImplementation(({ data }) => data);

      await service.resolveFromOrder('order-10', base);

      expect(prisma.orderAttribution.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          campaignId: 'camp-42',
          adId: 'ad-row-2',
          confidence: 70,
        }),
      });
    });

    it('resolves the ad set from utm_term on a unique provider id', async () => {
      (prisma.orderAttribution.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.marketingCampaign.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.marketingAd.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.marketingAdSet.findFirst as jest.Mock).mockResolvedValue({
        id: 'adset-row-3',
        campaignId: 'camp-3',
        campaign: { name: 'Ramadan' },
      });
      (prisma.orderAttribution.create as jest.Mock).mockImplementation(({ data }) => data);

      await service.resolveFromOrder('order-11', {
        sourcePlatform: 'facebook',
        sourceType: 'AD',
        trackingSessionId: null,
        attribution: { utm_term: 'adset-99' },
      });

      expect(prisma.orderAttribution.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ adSetId: 'adset-row-3', adId: null }),
      });
    });

    it('records an ad id without a campaign rather than dropping the link', async () => {
      (prisma.orderAttribution.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.marketingCampaign.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.marketingAd.findFirst as jest.Mock).mockResolvedValue({
        id: 'ad-row-4',
        adSetId: 'adset-row-4',
        adSet: { campaignId: null, campaign: null },
      });
      (prisma.orderAttribution.create as jest.Mock).mockImplementation(({ data }) => data);

      await service.resolveFromOrder('order-12', base);

      expect(prisma.orderAttribution.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          adId: 'ad-row-4',
          campaignId: null,
          confidence: 50,
        }),
      });
    });
  });

  describe('rebuildMissing', () => {
    it('scans only un-attributed orders and reports the tally', async () => {
      (prisma.order.findMany as jest.Mock).mockResolvedValue([
        { id: 'order-1', trackingSessionId: 'ctx-1' },
        { id: 'order-2', trackingSessionId: null },
      ]);
      const resolveSpy = jest
        .spyOn(service as any, 'resolveFromOrder')
        .mockResolvedValueOnce({ id: 'attr-new' })
        .mockResolvedValueOnce(null);

      const res = await service.rebuildMissing();
      expect(res).toEqual({ scanned: 2, attributed: 1 });
      expect(prisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ orderAttribution: { is: null } }) }),
      );
      expect(resolveSpy).toHaveBeenCalledWith('order-1', expect.objectContaining({ trackingSessionId: 'ctx-1' }));
      expect(resolveSpy).toHaveBeenCalledWith('order-2', expect.any(Object));
    });
  });
});