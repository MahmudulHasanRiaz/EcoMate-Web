import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { CourierWebhookController } from './courier-webhook.controller';
import { CourierWebhookService } from './courier-webhook.service';
import { WebhookAttemptService } from './webhook-attempt.service';
import { PrismaService } from '../prisma/prisma.service';
import type { FastifyRequest } from 'fastify';

describe('CourierWebhookController — Diagnostics', () => {
  let controller: CourierWebhookController;
  let webhookSvc: any;
  let attemptSvc: any;
  let prisma: any;

  beforeEach(async () => {
    webhookSvc = {
      handleSteadfast: jest.fn().mockResolvedValue({ status: 'success', message: 'ok' }),
      handlePathao: jest.fn().mockResolvedValue({ status: 'success', message: 'ok' }),
      handleRedx: jest.fn().mockResolvedValue({ status: 'success', message: 'ok' }),
      handleCarrybee: jest.fn().mockResolvedValue({ status: 'success', message: 'ok' }),
    };

    attemptSvc = {
      startAttempt: jest.fn().mockResolvedValue({ id: 'att-1', receivedAt: new Date() }),
      completeAttempt: jest.fn().mockResolvedValue(undefined),
      logAttempt: jest.fn().mockResolvedValue('att-1'),
    };

    prisma = {
      courierCredentials: {
        findUnique: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CourierWebhookController],
      providers: [
        { provide: CourierWebhookService, useValue: webhookSvc },
        { provide: WebhookAttemptService, useValue: attemptSvc },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    controller = module.get<CourierWebhookController>(CourierWebhookController);
  });

  function makeReq(headers: Record<string, string> = {}, ip = '1.2.3.4'): FastifyRequest {
    return {
      headers,
      url: '/api/webhooks/courier/steadfast',
      ip,
      method: 'POST',
      socket: { remoteAddress: ip },
    } as unknown as FastifyRequest;
  }

  function makeRes() {
    const headers: Record<string, string> = {};
    const res = {
      header: jest.fn((k: string, v: string) => { headers[k] = v; }),
      status: jest.fn((c: number) => { res.statusCode = c; return res; }),
      statusCode: 200,
      raw: { on: jest.fn() },
    } as any;
    return res;
  }

  describe('Steadfast — auth diagnostics', () => {
    it('records AUTH_HEADER_MISSING when no Authorization header', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue(null);

      await expect(
        controller.steadfast({ consignment_id: 'CG-1' }, makeReq({}), makeRes()),
      ).rejects.toThrow(UnauthorizedException);

      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        'att-1',
        expect.objectContaining({
          outcome: 'AUTH_HEADER_MISSING',
          failureStage: 'AUTH',
        }),
      );
    });

    it('records AUTH_FORMAT_INVALID for non-Bearer scheme', async () => {
      await expect(
        controller.steadfast({ consignment_id: 'CG-1' }, makeReq({ authorization: 'Basic abc' }), makeRes()),
      ).rejects.toThrow(UnauthorizedException);

      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        'att-1',
        expect.objectContaining({
          outcome: 'AUTH_FORMAT_INVALID',
          failureStage: 'AUTH',
        }),
      );
    });

    it('records AUTH_FAILED when token mismatch', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: 'correct-token' });

      await expect(
        controller.steadfast(
          { consignment_id: 'CG-1' },
          makeReq({ authorization: 'Bearer wrong-token' }),
          makeRes(),
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        'att-1',
        expect.objectContaining({
          outcome: 'AUTH_FAILED',
          failureStage: 'AUTH',
          authResult: expect.stringContaining('Token fingerprint'),
        }),
      );
    });

    it('records SUCCESS with correlation ID on valid webhook', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: 'my-secret' });

      await controller.steadfast(
        { consignment_id: 'CG-1', notification_type: 'status_change', status: 'delivered' },
        makeReq({ authorization: 'Bearer my-secret' }),
        makeRes(),
      );

      expect(webhookSvc.handleSteadfast).toHaveBeenCalled();

      // First call records auth success, second call records final outcome
      const allCalls = attemptSvc.completeAttempt.mock.calls;
      const finalCall = allCalls[allCalls.length - 1];
      expect(finalCall[0]).toBe('att-1');
      expect(finalCall[1]).toEqual(expect.objectContaining({
        outcome: 'SUCCESS',
        responseStatus: 200,
      }));
    });

    it('records PROCESSING_ERROR when handler throws', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: 'my-secret' });
      webhookSvc.handleSteadfast.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        controller.steadfast(
          { consignment_id: 'CG-1' },
          makeReq({ authorization: 'Bearer my-secret' }),
          makeRes(),
        ),
      ).rejects.toThrow('DB connection lost');

      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        'att-1',
        expect.objectContaining({
          outcome: 'PROCESSING_ERROR',
          failureStage: 'PROCESSING',
          message: 'DB connection lost',
        }),
      );
    });

    it('never stores raw token in authResult', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: 'super-secret-token-123' });

      await controller.steadfast(
        { consignment_id: 'CG-1', notification_type: 'status_change', status: 'delivered' },
        makeReq({ authorization: 'Bearer super-secret-token-123' }),
        makeRes(),
      );

      const allCalls = attemptSvc.completeAttempt.mock.calls;
      for (const call of allCalls) {
        const data = call[1];
        if (data.authResult) {
          expect(data.authResult).not.toContain('super-secret-token-123');
        }
        if (data.message) {
          expect(data.message).not.toContain('super-secret-token-123');
        }
      }
    });
  });

  describe('RedX — HMAC auth diagnostics', () => {
    it('records AUTH_FAILED for invalid HMAC signature', async () => {
      process.env.REDX_WEBHOOK_SECRET = 'redx-secret';

      await expect(
        controller.redx(
          { tracking_number: 'TN-1', status: 'delivered' },
          makeReq({ 'x-redx-signature': 'invalid-sig' }),
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        'att-1',
        expect.objectContaining({
          outcome: 'AUTH_FAILED',
          failureStage: 'AUTH',
        }),
      );
    });
  });

  describe('Pathao — signature + integration-secret response header', () => {
    it('accepts the registered pathaoIntegrationSecret when webhookSecret is not set', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({
        webhookSecret: null,
        pathaoIntegrationSecret: 'f3992ecc-59da-4cbe-a049-a13da2018d51',
      });
      webhookSvc.handlePathao.mockResolvedValue({ status: 'success', message: 'ok' });

      const result = await controller.pathao(
        { event: 'order.delivered', consignment_id: 'P-CG-1' },
        makeReq({ 'x-pathao-signature': 'f3992ecc-59da-4cbe-a049-a13da2018d51' }, '2.2.2.2'),
        makeRes(),
      );

      expect(result).toEqual({ status: 'success', message: 'ok' });
      expect(webhookSvc.handlePathao).toHaveBeenCalled();
      const finalCall = attemptSvc.completeAttempt.mock.calls[attemptSvc.completeAttempt.mock.calls.length - 1];
      expect(finalCall[1]).toEqual(expect.objectContaining({ outcome: 'SUCCESS' }));
    });

    it('echoes the integration secret back in the required response header', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({
        webhookSecret: 'wh-secret',
        pathaoIntegrationSecret: 'f3992ecc-59da-4cbe-a049-a13da2018d51',
      });

      const res = makeRes();
      await controller.pathao(
        { event: 'order.updated', consignment_id: 'P-CG-2' },
        makeReq({ 'x-pathao-signature': 'f3992ecc-59da-4cbe-a049-a13da2018d51' }),
        res,
      );

      expect(res.header).toHaveBeenCalledWith(
        'X-Pathao-Merchant-Webhook-Integration-Secret',
        'f3992ecc-59da-4cbe-a049-a13da2018d51',
      );
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('rejects with AUTH_FAILED when neither secret is configured', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({
        webhookSecret: null,
        pathaoIntegrationSecret: null,
      });

      await expect(
        controller.pathao(
          { event: 'order.delivered' },
          makeReq({ 'x-pathao-signature': 'anything' }),
          makeRes(),
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        'att-1',
        expect.objectContaining({
          outcome: 'AUTH_FAILED',
          failureStage: 'AUTH',
          authResult: expect.stringContaining('Pathao webhook secret not configured'),
        }),
      );
    });
  });

  describe('Correlation ID', () => {
    it('generates unique correlation ID per request', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: 'secret' });

      await controller.steadfast(
        { consignment_id: 'CG-1', notification_type: 'status_change', status: 'delivered' },
        makeReq({ authorization: 'Bearer secret' }),
        makeRes(),
      );

      const startCall = attemptSvc.startAttempt.mock.calls[0];
      expect(startCall[2]).toBeDefined(); // correlationId
      expect(typeof startCall[2]).toBe('string');
      expect(startCall[2].length).toBeGreaterThan(0);
    });
  });

  describe('Best-effort diagnostics', () => {
    it('diagnostic DB failure does not break webhook processing', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: 'secret' });
      attemptSvc.startAttempt.mockRejectedValue(new Error('DB down'));
      webhookSvc.handleSteadfast.mockResolvedValue({ status: 'success', message: 'ok' });

      // Should still succeed despite diagnostic logging failure
      const result = await controller.steadfast(
        { consignment_id: 'CG-1', notification_type: 'status_change', status: 'delivered' },
        makeReq({ authorization: 'Bearer secret' }),
        makeRes(),
      );

      expect(result).toEqual({ status: 'success', message: 'ok' });
      expect(webhookSvc.handleSteadfast).toHaveBeenCalled();
    });

    it('completeAttempt failure does not cause 500 when handler succeeds', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: 'secret' });
      attemptSvc.completeAttempt.mockRejectedValue(new Error('DB write failed'));

      const result = await controller.steadfast(
        { consignment_id: 'CG-1', notification_type: 'status_change', status: 'delivered' },
        makeReq({ authorization: 'Bearer secret' }),
        makeRes(),
      );

      expect(result).toEqual({ status: 'success', message: 'ok' });
    });
  });
});
