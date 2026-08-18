import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { randomUUID, createHash } from 'crypto';
import { CourierWebhookService } from './courier-webhook.service';
import { WebhookAttemptService } from './webhook-attempt.service';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookAttemptOutcome, WebhookAttemptStage } from '@prisma/client';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyRedxHmac } from './webhook-verifier';

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

  private generateCorrelationId(): string {
    return randomUUID();
  }

  private tokenFingerprint(token: string): string {
    return createHash('sha256').update(token).digest('hex').slice(0, 8);
  }

  private async validateWebhookToken(
    courier: string,
    authHeader: string | undefined,
  ): Promise<{ result: string; detail?: string }> {
    if (!authHeader) {
      return { result: 'MISSING', detail: 'Authorization header not provided' };
    }

    const [type, token] = authHeader.split(' ');
    if (type !== 'Bearer' || !token) {
      return { result: 'INVALID_FORMAT', detail: `Expected Bearer scheme, got "${type || '(empty)'}"` };
    }

    const creds = await this.prisma.courierCredentials.findUnique({
      where: { courier },
    });
    if (!creds?.webhookSecret) {
      return { result: 'CREDENTIAL_MISSING', detail: 'Courier webhook secret not configured' };
    }

    if (token !== creds.webhookSecret) {
      return {
        result: 'MISMATCH',
        detail: `Token fingerprint ${this.tokenFingerprint(token)} does not match stored`,
      };
    }

    return { result: 'MATCHED' };
  }

  private async validatePathaoSignature(
    signature: string | undefined,
  ): Promise<{ result: string; detail?: string }> {
    if (!signature) {
      return { result: 'MISSING', detail: 'X-PATHAO-Signature header not provided' };
    }

    const creds = await this.prisma.courierCredentials.findUnique({
      where: { courier: 'pathao' },
    });
    // The merchant's registered integration secret (registered with Pathao,
    // e.g. f3992ecc-59da-4cbe-a049-a13da2018d51) takes precedence; the legacy
    // generic webhookSecret field is accepted as a fallback.
    const secret = creds?.pathaoIntegrationSecret || creds?.webhookSecret;
    if (!secret) {
      return { result: 'CREDENTIAL_MISSING', detail: 'Pathao webhook secret not configured' };
    }

    if (signature !== secret) {
      return { result: 'MISMATCH', detail: 'Signature does not match stored secret' };
    }

    return { result: 'MATCHED' };
  }

  private async validateCarrybeeSignature(
    signature: string | undefined,
  ): Promise<{ result: string; detail?: string }> {
    if (!signature) {
      return { result: 'MISSING', detail: 'X-Carrybee-Webhook-Signature header not provided' };
    }

    const creds = await this.prisma.courierCredentials.findUnique({
      where: { courier: 'carrybee' },
    });
    if (!creds?.webhookSecret) {
      return { result: 'CREDENTIAL_MISSING', detail: 'Carrybee webhook secret not configured' };
    }

    if (signature !== creds.webhookSecret) {
      return { result: 'MISMATCH', detail: 'Signature does not match stored secret' };
    }

    return { result: 'MATCHED' };
  }

  private validateRedxSignature(
    body: unknown,
    signature: unknown,
  ): { result: string; detail?: string } {
    try {
      verifyRedxHmac(body, signature, process.env['REDX_WEBHOOK_SECRET']);
      return { result: 'MATCHED' };
    } catch (err) {
      const msg = (err as Error).message;
      if (msg === 'RedX webhook not configured') {
        return { result: 'CREDENTIAL_MISSING', detail: 'REDX_WEBHOOK_SECRET env var not set' };
      }
      return { result: 'MISMATCH', detail: 'HMAC signature verification failed' };
    }
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
  ): Promise<{ id: string; receivedAt: Date } | null> {
    try {
      return await this.attempts.startAttempt(courier, path, correlationId, sourceIp);
    } catch (err) {
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

  @Public()
  @Post('steadfast')
  @HttpCode(HttpStatus.OK)
  async steadfast(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
  ) {
    const correlationId = this.generateCorrelationId();
    const sourceIp = this.extractSourceIp(req);
    const path = req.url;
    const startedAt = Date.now();

    const attempt = await this.safeStartAttempt('steadfast', path, correlationId, sourceIp);

    try {
      const auth = await this.validateWebhookToken('steadfast', req.headers['authorization']);
      if (auth.result !== 'MATCHED') {
        const outcome = this.authOutcomeFromResult(auth.result);
        await this.safeCompleteAttempt(attempt?.id ?? '', {
          responseStatus: 401,
          outcome,
          failureStage: WebhookAttemptStage.AUTH,
          authResult: auth.detail,
          durationMs: Date.now() - startedAt,
        });
        throw new UnauthorizedException('Invalid webhook authentication');
      }

      const notificationType = (body['notification_type'] as string) || (body['status'] as string) || '';
      const consignmentId = String(body['consignment_id'] ?? '').trim();
      const invoice = String(body['invoice'] ?? '').trim();

      await this.safeCompleteAttempt(attempt?.id ?? '', {
        outcome: WebhookAttemptOutcome.UNKNOWN_ERROR,
        authResult: 'MATCHED',
        notificationType: notificationType || undefined,
        consignmentId: consignmentId || undefined,
        invoice: invoice || undefined,
      });

      this.logger.log(`Steadfast webhook received [${correlationId}]`);
      const result = await this.svc.handleSteadfast(body);

      await this.safeCompleteAttempt(attempt?.id ?? '', {
        responseStatus: 200,
        outcome: WebhookAttemptOutcome.SUCCESS,
        message: result?.message,
        durationMs: Date.now() - startedAt,
      });

      return result;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;

      await this.safeCompleteAttempt(attempt?.id ?? '', {
        responseStatus: 500,
        outcome: WebhookAttemptOutcome.PROCESSING_ERROR,
        failureStage: WebhookAttemptStage.PROCESSING,
        message: (err as Error).message?.slice(0, 500),
        durationMs: Date.now() - startedAt,
      });
      throw err;
    }
  }

  @Public()
  @Post('pathao')
  async pathao(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const correlationId = this.generateCorrelationId();
    const sourceIp = this.extractSourceIp(req);
    const path = req.url;
    const startedAt = Date.now();

    const attempt = await this.safeStartAttempt('pathao', path, correlationId, sourceIp);

    try {
      const auth = await this.validatePathaoSignature(req.headers['x-pathao-signature'] as string | undefined);
      if (auth.result !== 'MATCHED') {
        const outcome = this.authOutcomeFromResult(auth.result);
        await this.safeCompleteAttempt(attempt?.id ?? '', {
          responseStatus: 401,
          outcome,
          failureStage: WebhookAttemptStage.AUTH,
          authResult: auth.detail,
          durationMs: Date.now() - startedAt,
        });
        throw new UnauthorizedException('Invalid webhook authentication');
      }

      const creds = await this.prisma.courierCredentials.findUnique({
        where: { courier: 'pathao' },
      });
      res.header(
        'X-Pathao-Merchant-Webhook-Integration-Secret',
        creds?.pathaoIntegrationSecret || creds?.webhookSecret || '',
      );
      res.status(202);

      const event = (body['event'] as string) || '';
      const consignmentId = String(body['consignment_id'] ?? '').trim();

      await this.safeCompleteAttempt(attempt?.id ?? '', {
        outcome: WebhookAttemptOutcome.UNKNOWN_ERROR,
        authResult: 'MATCHED',
        notificationType: event || undefined,
        consignmentId: consignmentId || undefined,
      });

      this.logger.log(`Pathao webhook received [${correlationId}]`);
      const result = await this.svc.handlePathao(body);

      await this.safeCompleteAttempt(attempt?.id ?? '', {
        responseStatus: 202,
        outcome: WebhookAttemptOutcome.SUCCESS,
        message: result?.message,
        durationMs: Date.now() - startedAt,
      });

      return result;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;

      await this.safeCompleteAttempt(attempt?.id ?? '', {
        responseStatus: 500,
        outcome: WebhookAttemptOutcome.PROCESSING_ERROR,
        failureStage: WebhookAttemptStage.PROCESSING,
        message: (err as Error).message?.slice(0, 500),
        durationMs: Date.now() - startedAt,
      });
      throw err;
    }
  }

  @Public()
  @Post('redx')
  async redx(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
  ) {
    const correlationId = this.generateCorrelationId();
    const sourceIp = this.extractSourceIp(req);
    const path = req.url;
    const startedAt = Date.now();

    const attempt = await this.safeStartAttempt('redx', path, correlationId, sourceIp);

    try {
      const auth = this.validateRedxSignature(body, req.headers['x-redx-signature']);
      if (auth.result !== 'MATCHED') {
        const outcome = this.authOutcomeFromResult(auth.result);
        await this.safeCompleteAttempt(attempt?.id ?? '', {
          responseStatus: 401,
          outcome,
          failureStage: WebhookAttemptStage.AUTH,
          authResult: auth.detail,
          durationMs: Date.now() - startedAt,
        });
        throw new UnauthorizedException('Invalid webhook signature');
      }

      const trackingNumber = String(body['tracking_number'] ?? '').trim();

      await this.safeCompleteAttempt(attempt?.id ?? '', {
        outcome: WebhookAttemptOutcome.UNKNOWN_ERROR,
        authResult: 'MATCHED',
        consignmentId: trackingNumber || undefined,
      });

      this.logger.log(`RedX webhook received [${correlationId}]`);
      const result = await this.svc.handleRedx(body);

      await this.safeCompleteAttempt(attempt?.id ?? '', {
        responseStatus: 200,
        outcome: WebhookAttemptOutcome.SUCCESS,
        message: result?.message,
        durationMs: Date.now() - startedAt,
      });

      return result;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;

      await this.safeCompleteAttempt(attempt?.id ?? '', {
        responseStatus: 500,
        outcome: WebhookAttemptOutcome.PROCESSING_ERROR,
        failureStage: WebhookAttemptStage.PROCESSING,
        message: (err as Error).message?.slice(0, 500),
        durationMs: Date.now() - startedAt,
      });
      throw err;
    }
  }

  @Public()
  @Post('carrybee')
  async carrybee(
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const correlationId = this.generateCorrelationId();
    const sourceIp = this.extractSourceIp(req);
    const path = req.url;
    const startedAt = Date.now();

    const attempt = await this.safeStartAttempt('carrybee', path, correlationId, sourceIp);

    try {
      const auth = await this.validateCarrybeeSignature(req.headers['x-carrybee-webhook-signature'] as string | undefined);
      if (auth.result !== 'MATCHED') {
        const outcome = this.authOutcomeFromResult(auth.result);
        await this.safeCompleteAttempt(attempt?.id ?? '', {
          responseStatus: 401,
          outcome,
          failureStage: WebhookAttemptStage.AUTH,
          authResult: auth.detail,
          durationMs: Date.now() - startedAt,
        });
        throw new UnauthorizedException('Invalid webhook authentication');
      }

      const creds = await this.prisma.courierCredentials.findUnique({
        where: { courier: 'carrybee' },
      });
      res.header('X-CB-Webhook-Integration-Header', creds?.webhookSecret || '');
      res.status(202);

      const event = (body['event'] as string) || '';
      const consignmentId = String(body['consignment_id'] ?? '').trim();

      await this.safeCompleteAttempt(attempt?.id ?? '', {
        outcome: WebhookAttemptOutcome.UNKNOWN_ERROR,
        authResult: 'MATCHED',
        notificationType: event || undefined,
        consignmentId: consignmentId || undefined,
      });

      this.logger.log(`Carrybee webhook received [${correlationId}]`);
      const result = await this.svc.handleCarrybee(body);

      await this.safeCompleteAttempt(attempt?.id ?? '', {
        responseStatus: 202,
        outcome: WebhookAttemptOutcome.SUCCESS,
        message: result?.message,
        durationMs: Date.now() - startedAt,
      });

      return result;
    } catch (err) {
      if (err instanceof UnauthorizedException) throw err;

      await this.safeCompleteAttempt(attempt?.id ?? '', {
        responseStatus: 500,
        outcome: WebhookAttemptOutcome.PROCESSING_ERROR,
        failureStage: WebhookAttemptStage.PROCESSING,
        message: (err as Error).message?.slice(0, 500),
        durationMs: Date.now() - startedAt,
      });
      throw err;
    }
  }
}
