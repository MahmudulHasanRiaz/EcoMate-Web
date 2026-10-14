import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  InternalServerErrorException,
  HttpException,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CourierWebhookService } from './courier-webhook.service';
import { WebhookAttemptService } from './webhook-attempt.service';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookAttemptOutcome, WebhookAttemptStage } from '@prisma/client';
import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  timingSafeEqualText,
  verifyRawHmacSha256Hex,
  verifyVerbatimSecret,
} from './webhook-verifier';
import { redactSecrets } from './courier-manager.service';

/**
 * Pathao's published, merchant-independent webhook integration token that every
 * merchant URL must echo in the X-Pathao-Merchant-Webhook-Integration-Secret
 * response header. It is a fixed constant (identical for all merchants), NOT
 * the merchant's registered webhook secret — it must never be used to validate
 * the inbound X-PATHAO-Signature, since anyone could replay it.
 */
export const PATHAO_WEBHOOK_INTEGRATION_SECRET = 'f3992ecc-59da-4cbe-a049-a13da2018d51';

type AuthDecision =
  | { result: 'MATCHED' }
  | { result: 'UNCONFIGURED'; detail: string }
  | { result: 'MISSING' | 'MISMATCH'; detail: string };

@Controller('webhooks/courier')
export class CourierWebhookController {
  private readonly logger = new Logger(CourierWebhookController.name);

  constructor(
    private readonly svc: CourierWebhookService,
    private readonly prisma: PrismaService,
    private readonly attempts: WebhookAttemptService,
  ) {}

  private extractSourceIp(req: FastifyRequest): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const first = forwarded.split(',')[0].trim();
      if (first && first !== 'unknown') return first;
    }
    return req.ip || req.socket?.remoteAddress || '0.0.0.0';
  }

  /**
   * Task 4: the stored/logged path MUST NOT contain the query string —
   * RedX authenticates via `?token=`, and persisting req.url verbatim would
   * write the secret into WebhookAttempt rows and logs.
   */
  private cleanPath(req: FastifyRequest): string {
    return String(req.url || '').split('?')[0];
  }

  /**
   * Task 4: HMAC input bytes. The preParsing hook (WebhookRawBodyCapture)
   * stashes the exact received bytes on the request; direct/unit-test calls
   * without it fall back to re-serialization (documented, byte-inexact).
   */
  private rawBodyOf(req: FastifyRequest, body: unknown): string {
    const raw = (req as unknown as { rawBody?: unknown }).rawBody;
    if (typeof raw === 'string') return raw;
    if (Buffer.isBuffer(raw)) return raw.toString('utf8');
    return typeof body === 'string' ? body : JSON.stringify(body ?? {});
  }

  private idempotencyKeyOf(req: FastifyRequest): string | undefined {
    const raw = req.headers['idempotency-key'];
    const key = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    return key ? key : undefined;
  }

  private queryTokenOf(req: FastifyRequest): string | undefined {
    const q = (req as unknown as { query?: Record<string, unknown> }).query;
    const token = q?.['token'];
    return typeof token === 'string' && token.length > 0 ? token : undefined;
  }

  private isUniqueViolation(err: unknown): boolean {
    return (err as { code?: string })?.code === 'P2002';
  }

  private async storedSecret(courier: string): Promise<string | undefined> {
    const creds = await this.prisma.courierCredentials.findUnique({
      where: { courier },
    });
    const secret = creds?.webhookSecret?.trim();
    return secret ? secret : undefined;
  }

  private async redxSecret(): Promise<string | undefined> {
    return (
      (await this.storedSecret('redx')) ||
      process.env['REDX_WEBHOOK_SECRET']?.trim() ||
      undefined
    );
  }

  private unconfiguredDetail(courier: string, hint: string): string {
    return `${courier} webhook token not configured — accepted WITHOUT verification. ${hint}`;
  }

  /**
   * Steadfast (per docs): every request carries `Authorization: Bearer <token>`
   * AND `X-Signature: HMAC-SHA256(raw body, token)`. When a token is
   * configured the HMAC is the ONLY accepted proof — a Bearer match alone is
   * NOT a fallback (owner: Bearer fallback ONLY when no token configured).
   * With no token configured the request is accepted with a loud warning.
   */
  private async authenticateSteadfast(
    req: FastifyRequest,
    rawBody: string,
  ): Promise<AuthDecision> {
    const secret = await this.storedSecret('steadfast');
    if (!secret) {
      return {
        result: 'UNCONFIGURED',
        detail: this.unconfiguredDetail(
          'Steadfast',
          'Set the webhook token in courier settings (Steadfast panel → webhook URL) to enable HMAC verification.',
        ),
      };
    }
    try {
      verifyRawHmacSha256Hex(rawBody, req.headers['x-signature'], secret);
      return { result: 'MATCHED' };
    } catch {
      return { result: 'MISMATCH', detail: 'HMAC signature verification failed' };
    }
  }

  /**
   * Pathao (per docs): X-PATHAO-Signature carries the merchant-registered
   * secret VERBATIM (no HMAC) — constant-time compare, never the public
   * integration constant.
   */
  private async authenticatePathao(req: FastifyRequest): Promise<AuthDecision> {
    const secret = await this.storedSecret('pathao');
    if (!secret) {
      return {
        result: 'UNCONFIGURED',
        detail: this.unconfiguredDetail(
          'Pathao',
          'Put the exact Secret from Pathao Webhook Integration page into the Webhook Secret box to enable verification.',
        ),
      };
    }
    try {
      verifyVerbatimSecret(req.headers['x-pathao-signature'] as string | undefined, secret, {
        missingSecretMessage: 'Pathao webhook secret not configured',
      });
      return { result: 'MATCHED' };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'Pathao webhook secret not configured') {
        return { result: 'UNCONFIGURED', detail: this.unconfiguredDetail('Pathao', '') };
      }
      return { result: 'MISMATCH', detail: 'Signature does not match the registered webhook secret' };
    }
  }

  /**
   * Carrybee: TWO documented header names — `X-Carrybee-Webhook-Signature`
   * (webhooks doc) and `X-CB-Webhook-Integration-Header` (API webhook-
   * integration doc). Verify WHICHEVER arrives; when both arrive, both must
   * match (a half-forged request is still forged).
   */
  private async authenticateCarrybee(req: FastifyRequest): Promise<AuthDecision> {
    const secret = await this.storedSecret('carrybee');
    if (!secret) {
      return {
        result: 'UNCONFIGURED',
        detail: this.unconfiguredDetail(
          'Carrybee',
          'Set the webhook secret from the Carrybee Webhook Integration page to enable verification.',
        ),
      };
    }
    const candidates = [
      req.headers['x-carrybee-webhook-signature'],
      req.headers['x-cb-webhook-integration-header'],
    ].filter((h): h is string => typeof h === 'string' && h.length > 0);
    if (candidates.length === 0) {
      return { result: 'MISSING', detail: 'Carrybee signature header not provided' };
    }
    for (const candidate of candidates) {
      if (!timingSafeEqualText(candidate, secret)) {
        return { result: 'MISMATCH', detail: 'Signature does not match stored secret' };
      }
    }
    return { result: 'MATCHED' };
  }

  /**
   * RedX dual (owner-approved; docs show only the ?token= callback style):
   * HMAC over the raw body when the signature header is present, ELSE the
   * `?token=` query value compared in constant time. The token is NEVER
   * logged or persisted (see cleanPath). Per-env callback URL holds the
   * token; the stored per-courier secret takes precedence when both exist.
   */
  private async authenticateRedx(
    req: FastifyRequest,
    rawBody: string,
  ): Promise<AuthDecision> {
    const secret = await this.redxSecret();
    const hmacHeader = req.headers['x-redx-signature'];
    const hasHmacHeader = typeof hmacHeader === 'string' && hmacHeader.length > 0;
    const queryToken = this.queryTokenOf(req);

    if (!secret) {
      return {
        result: 'UNCONFIGURED',
        detail: this.unconfiguredDetail(
          'RedX',
          'Set the webhook secret (courier settings, or REDX_WEBHOOK_SECRET) matching the token in your RedX callback URL to enable verification.',
        ),
      };
    }
    if (hasHmacHeader) {
      try {
        verifyRawHmacSha256Hex(rawBody, hmacHeader, secret);
        return { result: 'MATCHED' };
      } catch {
        return { result: 'MISMATCH', detail: 'HMAC signature verification failed' };
      }
    }
    if (queryToken !== undefined) {
      if (!timingSafeEqualText(queryToken, secret)) {
        return { result: 'MISMATCH', detail: 'Callback token verification failed' };
      }
      return { result: 'MATCHED' };
    }
    return { result: 'MISSING', detail: 'RedX signature header and callback token both missing' };
  }

  private authOutcomeFromResult(result: string): WebhookAttemptOutcome {
    switch (result) {
      case 'MISSING': return WebhookAttemptOutcome.AUTH_HEADER_MISSING;
      case 'INVALID_FORMAT': return WebhookAttemptOutcome.AUTH_FORMAT_INVALID;
      case 'CREDENTIAL_MISSING':
      case 'MISMATCH': return WebhookAttemptOutcome.AUTH_FAILED;
      default: return WebhookAttemptOutcome.UNKNOWN_ERROR;
    }
  }

  private async safeStartAttempt(
    courier: string,
    path: string,
    correlationId: string,
    sourceIp: string,
    idempotencyKey?: string,
  ): Promise<{ id: string; receivedAt: Date } | null> {
    try {
      return await this.attempts.startAttempt(courier, path, correlationId, sourceIp, idempotencyKey);
    } catch (err) {
      if (this.isUniqueViolation(err)) throw err;
      this.logger.warn(`Webhook attempt start failed for ${courier}: ${(err as Error).message?.slice(0, 200)}`);
      return null;
    }
  }

  private async safeCompleteAttempt(
    id: string | null,
    params: {
      responseStatus?: number;
      outcome: WebhookAttemptOutcome;
      failureStage?: WebhookAttemptStage;
      authResult?: string;
      notificationType?: string;
      consignmentId?: string;
      invoice?: string;
      courierEvent?: string;
      message?: string;
      isDuplicate?: boolean;
      durationMs?: number;
    },
  ): Promise<void> {
    if (!id) return;
    try {
      await this.attempts.completeAttempt(id, params);
    } catch (err) {
      this.logger.warn(`Webhook attempt completion failed: ${(err as Error).message?.slice(0, 200)}`);
    }
  }

  /**
   * Shared tail of every handler: claim the Idempotency-Key (P2002 → 2xx
   * no-reprocess), run the service, and enforce the status discipline —
   * HttpExceptions keep their 4xx (recorded as PAYLOAD_INVALID /
   * ORDER_NOT_FOUND), ONLY non-HTTP/transient failures become 5xx.
   */
  private async processWebhook(opts: {
    courier: string;
    auth: AuthDecision;
    idempotencyKey: string | undefined;
    path: string;
    correlationId: string;
    sourceIp: string;
    startedAt: number;
    successStatus: number;
    meta: { notificationType?: string; consignmentId?: string; invoice?: string; courierEvent?: string };
    run: () => Promise<{ status: string; message?: string } | unknown>;
  }): Promise<unknown> {
    const { courier, auth, idempotencyKey, path, correlationId, sourceIp, startedAt, successStatus, meta, run } = opts;

    if (auth.result === 'MISSING' || auth.result === 'MISMATCH') {
      const outcome = this.authOutcomeFromResult(auth.result);
      const attempt = await this.safeStartAttempt(courier, path, correlationId, sourceIp);
      await this.safeCompleteAttempt(attempt?.id ?? null, {
        responseStatus: 401,
        outcome,
        failureStage: WebhookAttemptStage.AUTH,
        authResult: auth.detail,
        ...meta,
        durationMs: Date.now() - startedAt,
      });
      throw new UnauthorizedException('Invalid webhook signature');
    }

    if (auth.result === 'UNCONFIGURED') {
      // Owner-locked: accept, but NEVER silently — loud server warning +
      // warning persisted on the attempt row + settings banner flag.
      this.logger.warn(
        `[webhook] ${courier}: ${auth.detail}`,
      );
    }

    if (idempotencyKey) {
      try {
        const attempt = await this.attempts.startAttempt(
          courier, path, correlationId, sourceIp, idempotencyKey,
        );
        return await this.runAndComplete({
          attemptId: attempt.id, courier, startedAt, successStatus, meta,
          authResult: auth.result === 'MATCHED' ? 'MATCHED' : auth.detail,
          run,
        });
      } catch (err) {
        if (this.isUniqueViolation(err)) {
          this.logger.warn(
            `[webhook] ${courier}: duplicate Idempotency-Key ignored (no reprocess) [${correlationId}]`,
          );
          try {
            await this.attempts.logAttempt({
              courier,
              path,
              responseStatus: successStatus,
              outcome: WebhookAttemptOutcome.SUCCESS,
              authResult: auth.result === 'MATCHED' ? 'MATCHED' : auth.detail,
              ...meta,
              message: 'Duplicate Idempotency-Key — replay ignored, original processing kept',
              isDuplicate: true,
              correlationId,
              sourceIp,
              durationMs: Date.now() - startedAt,
            });
          } catch {
            // Diagnostics must never break the 2xx contract.
          }
          return { status: 'success', message: 'Duplicate webhook ignored', duplicate: true };
        }
        this.logger.warn(`Webhook attempt start failed for ${courier}: ${(err as Error).message?.slice(0, 200)}`);
      }
    }

    const attempt = await this.safeStartAttempt(courier, path, correlationId, sourceIp);
    return await this.runAndComplete({
      attemptId: attempt?.id ?? null, courier, startedAt, successStatus, meta,
      authResult: auth.result === 'MATCHED' ? 'MATCHED' : auth.detail,
      run,
    });
  }

  private async runAndComplete(opts: {
    attemptId: string | null;
    courier: string;
    startedAt: number;
    successStatus: number;
    meta: { notificationType?: string; consignmentId?: string; invoice?: string; courierEvent?: string };
    authResult: string;
    run: () => Promise<unknown>;
  }): Promise<unknown> {
    try {
      const result = await opts.run();
      const message =
        result && typeof result === 'object' && 'message' in result
          ? String((result as { message: unknown }).message ?? '').slice(0, 500)
          : undefined;
      await this.safeCompleteAttempt(opts.attemptId, {
        responseStatus: opts.successStatus,
        outcome: WebhookAttemptOutcome.SUCCESS,
        authResult: opts.authResult,
        ...opts.meta,
        message,
        durationMs: Date.now() - opts.startedAt,
      });
      return result;
    } catch (err) {
      if (err instanceof HttpException) {
        const status = err.getStatus();
        const outcome =
          status === 404
            ? WebhookAttemptOutcome.ORDER_NOT_FOUND
            : status >= 400 && status < 500
              ? WebhookAttemptOutcome.PAYLOAD_INVALID
              : WebhookAttemptOutcome.PROCESSING_ERROR;
        await this.safeCompleteAttempt(opts.attemptId, {
          responseStatus: status,
          outcome,
          failureStage:
            status === 404
              ? WebhookAttemptStage.ORDER_RESOLUTION
              : status >= 400 && status < 500
                ? WebhookAttemptStage.PAYLOAD
                : WebhookAttemptStage.PROCESSING,
          authResult: opts.authResult,
          ...opts.meta,
          message: redactSecrets(err.message)?.slice(0, 500),
          durationMs: Date.now() - opts.startedAt,
        });
        throw err;
      }
      await this.safeCompleteAttempt(opts.attemptId, {
        responseStatus: 500,
        outcome: WebhookAttemptOutcome.PROCESSING_ERROR,
        failureStage: WebhookAttemptStage.PROCESSING,
        authResult: opts.authResult,
        ...opts.meta,
        message: redactSecrets((err as Error).message)?.slice(0, 500),
        durationMs: Date.now() - opts.startedAt,
      });
      throw new InternalServerErrorException('Webhook processing failed');
    }
  }

  private baseContext(req: FastifyRequest) {
    return {
      correlationId: randomUUID(),
      sourceIp: this.extractSourceIp(req),
      path: this.cleanPath(req),
      idempotencyKey: this.idempotencyKeyOf(req),
      startedAt: Date.now(),
    };
  }

  @Public()
  @Post('steadfast')
  @HttpCode(HttpStatus.OK)
  async steadfast(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
  ) {
    const ctx = this.baseContext(req);
    const rawBody = this.rawBodyOf(req, body);
    const auth = await this.authenticateSteadfast(req, rawBody);
    const notificationType = (body['notification_type'] as string) || (body['status'] as string) || '';
    const consignmentId = String(body['consignment_id'] ?? '').trim();
    const invoice = String(body['invoice'] ?? '').trim();

    this.logger.log(`Steadfast webhook received [${ctx.correlationId}]`);
    return this.processWebhook({
      courier: 'steadfast',
      auth,
      idempotencyKey: ctx.idempotencyKey,
      path: ctx.path,
      correlationId: ctx.correlationId,
      sourceIp: ctx.sourceIp,
      startedAt: ctx.startedAt,
      successStatus: 200,
      meta: {
        notificationType: notificationType || undefined,
        consignmentId: consignmentId || undefined,
        invoice: invoice || undefined,
      },
      run: () => this.svc.handleSteadfast(body),
    });
  }

  @Public()
  @Post('pathao')
  async pathao(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const ctx = this.baseContext(req);
    const auth = await this.authenticatePathao(req);

    const creds = await this.prisma.courierCredentials.findUnique({
      where: { courier: 'pathao' },
    });
    res.header(
      'X-Pathao-Merchant-Webhook-Integration-Secret',
      (creds?.pathaoIntegrationSecret || '').trim() || PATHAO_WEBHOOK_INTEGRATION_SECRET,
    );
    res.status(202);

    const event = (body['event'] as string) || '';
    const consignmentId = String(body['consignment_id'] ?? '').trim();

    this.logger.log(`Pathao webhook received [${ctx.correlationId}]`);
    return this.processWebhook({
      courier: 'pathao',
      auth,
      idempotencyKey: ctx.idempotencyKey,
      path: ctx.path,
      correlationId: ctx.correlationId,
      sourceIp: ctx.sourceIp,
      startedAt: ctx.startedAt,
      successStatus: 202,
      meta: {
        notificationType: event || undefined,
        consignmentId: consignmentId || undefined,
      },
      run: () => this.svc.handlePathao(body),
    });
  }

  @Public()
  @Post('redx')
  @HttpCode(HttpStatus.OK)
  async redx(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
  ) {
    const ctx = this.baseContext(req);
    const rawBody = this.rawBodyOf(req, body);
    const auth = await this.authenticateRedx(req, rawBody);
    const trackingNumber = String(body['tracking_number'] ?? '').trim();

    this.logger.log(`RedX webhook received [${ctx.correlationId}]`);
    return this.processWebhook({
      courier: 'redx',
      auth,
      idempotencyKey: ctx.idempotencyKey,
      path: ctx.path,
      correlationId: ctx.correlationId,
      sourceIp: ctx.sourceIp,
      startedAt: ctx.startedAt,
      successStatus: 200,
      meta: {
        consignmentId: trackingNumber || undefined,
      },
      run: () => this.svc.handleRedx(body),
    });
  }

  @Public()
  @Post('carrybee')
  async carrybee(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const ctx = this.baseContext(req);
    const auth = await this.authenticateCarrybee(req);

    const creds = await this.prisma.courierCredentials.findUnique({
      where: { courier: 'carrybee' },
    });
    res.header('X-CB-Webhook-Integration-Header', creds?.webhookSecret || '');
    res.status(202);

    const event = (body['event'] as string) || '';
    const consignmentId = String(body['consignment_id'] ?? '').trim();

    this.logger.log(`Carrybee webhook received [${ctx.correlationId}]`);
    return this.processWebhook({
      courier: 'carrybee',
      auth,
      idempotencyKey: ctx.idempotencyKey,
      path: ctx.path,
      correlationId: ctx.correlationId,
      sourceIp: ctx.sourceIp,
      startedAt: ctx.startedAt,
      successStatus: 202,
      meta: {
        notificationType: event || undefined,
        consignmentId: consignmentId || undefined,
      },
      run: () => this.svc.handleCarrybee(body),
    });
  }
}
