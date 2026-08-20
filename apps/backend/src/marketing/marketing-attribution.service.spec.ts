import { Test, TestingModule } from '@nestjs/testing';
import { MarketingAttributionService } from './marketing-attribution.service';
import { PrismaService } from '../prisma/prisma.service';

describe('MarketingAttributionService', () => {
  let service: MarketingAttributionService;
  let prisma: PrismaService;

  const mockPrisma = () => ({
    marketingSession: { findUnique: jest.fn(), findFirst: jest.fn(), upsert: jest.fn(), create: jest.fn(), update: jest.fn() },
    marketingCampaign: { findUnique: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    orderAttribution: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    order: { findMany: jest.fn() },
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

    it('falls back to fbclid when the session exists but has no campaign', async () => {
      (prisma.orderAttribution.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.marketingSession.findUnique as jest.Mock).mockResolvedValue({
        id: 'session-1',
        campaignId: null,
      });
      (prisma.marketingSession.findFirst as jest.Mock).mockResolvedValue({
        id: 'session-2',
        campaignId: 'camp-fb',
        fbclid: 'fb.1.123.456',
      });
      (prisma.orderAttribution.create as jest.Mock).mockResolvedValue({ id: 'attr-1' });

      await service.resolveFromOrder('order-1', input());
      const created = (prisma.orderAttribution.create as jest.Mock).mock.calls[0][0].data;
      expect(created.method).toBe('fbclid');
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