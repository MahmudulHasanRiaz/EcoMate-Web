import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import * as crypto from 'node:crypto';
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

  function makeReq(headers: Record<string, string> = {}, ip = '1.2.3.4', rawBody?: string): FastifyRequest {
    return {
      headers,
      url: '/api/webhooks/courier/steadfast',
      ip,
      method: 'POST',
      socket: { remoteAddress: ip },
      rawBody,
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

  // Task 4: Steadfast authenticates by HMAC-SHA256(raw body) vs X-Signature.
  // Bearer alone is NOT a fallback once a token is configured.
  const STEADFAST_TOKEN = 'steadfast-token-task4';
  const signSteadfast = (rawBody: string, secret: string = STEADFAST_TOKEN) =>
    crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  function steadfastReq(
    headers: Record<string, string>,
    rawBody = '{"status":"delivered","consignment_id":12345}',
  ) {
    return makeReq(headers, '1.2.3.4', rawBody);
  }

  describe('Steadfast — HMAC auth diagnostics (Task 4)', () => {
    it('records AUTH_FAILED when no X-Signature header (Bearer alone is not a fallback)', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: STEADFAST_TOKEN });

      await expect(
        controller.steadfast(
          { consignment_id: 'CG-1' },
          steadfastReq({ authorization: `Bearer ${STEADFAST_TOKEN}` }),
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

    it('records AUTH_FAILED when HMAC does not match', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: STEADFAST_TOKEN });

      await expect(
        controller.steadfast(
          { consignment_id: 'CG-1' },
          steadfastReq({ 'x-signature': '0'.repeat(64) }),
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        'att-1',
        expect.objectContaining({
          outcome: 'AUTH_FAILED',
          failureStage: 'AUTH',
        }),
      );
      expect(webhookSvc.handleSteadfast).not.toHaveBeenCalled();
    });

    it('records SUCCESS with correlation ID on valid HMAC webhook', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: STEADFAST_TOKEN });
      const rawBody = '{"status":"delivered","consignment_id":12345}';

      await controller.steadfast(
        { consignment_id: 12345, status: 'delivered' },
        steadfastReq({ 'x-signature': signSteadfast(rawBody) }, rawBody),
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

    it('records PROCESSING_ERROR when handler throws a transient error', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: STEADFAST_TOKEN });
      webhookSvc.handleSteadfast.mockRejectedValue(new Error('DB connection lost'));
      const rawBody = '{"consignment_id":"CG-1"}';

      await expect(
        controller.steadfast(
          { consignment_id: 'CG-1' },
          steadfastReq({ 'x-signature': signSteadfast(rawBody) }, rawBody),
        ),
      ).rejects.toThrow('Webhook processing failed');

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
      const rawBody = '{"consignment_id":"CG-1"}';

      await controller.steadfast(
        { consignment_id: 'CG-1' },
        steadfastReq(
          { 'x-signature': signSteadfast(rawBody, 'super-secret-token-123') },
          rawBody,
        ),
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

    it('accepts with a recorded warning when no token is configured', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue(null);

      const result = await controller.steadfast(
        { consignment_id: 'CG-1' },
        steadfastReq({}),
      );

      expect(result).toEqual({ status: 'success', message: 'ok' });
      expect(webhookSvc.handleSteadfast).toHaveBeenCalled();
      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        'att-1',
        expect.objectContaining({
          outcome: 'SUCCESS',
          authResult: expect.stringMatching(/not configured/i),
        }),
      );
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
    it('accepts the merchant-registered webhook secret as the inbound signature', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({
        webhookSecret: 'registered-secret-V',
        pathaoIntegrationSecret: 'f3992ecc-59da-4cbe-a049-a13da2018d51',
      });
      webhookSvc.handlePathao.mockResolvedValue({ status: 'success', message: 'ok' });

      const result = await controller.pathao(
        { event: 'order.delivered', consignment_id: 'P-CG-1' },
        makeReq({ 'x-pathao-signature': 'registered-secret-V' }, '2.2.2.2'),
        makeRes(),
      );

      expect(result).toEqual({ status: 'success', message: 'ok' });
      expect(webhookSvc.handlePathao).toHaveBeenCalled();
      const finalCall = attemptSvc.completeAttempt.mock.calls[attemptSvc.completeAttempt.mock.calls.length - 1];
      expect(finalCall[1]).toEqual(expect.objectContaining({ outcome: 'SUCCESS' }));
    });

    it('does NOT accept the public integration constant as the inbound signature (anti-forgery)', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({
        webhookSecret: 'registered-secret-V',
        pathaoIntegrationSecret: 'f3992ecc-59da-4cbe-a049-a13da2018d51',
      });

      await expect(
        controller.pathao(
          { event: 'order.delivered', consignment_id: 'P-CG-1' },
          makeReq({ 'x-pathao-signature': 'f3992ecc-59da-4cbe-a049-a13da2018d51' }),
          makeRes(),
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        'att-1',
        expect.objectContaining({
          outcome: 'AUTH_FAILED',
          failureStage: 'AUTH',
          authResult: expect.stringContaining('Signature does not match the registered webhook secret'),
        }),
      );
    });

    it('accepts with a recorded warning when the registered secret is missing (Task 4: never silent)', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({
        webhookSecret: null,
        pathaoIntegrationSecret: 'f3992ecc-59da-4cbe-a049-a13da2018d51',
      });

      const result = await controller.pathao(
        { event: 'order.delivered' },
        makeReq({ 'x-pathao-signature': 'anything' }),
        makeRes(),
      );

      expect(result).toEqual({ status: 'success', message: 'ok' });
      expect(webhookSvc.handlePathao).toHaveBeenCalled();
      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        'att-1',
        expect.objectContaining({
          outcome: 'SUCCESS',
          authResult: expect.stringMatching(/not configured/i),
        }),
      );
    });

    it('echoes the stored integration secret in the required response header', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({
        webhookSecret: 'wh-secret',
        pathaoIntegrationSecret: 'f3992ecc-59da-4cbe-a049-a13da2018d51',
      });

      const res = makeRes();
      await controller.pathao(
        { event: 'order.updated', consignment_id: 'P-CG-2' },
        makeReq({ 'x-pathao-signature': 'wh-secret' }),
        res,
      );

      expect(res.header).toHaveBeenCalledWith(
        'X-Pathao-Merchant-Webhook-Integration-Secret',
        'f3992ecc-59da-4cbe-a049-a13da2018d51',
      );
      expect(res.status).toHaveBeenCalledWith(202);
    });

    it('echoes the built-in constant when no integration secret is stored', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({
        webhookSecret: 'wh-secret',
        pathaoIntegrationSecret: null,
      });

      const res = makeRes();
      await controller.pathao(
        { event: 'order.picked', consignment_id: 'P-CG-3' },
        makeReq({ 'x-pathao-signature': 'wh-secret' }),
        res,
      );

      expect(res.header).toHaveBeenCalledWith(
        'X-Pathao-Merchant-Webhook-Integration-Secret',
        'f3992ecc-59da-4cbe-a049-a13da2018d51',
      );
    });

    it('accepts with a recorded warning when neither secret is configured', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({
        webhookSecret: null,
        pathaoIntegrationSecret: null,
      });

      const result = await controller.pathao(
        { event: 'order.delivered' },
        makeReq({ 'x-pathao-signature': 'anything' }),
        makeRes(),
      );

      expect(result).toEqual({ status: 'success', message: 'ok' });
      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        'att-1',
        expect.objectContaining({
          outcome: 'SUCCESS',
          authResult: expect.stringMatching(/not configured/i),
        }),
      );
    });
  });

  describe('Correlation ID', () => {
    it('generates unique correlation ID per request', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: STEADFAST_TOKEN });
      const rawBody = '{"consignment_id":"CG-1"}';

      await controller.steadfast(
        { consignment_id: 'CG-1' },
        steadfastReq({ 'x-signature': signSteadfast(rawBody) }, rawBody),
      );

      const startCall = attemptSvc.startAttempt.mock.calls[0];
      expect(startCall[2]).toBeDefined(); // correlationId
      expect(typeof startCall[2]).toBe('string');
      expect(startCall[2].length).toBeGreaterThan(0);
    });
  });

  describe('Best-effort diagnostics', () => {
    it('diagnostic DB failure does not break webhook processing', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: STEADFAST_TOKEN });
      attemptSvc.startAttempt.mockRejectedValue(new Error('DB down'));
      webhookSvc.handleSteadfast.mockResolvedValue({ status: 'success', message: 'ok' });
      const rawBody = '{"consignment_id":"CG-1"}';

      // Should still succeed despite diagnostic logging failure
      const result = await controller.steadfast(
        { consignment_id: 'CG-1' },
        steadfastReq({ 'x-signature': signSteadfast(rawBody) }, rawBody),
      );

      expect(result).toEqual({ status: 'success', message: 'ok' });
      expect(webhookSvc.handleSteadfast).toHaveBeenCalled();
    });

    it('completeAttempt failure does not cause 500 when handler succeeds', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: STEADFAST_TOKEN });
      attemptSvc.completeAttempt.mockRejectedValue(new Error('DB write failed'));
      const rawBody = '{"consignment_id":"CG-1"}';

      const result = await controller.steadfast(
        { consignment_id: 'CG-1' },
        steadfastReq({ 'x-signature': signSteadfast(rawBody) }, rawBody),
      );

      expect(result).toEqual({ status: 'success', message: 'ok' });
    });
  });
});
