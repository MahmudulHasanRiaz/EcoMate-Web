import { Test, TestingModule } from '@nestjs/testing';
import { WebhookAttemptService } from './webhook-attempt.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookAttemptOutcome, WebhookAttemptStage } from '@prisma/client';

describe('WebhookAttemptService', () => {
  let service: WebhookAttemptService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      webhookAttempt: {
        create: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        deleteMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WebhookAttemptService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WebhookAttemptService>(WebhookAttemptService);
  });

  describe('logAttempt', () => {
    it('creates a webhook attempt record', async () => {
      prisma.webhookAttempt.create.mockResolvedValue({ id: 'att-1' });

      const id = await service.logAttempt({
        courier: 'steadfast',
        path: '/api/webhooks/courier/steadfast',
        outcome: WebhookAttemptOutcome.SUCCESS,
        responseStatus: 200,
        correlationId: 'corr-1',
        sourceIp: '1.2.3.4',
      });

      expect(id).toBe('att-1');
      expect(prisma.webhookAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          courier: 'steadfast',
          method: 'POST',
          path: '/api/webhooks/courier/steadfast',
          responseStatus: 200,
          outcome: WebhookAttemptOutcome.SUCCESS,
          correlationId: 'corr-1',
          sourceIp: '1.2.3.4',
        }),
      });
    });

    it('never stores raw secrets or authorization headers', async () => {
      prisma.webhookAttempt.create.mockResolvedValue({ id: 'att-2' });

      await service.logAttempt({
        courier: 'steadfast',
        path: '/api/webhooks/courier/steadfast',
        outcome: WebhookAttemptOutcome.AUTH_FAILED,
        authResult: 'Token mismatch — fingerprint abc12345',
      });

      const createCall = prisma.webhookAttempt.create.mock.calls[0][0];
      const dataKeys = Object.keys(createCall.data);
      expect(dataKeys).not.toContain('authorization');
      expect(dataKeys).not.toContain('rawToken');
      expect(dataKeys).not.toContain('bearerToken');
      expect(dataKeys).not.toContain('webhookSecret');
    });
  });

  describe('startAttempt', () => {
    it('creates an in-progress attempt with UNKNOWN_ERROR outcome', async () => {
      prisma.webhookAttempt.create.mockResolvedValue({
        id: 'att-3',
        receivedAt: new Date('2026-01-01T00:00:00Z'),
      });

      const result = await service.startAttempt(
        'steadfast',
        '/api/webhooks/courier/steadfast',
        'corr-1',
        '1.2.3.4',
      );

      expect(result.id).toBe('att-3');
      expect(prisma.webhookAttempt.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          courier: 'steadfast',
          path: '/api/webhooks/courier/steadfast',
          correlationId: 'corr-1',
          sourceIp: '1.2.3.4',
          outcome: WebhookAttemptOutcome.UNKNOWN_ERROR,
        }),
      });
    });
  });

  describe('completeAttempt', () => {
    it('updates the attempt with final outcome', async () => {
      prisma.webhookAttempt.update.mockResolvedValue({});

      await service.completeAttempt('att-3', {
        responseStatus: 200,
        outcome: WebhookAttemptOutcome.SUCCESS,
        message: 'Status updated',
        durationMs: 45,
      });

      expect(prisma.webhookAttempt.update).toHaveBeenCalledWith({
        where: { id: 'att-3' },
        data: expect.objectContaining({
          responseStatus: 200,
          outcome: WebhookAttemptOutcome.SUCCESS,
          message: 'Status updated',
          durationMs: 45,
          completedAt: expect.any(Date),
        }),
      });
    });
  });

  describe('getSummary', () => {
    it('returns summary with last received, success, failure', async () => {
      prisma.webhookAttempt.findFirst
        .mockResolvedValueOnce({ receivedAt: new Date(), responseStatus: 200 })
        .mockResolvedValueOnce({ receivedAt: new Date() })
        .mockResolvedValueOnce({ receivedAt: new Date(), outcome: 'AUTH_FAILED', message: 'Token mismatch', responseStatus: 401 });

      const summary = await service.getSummary('steadfast');

      expect(summary.lastReceivedAt).toBeDefined();
      expect(summary.lastSuccessAt).toBeDefined();
      expect(summary.lastFailureAt).toBeDefined();
      expect(summary.lastHttpStatus).toBe(200);
      expect(summary.lastFailureReason).toContain('AUTH_FAILED');
      expect(summary.lastFailureReason).toContain('Token mismatch');
    });
  });

  describe('getRecentAttempts', () => {
    it('returns recent attempts for a courier', async () => {
      prisma.webhookAttempt.findMany.mockResolvedValue([
        { id: '1', outcome: 'SUCCESS' },
        { id: '2', outcome: 'AUTH_FAILED' },
      ]);

      const result = await service.getRecentAttempts('steadfast', { limit: 10 });

      expect(result).toHaveLength(2);
      expect(prisma.webhookAttempt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { courier: 'steadfast' },
          take: 10,
        }),
      );
    });

    it('caps limit at 50', async () => {
      prisma.webhookAttempt.findMany.mockResolvedValue([]);

      await service.getRecentAttempts('pathao', { limit: 100 });

      expect(prisma.webhookAttempt.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50 }),
      );
    });
  });

  describe('getAttemptDetail', () => {
    it('returns full attempt details', async () => {
      prisma.webhookAttempt.findUnique.mockResolvedValue({
        id: 'att-1',
        courier: 'steadfast',
        outcome: 'SUCCESS',
      });

      const result = await service.getAttemptDetail('att-1');

      expect(result).toBeDefined();
      expect(prisma.webhookAttempt.findUnique).toHaveBeenCalledWith({
        where: { id: 'att-1' },
        select: expect.any(Object),
      });
    });
  });

  describe('cleanupOldAttempts', () => {
    it('deletes attempts older than 30 days', async () => {
      prisma.webhookAttempt.deleteMany.mockResolvedValue({ count: 42 });

      const count = await service.cleanupOldAttempts();

      expect(count).toBe(42);
      expect(prisma.webhookAttempt.deleteMany).toHaveBeenCalledWith({
        where: { receivedAt: { lt: expect.any(Date) } },
      });
    });
  });
});
