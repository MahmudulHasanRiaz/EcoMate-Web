import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { NextFunction } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookAttemptOutcome, WebhookAttemptStage } from '@prisma/client';

const COURIER_WEBHOOK_PATTERN = /^\/api\/webhooks\/courier\/(\w+)/;

/**
 * Middleware that captures rate-limit rejections (429) for courier webhook paths.
 *
 * The AdaptiveRateLimiterGuard runs after middleware and returns 429
 * without giving the controller a chance to log. This middleware hooks into
 * the response lifecycle to record the rejection as a WebhookAttempt.
 *
 * Runs via NestJS middleware consumer — lightweight, no-op for non-webhook paths.
 */
@Injectable()
export class WebhookRateLimitCaptureMiddleware {
  private readonly logger = new Logger(WebhookRateLimitCaptureMiddleware.name);

  constructor(private readonly prisma: PrismaService) {}

  use(req: FastifyRequest, reply: FastifyReply, next: NextFunction): void {
    // Security (LOW): strip the query string (?token=) before matching and
    // storing — RedX authenticates via `?token=`, and persisting req.url
    // verbatim would write the secret into WebhookAttempt rows.
    const path = String(req.url || '').split('?')[0];
    const match = COURIER_WEBHOOK_PATTERN.exec(path);

    if (!match) {
      next();
      return;
    }

    const courier = match[1];
    const correlationId = randomUUID();

    // Attach hook to capture 429 after the guard runs (guard executes after middleware)
    reply.raw.on('finish', () => {
      const statusCode = reply.statusCode;
      if (statusCode === 429) {
        this.captureRateLimit(courier, req, path, correlationId).catch(() => {});
      }
    });

    next();
  }

  private async captureRateLimit(
    courier: string,
    req: FastifyRequest,
    path: string,
    correlationId: string,
  ): Promise<void> {
    try {
      const sourceIp = this.extractSourceIp(req);
      // Defense-in-depth: strip any query (?token=) again at the store
      // boundary so a future caller passing a raw URL can never persist
      // the RedX callback token.
      const cleanPath = String(path || '').split('?')[0];
      await this.prisma.webhookAttempt.create({
        data: {
          courier,
          method: (req.method || 'POST') as string,
          path: cleanPath,
          responseStatus: 429,
          outcome: WebhookAttemptOutcome.RATE_LIMITED,
          failureStage: WebhookAttemptStage.RATE_LIMIT,
          correlationId,
          sourceIp,
          message: 'Rate limit exceeded — request rejected before reaching controller',
          completedAt: new Date(),
        },
      });
      this.logger.warn(
        `Rate-limited courier webhook: ${courier} from ${sourceIp} [${correlationId}]`,
      );
    } catch {
      // Best-effort — never crash the request lifecycle for diagnostics
    }
  }

  private extractSourceIp(req: FastifyRequest): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const first = forwarded.split(',')[0].trim();
      if (first && first !== 'unknown') return first;
    }
    return req.ip || req.socket?.remoteAddress || '0.0.0.0';
  }
}
