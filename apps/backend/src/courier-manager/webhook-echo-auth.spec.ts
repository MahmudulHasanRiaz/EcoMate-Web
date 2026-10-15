import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException, NotFoundException } from '@nestjs/common';
import { CourierWebhookController } from './courier-webhook.controller';
import { CourierWebhookService } from './courier-webhook.service';
import { WebhookAttemptService } from './webhook-attempt.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookRateLimitCaptureMiddleware } from './webhook-rate-limit-capture.middleware';
import type { FastifyRequest } from 'fastify';

/**
 * Security blockers: echo headers must be set ONLY after auth passes
 * (MATCHED or UNCONFIGURED), never on FAILED/MISMATCH/MISSING.
 * Error paths (401) must carry NO secret headers.
 */
describe('Webhook echo-auth security blockers (TDD RED)', () => {
  let controller: CourierWebhookController;
  let webhookSvc: any;
  let attemptSvc: any;
  let prisma: any;

  const CARRYBEE_SECRET = 'cb-live-secret-abc123';
  const PATHAO_SECRET = 'pathao-registered-V';
  const PATHAO_CUSTOM_ECHO = 'pathao-custom-integration-xyz';

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
    prisma = { courierCredentials: { findUnique: jest.fn() } };

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

  function makeReq(
    courier: string,
    headers: Record<string, string> = {},
    opts: { query?: Record<string, string>; url?: string } = {},
  ): FastifyRequest {
    return {
      headers,
      url: opts.url ?? `/api/webhooks/courier/${courier}`,
      query: opts.query ?? {},
      ip: '9.9.9.9',
      method: 'POST',
      socket: { remoteAddress: '9.9.9.9' },
    } as unknown as FastifyRequest;
  }

  function makeRes() {
    const res: any = {
      header: jest.fn(),
      status: jest.fn((c: number) => {
        res.statusCode = c;
        return res;
      }),
      statusCode: 200,
    };
    return res;
  }

  describe('Carrybee HIGH: X-CB echo must not leak to unauthenticated callers', () => {
    beforeEach(() => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: CARRYBEE_SECRET });
    });

    it('anon POST with no signature → 401 AND no secret echo header', async () => {
      const res = makeRes();
      await expect(
        controller.carrybee({ event: 'order.delivered' }, makeReq('carrybee', {}), res),
      ).rejects.toThrow(UnauthorizedException);
      expect(webhookSvc.handleCarrybee).not.toHaveBeenCalled();
      expect(res.header).not.toHaveBeenCalledWith(
        'X-CB-Webhook-Integration-Header',
        expect.anything(),
      );
      for (const call of res.header.mock.calls) {
        expect(String(call[1] ?? '')).not.toContain(CARRYBEE_SECRET);
      }
    });

    it('anon POST with invalid signature → 401 AND no secret echo header', async () => {
      const res = makeRes();
      await expect(
        controller.carrybee(
          { event: 'order.delivered' },
          makeReq('carrybee', { 'x-carrybee-webhook-signature': 'wrong' }),
          res,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(webhookSvc.handleCarrybee).not.toHaveBeenCalled();
      expect(res.header).not.toHaveBeenCalledWith(
        'X-CB-Webhook-Integration-Header',
        expect.anything(),
      );
      for (const call of res.header.mock.calls) {
        expect(String(call[1] ?? '')).not.toContain(CARRYBEE_SECRET);
      }
    });

    it('legit sender → echo present + 202', async () => {
      const res = makeRes();
      const result = await controller.carrybee(
        { event: 'order.delivered' },
        makeReq('carrybee', { 'x-carrybee-webhook-signature': CARRYBEE_SECRET }),
        res,
      );
      expect(result).toEqual({ status: 'success', message: 'ok' });
      expect(res.header).toHaveBeenCalledWith('X-CB-Webhook-Integration-Header', CARRYBEE_SECRET);
      expect(res.status).toHaveBeenCalledWith(202);
    });
  });

  describe('Pathao MEDIUM: integration-secret echo only after auth', () => {
    beforeEach(() => {
      prisma.courierCredentials.findUnique.mockResolvedValue({
        webhookSecret: PATHAO_SECRET,
        pathaoIntegrationSecret: PATHAO_CUSTOM_ECHO,
      });
    });

    it('anon POST with no signature → 401 AND no secret echo header', async () => {
      const res = makeRes();
      await expect(
        controller.pathao({ event: 'order.delivered' }, makeReq('pathao', {}), res),
      ).rejects.toThrow(UnauthorizedException);
      expect(webhookSvc.handlePathao).not.toHaveBeenCalled();
      for (const call of res.header.mock.calls) {
        expect(String(call[1] ?? '')).not.toContain(PATHAO_CUSTOM_ECHO);
        expect(String(call[1] ?? '')).not.toContain(PATHAO_SECRET);
      }
      expect(res.header).not.toHaveBeenCalledWith(
        'X-Pathao-Merchant-Webhook-Integration-Secret',
        PATHAO_CUSTOM_ECHO,
      );
    });

    it('anon POST with invalid signature → 401 AND no secret echo header', async () => {
      const res = makeRes();
      await expect(
        controller.pathao(
          { event: 'order.delivered' },
          makeReq('pathao', { 'x-pathao-signature': 'wrong' }),
          res,
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(webhookSvc.handlePathao).not.toHaveBeenCalled();
      for (const call of res.header.mock.calls) {
        expect(String(call[1] ?? '')).not.toContain(PATHAO_CUSTOM_ECHO);
      }
    });

    it('legit sender → echo present + 202', async () => {
      const res = makeRes();
      const result = await controller.pathao(
        { event: 'order.delivered' },
        makeReq('pathao', { 'x-pathao-signature': PATHAO_SECRET }),
        res,
      );
      expect(result).toEqual({ status: 'success', message: 'ok' });
      expect(res.header).toHaveBeenCalledWith(
        'X-Pathao-Merchant-Webhook-Integration-Secret',
        PATHAO_CUSTOM_ECHO,
      );
      expect(res.status).toHaveBeenCalledWith(202);
    });
  });

  describe('LOW: rate-limit capture strips ?token= before storing', () => {
    it('RedX 429 path stores stripped path without query/token', async () => {
      const prismaMock: any = { webhookAttempt: { create: jest.fn().mockResolvedValue({}) } };
      const mw = new WebhookRateLimitCaptureMiddleware(prismaMock);
      let finishCb: (() => void) | null = null;
      const req: any = {
        url: '/api/webhooks/courier/redx?token=SECRET123',
        method: 'POST',
        headers: {},
        ip: '5.5.5.5',
        socket: { remoteAddress: '5.5.5.5' },
      };
      const reply: any = {
        statusCode: 429,
        raw: { on: jest.fn((ev: string, cb: () => void) => { if (ev === 'finish') finishCb = cb; }) },
      };
      const next = jest.fn();
      mw.use(req, reply, next);
      expect(next).toHaveBeenCalled();
      expect(finishCb).not.toBeNull();
      finishCb!();
      await new Promise((r) => setTimeout(r, 20));
      expect(prismaMock.webhookAttempt.create).toHaveBeenCalled();
      const storedPath = prismaMock.webhookAttempt.create.mock.calls[0][0].data.path as string;
      expect(storedPath).not.toContain('SECRET123');
      expect(storedPath).not.toContain('token=');
      expect(storedPath).not.toContain('?');
      expect(storedPath).toBe('/api/webhooks/courier/redx');
    });
  });

  describe('404-race: behavior unchanged (404 + loud log)', () => {
    it('unknown order → 404 ORDER_NOT_FOUND (no retry; steadfast explicit, others assumed)', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: 's-token-xyz' });
      const rawBody = '{"consignment_id":"CG-404"}';
      const sig = require('node:crypto')
        .createHmac('sha256', 's-token-xyz')
        .update(rawBody, 'utf8')
        .digest('hex');
      webhookSvc.handleSteadfast.mockRejectedValue(new NotFoundException('Order not found'));
      await expect(
        controller.steadfast(
          { consignment_id: 'CG-404' },
          {
            headers: { 'x-signature': sig },
            url: '/api/webhooks/courier/steadfast',
            ip: '1.2.3.4',
            method: 'POST',
            socket: { remoteAddress: '1.2.3.4' },
            rawBody,
          } as unknown as FastifyRequest,
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ outcome: 'ORDER_NOT_FOUND', responseStatus: 404 }),
      );
    });
  });
});
