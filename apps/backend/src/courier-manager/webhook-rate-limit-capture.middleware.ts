import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookAttemptOutcome, WebhookAttemptStage } from '@prisma/client';

const COURIER_WEBHOOK_PATTERN = /^\/api\/webhooks\/courier\/(\w+)/;

/**
 * Middleware that captures rate-limit rejections (429) for courier webhook paths.
 *
 * The AdaptiveRateLimiterGuard runs before the controller and returns 429
 * without giving the controller a chance to log. This middleware hooks into
 * the response lifecycle to record the rejection as a WebhookAttempt.
 *
 * Runs via Fastify's onRequest hook — lightweight, no-op for non-webhook paths.
 */
@Injectable()
export class WebhookRateLimitCaptureMiddleware {
  private readonly logger = new Logger(WebhookRateLimitCaptureMiddleware.name);

  constructor(private readonly prisma: PrismaService) {}

  async handle(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    const path = req.url;
    const match = COURIER_WEBHOOK_PATTERN.exec(path);
    if (!match) return;

    const courier = match[1];
    const correlationId = randomUUID();

    // Attach hooks to capture 429 after the guard runs
    reply.raw.on('finish', async () => {
      const statusCode = reply.statusCode;
      if (statusCode === 429) {
        try {
          const sourceIp = this.extractSourceIp(req);
          await this.prisma.webhookAttempt.create({
            data: {
              courier,
              method: (req.method || 'POST') as string,
              path,
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
    });
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
