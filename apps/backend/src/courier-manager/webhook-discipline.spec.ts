import * as crypto from 'node:crypto';
import {
  BadRequestException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { CourierWebhookController } from './courier-webhook.controller';
import { CourierWebhookService } from './courier-webhook.service';
import { WebhookAttemptService } from './webhook-attempt.service';
import { PrismaService } from '../prisma/prisma.service';
import { Test, TestingModule } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';

/**
 * Task 4 RED tests: webhook HMAC + idempotency + status discipline, all couriers.
 * - bad sig → 401, handler never runs
 * - dup Idempotency-Key → 2xx, handler runs exactly once
 * - malformed → 4xx (400), unknown order → 404
 * - no token configured → ACCEPT + warning recorded (never silent)
 * - token present + fail → 401, never fallback-accept
 */
describe('CourierWebhookController — Task 4 discipline', () => {
  let controller: CourierWebhookController;
  let webhookSvc: any;
  let attemptSvc: any;
  let prisma: any;
  let savedRedxEnv: string | undefined;

  const STEADFAST_TOKEN = 'steadfast-auth-token-xyz';
  const PATHAO_SECRET = 'pathao-registered-secret-V';
  const REDX_SECRET = 'redx-webhook-secret-789';
  const CARRYBEE_SECRET = 'carrybee-webhook-secret-456';

  function hmac(rawBody: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  }

  beforeEach(async () => {
    savedRedxEnv = process.env['REDX_WEBHOOK_SECRET'];
    delete process.env['REDX_WEBHOOK_SECRET'];

    webhookSvc = {
      handleSteadfast: jest.fn().mockResolvedValue({ status: 'success', message: 'ok' }),
      handlePathao: jest.fn().mockResolvedValue({ status: 'success', message: 'ok' }),
      handleRedx: jest.fn().mockResolvedValue({ status: 'success', message: 'ok' }),
      handleCarrybee: jest.fn().mockResolvedValue({ status: 'success', message: 'ok' }),
    };
    attemptSvc = {
      startAttempt: jest.fn().mockResolvedValue({ id: 'att-1', receivedAt: new Date() }),
      completeAttempt: jest.fn().mockResolvedValue(undefined),
      logAttempt: jest.fn().mockResolvedValue('dupe-1'),
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

  afterEach(() => {
    if (savedRedxEnv === undefined) delete process.env['REDX_WEBHOOK_SECRET'];
    else process.env['REDX_WEBHOOK_SECRET'] = savedRedxEnv;
  });

  function makeReq(
    courier: string,
    headers: Record<string, string> = {},
    opts: { rawBody?: string; query?: Record<string, string>; url?: string } = {},
  ): FastifyRequest {
    const url = opts.url ?? `/api/webhooks/courier/${courier}`;
    return {
      headers,
      url,
      query: opts.query ?? {},
      ip: '1.2.3.4',
      method: 'POST',
      socket: { remoteAddress: '1.2.3.4' },
      rawBody: opts.rawBody,
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

  function withDupeOnSecondCall() {
    let calls = 0;
    attemptSvc.startAttempt.mockImplementation(() => {
      calls += 1;
      if (calls >= 2) return Promise.reject({ code: 'P2002' });
      return Promise.resolve({ id: `att-${calls}`, receivedAt: new Date() });
    });
  }

  describe('Steadfast — HMAC(X-Signature, raw body)', () => {
    const body = { notification_type: 'delivery_status', consignment_id: 12345, status: 'delivered' };
    // Raw bytes as the courier sent them: key order differs from JSON.stringify(body).
    const rawBody = '{"status":"delivered","consignment_id":12345,"notification_type":"delivery_status"}';

    beforeEach(() => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: STEADFAST_TOKEN });
    });

    it('bad signature → 401, handler never runs', async () => {
      await expect(
        controller.steadfast(body, makeReq('steadfast', { 'x-signature': '0'.repeat(64) }, { rawBody })),
      ).rejects.toThrow(UnauthorizedException);
      expect(webhookSvc.handleSteadfast).not.toHaveBeenCalled();
      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ outcome: 'AUTH_FAILED', responseStatus: 401 }),
      );
    });

    it('valid HMAC over the RAW bytes (not JSON.stringify) → accepted', async () => {
      const result = await controller.steadfast(
        body,
        makeReq('steadfast', { 'x-signature': hmac(rawBody, STEADFAST_TOKEN) }, { rawBody }),
      );
      expect(result).toEqual({ status: 'success', message: 'ok' });
      expect(webhookSvc.handleSteadfast).toHaveBeenCalledWith(body);
    });

    it('Bearer-only with token configured → 401 (no Bearer fallback)', async () => {
      await expect(
        controller.steadfast(
          body,
          makeReq('steadfast', { authorization: `Bearer ${STEADFAST_TOKEN}` }, { rawBody }),
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(webhookSvc.handleSteadfast).not.toHaveBeenCalled();
    });

    it('dup Idempotency-Key → 2xx, handler runs exactly once', async () => {
      withDupeOnSecondCall();
      const headers = {
        'x-signature': hmac(rawBody, STEADFAST_TOKEN),
        'idempotency-key': 'evt-111',
      };
      const first = await controller.steadfast(body, makeReq('steadfast', headers, { rawBody }));
      expect(first).toEqual({ status: 'success', message: 'ok' });
      const second = await controller.steadfast(body, makeReq('steadfast', headers, { rawBody }));
      expect(second).toEqual(
        expect.objectContaining({ status: 'success', duplicate: true }),
      );
      expect(webhookSvc.handleSteadfast).toHaveBeenCalledTimes(1);
      expect(attemptSvc.logAttempt).toHaveBeenCalledWith(
        expect.objectContaining({ isDuplicate: true, responseStatus: 200 }),
      );
    });

    it('malformed payload → 400 PAYLOAD_INVALID (never 500/200)', async () => {
      webhookSvc.handleSteadfast.mockRejectedValue(new BadRequestException('Missing consignment_id'));
      await expect(
        controller.steadfast({}, makeReq('steadfast', { 'x-signature': hmac('{}', STEADFAST_TOKEN) }, { rawBody: '{}' })),
      ).rejects.toMatchObject({ status: 400 });
      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ outcome: 'PAYLOAD_INVALID', responseStatus: 400 }),
      );
    });

    it('unknown order → 404 ORDER_NOT_FOUND (Steadfast never retries 4xx)', async () => {
      webhookSvc.handleSteadfast.mockRejectedValue(new NotFoundException('Order not found'));
      await expect(
        controller.steadfast(body, makeReq('steadfast', { 'x-signature': hmac(rawBody, STEADFAST_TOKEN) }, { rawBody })),
      ).rejects.toMatchObject({ status: 404 });
      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ outcome: 'ORDER_NOT_FOUND', responseStatus: 404 }),
      );
    });

    it('transient DB failure → 500 PROCESSING_ERROR (5xx only here)', async () => {
      webhookSvc.handleSteadfast.mockRejectedValue(new Error('connect ECONNREFUSED'));
      await expect(
        controller.steadfast(body, makeReq('steadfast', { 'x-signature': hmac(rawBody, STEADFAST_TOKEN) }, { rawBody })),
      ).rejects.toMatchObject({ status: 500 });
      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ outcome: 'PROCESSING_ERROR', responseStatus: 500 }),
      );
    });

    it('no token configured → ACCEPT + warning recorded (never silent)', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue(null);
      const result = await controller.steadfast(body, makeReq('steadfast', {}, { rawBody }));
      expect(result).toEqual({ status: 'success', message: 'ok' });
      expect(webhookSvc.handleSteadfast).toHaveBeenCalled();
      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ outcome: 'SUCCESS', authResult: expect.stringMatching(/not configured/i) }),
      );
    });
  });

  describe('Pathao — verbatim secret + discipline', () => {
    const body = { event: 'order.delivered', consignment_id: 'P-1' };

    beforeEach(() => {
      prisma.courierCredentials.findUnique.mockResolvedValue({
        webhookSecret: PATHAO_SECRET,
        pathaoIntegrationSecret: null,
      });
    });

    it('bad signature → 401, handler never runs', async () => {
      await expect(
        controller.pathao(body, makeReq('pathao', { 'x-pathao-signature': 'wrong' }), makeRes()),
      ).rejects.toThrow(UnauthorizedException);
      expect(webhookSvc.handlePathao).not.toHaveBeenCalled();
    });

    it('dup Idempotency-Key → 202 no reprocess', async () => {
      withDupeOnSecondCall();
      const headers = { 'x-pathao-signature': PATHAO_SECRET, 'idempotency-key': 'p-evt-1' };
      await controller.pathao(body, makeReq('pathao', headers), makeRes());
      const res = makeRes();
      const second = await controller.pathao(body, makeReq('pathao', headers), res);
      expect(second).toEqual(expect.objectContaining({ duplicate: true }));
      expect(res.status).toHaveBeenCalledWith(202);
      expect(webhookSvc.handlePathao).toHaveBeenCalledTimes(1);
    });

    it('malformed → 400; unknown order → 404', async () => {
      webhookSvc.handlePathao.mockRejectedValue(new BadRequestException('Missing consignment_id'));
      await expect(
        controller.pathao({}, makeReq('pathao', { 'x-pathao-signature': PATHAO_SECRET }), makeRes()),
      ).rejects.toMatchObject({ status: 400 });
      webhookSvc.handlePathao.mockRejectedValue(new NotFoundException('Order not found'));
      await expect(
        controller.pathao(body, makeReq('pathao', { 'x-pathao-signature': PATHAO_SECRET }), makeRes()),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('no secret configured → ACCEPT + warning recorded', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: null });
      const result = await controller.pathao(body, makeReq('pathao', {}), makeRes());
      expect(result).toEqual({ status: 'success', message: 'ok' });
      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ outcome: 'SUCCESS', authResult: expect.stringMatching(/not configured/i) }),
      );
    });
  });

  describe('RedX — dual: HMAC header else ?token=', () => {
    const body = { tracking_number: 'RX-1', status: 'delivered' };
    const rawBody = '{"status":"delivered","tracking_number":"RX-1"}';

    beforeEach(() => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: REDX_SECRET });
    });

    it('bad HMAC → 401 even though the body parses', async () => {
      await expect(
        controller.redx(body, makeReq('redx', { 'x-redx-signature': 'f'.repeat(64) }, { rawBody })),
      ).rejects.toThrow(UnauthorizedException);
      expect(webhookSvc.handleRedx).not.toHaveBeenCalled();
    });

    it('valid HMAC over raw bytes → accepted', async () => {
      const result = await controller.redx(
        body,
        makeReq('redx', { 'x-redx-signature': hmac(rawBody, REDX_SECRET) }, { rawBody }),
      );
      expect(result).toEqual({ status: 'success', message: 'ok' });
    });

    it('valid ?token= with no HMAC header → accepted (doc callback style)', async () => {
      const result = await controller.redx(
        body,
        makeReq('redx', {}, { rawBody, query: { token: REDX_SECRET }, url: '/api/webhooks/courier/redx?token=SECRET' }),
      );
      expect(result).toEqual({ status: 'success', message: 'ok' });
      expect(webhookSvc.handleRedx).toHaveBeenCalled();
    });

    it('wrong ?token= → 401 and the stored path never carries the token', async () => {
      await expect(
        controller.redx(
          body,
          makeReq('redx', {}, { rawBody, query: { token: 'wrong-token' }, url: '/api/webhooks/courier/redx?token=wrong-token' }),
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(webhookSvc.handleRedx).not.toHaveBeenCalled();
      const startPath = attemptSvc.startAttempt.mock.calls[0][1] as string;
      expect(startPath).not.toContain('wrong-token');
      expect(startPath).not.toContain('token=');
    });

    it('dup Idempotency-Key → 2xx no reprocess', async () => {
      withDupeOnSecondCall();
      const headers = { 'x-redx-signature': hmac(rawBody, REDX_SECRET), 'idempotency-key': 'rx-1' };
      await controller.redx(body, makeReq('redx', headers, { rawBody }));
      const second = await controller.redx(body, makeReq('redx', headers, { rawBody }));
      expect(second).toEqual(expect.objectContaining({ duplicate: true }));
      expect(webhookSvc.handleRedx).toHaveBeenCalledTimes(1);
    });

    it('malformed → 400; unknown order → 404', async () => {
      webhookSvc.handleRedx.mockRejectedValue(new BadRequestException('Missing tracking_number'));
      await expect(
        controller.redx({}, makeReq('redx', { 'x-redx-signature': hmac('{}', REDX_SECRET) }, { rawBody: '{}' })),
      ).rejects.toMatchObject({ status: 400 });
      webhookSvc.handleRedx.mockRejectedValue(new NotFoundException('Order not found'));
      await expect(
        controller.redx(body, makeReq('redx', { 'x-redx-signature': hmac(rawBody, REDX_SECRET) }, { rawBody })),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('no secret anywhere → ACCEPT + warning recorded', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue(null);
      const result = await controller.redx(body, makeReq('redx', {}, { rawBody }));
      expect(result).toEqual({ status: 'success', message: 'ok' });
      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ outcome: 'SUCCESS', authResult: expect.stringMatching(/not configured/i) }),
      );
    });
  });

  describe('Carrybee — BOTH header names, verify whichever arrives', () => {
    const body = { event: 'order.delivered', consignment_id: 'CB-1' };

    beforeEach(() => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: CARRYBEE_SECRET });
    });

    it('wrong signature → 401, handler never runs', async () => {
      await expect(
        controller.carrybee(body, makeReq('carrybee', { 'x-carrybee-webhook-signature': 'wrong' }), makeRes()),
      ).rejects.toThrow(UnauthorizedException);
      expect(webhookSvc.handleCarrybee).not.toHaveBeenCalled();
    });

    it('either header alone verifies → 202 accepted', async () => {
      const res1 = makeRes();
      await controller.carrybee(
        body,
        makeReq('carrybee', { 'x-carrybee-webhook-signature': CARRYBEE_SECRET }),
        res1,
      );
      expect(res1.status).toHaveBeenCalledWith(202);
      const res2 = makeRes();
      await controller.carrybee(
        body,
        makeReq('carrybee', { 'x-cb-webhook-integration-header': CARRYBEE_SECRET }),
        res2,
      );
      expect(res2.status).toHaveBeenCalledWith(202);
      expect(webhookSvc.handleCarrybee).toHaveBeenCalledTimes(2);
    });

    it('both present but one wrong → 401 (verify whichever arrives = verify ALL that arrive)', async () => {
      await expect(
        controller.carrybee(
          body,
          makeReq('carrybee', {
            'x-carrybee-webhook-signature': CARRYBEE_SECRET,
            'x-cb-webhook-integration-header': 'wrong',
          }),
          makeRes(),
        ),
      ).rejects.toThrow(UnauthorizedException);
      expect(webhookSvc.handleCarrybee).not.toHaveBeenCalled();
    });

    it('dup Idempotency-Key → 202 no reprocess', async () => {
      withDupeOnSecondCall();
      const headers = { 'x-carrybee-webhook-signature': CARRYBEE_SECRET, 'idempotency-key': 'cb-1' };
      await controller.carrybee(body, makeReq('carrybee', headers), makeRes());
      const res = makeRes();
      const second = await controller.carrybee(body, makeReq('carrybee', headers), res);
      expect(second).toEqual(expect.objectContaining({ duplicate: true }));
      expect(res.status).toHaveBeenCalledWith(202);
      expect(webhookSvc.handleCarrybee).toHaveBeenCalledTimes(1);
    });

    it('malformed → 400; unknown order → 404', async () => {
      webhookSvc.handleCarrybee.mockRejectedValue(new BadRequestException('Missing consignment_id'));
      await expect(
        controller.carrybee({}, makeReq('carrybee', { 'x-carrybee-webhook-signature': CARRYBEE_SECRET }), makeRes()),
      ).rejects.toMatchObject({ status: 400 });
      webhookSvc.handleCarrybee.mockRejectedValue(new NotFoundException('Order not found'));
      await expect(
        controller.carrybee(body, makeReq('carrybee', { 'x-carrybee-webhook-signature': CARRYBEE_SECRET }), makeRes()),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('no secret configured → ACCEPT + warning recorded', async () => {
      prisma.courierCredentials.findUnique.mockResolvedValue({ webhookSecret: null });
      const result = await controller.carrybee(body, makeReq('carrybee', {}), makeRes());
      expect(result).toEqual({ status: 'success', message: 'ok' });
      expect(attemptSvc.completeAttempt).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ outcome: 'SUCCESS', authResult: expect.stringMatching(/not configured/i) }),
      );
    });
  });
});
