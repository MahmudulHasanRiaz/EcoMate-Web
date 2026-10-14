import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Readable } from 'node:stream';

/**
 * Task 4: HMAC-SHA256 must be computed over the EXACT bytes the courier
 * signed. Nest's parsed `@Body()` loses those bytes (key order, whitespace),
 * so this preParsing hook stashes the raw buffer on the request for webhook
 * paths only and hands an identical stream back to Fastify — every other
 * route is untouched (no global content-type parser override).
 */
export function isWebhookRawBodyPath(url: string | undefined): boolean {
  if (!url) return false;
  const path = String(url).split('?')[0];
  return path.startsWith('/api/webhooks/courier/');
}

export async function collectRawBody(payload: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of payload as AsyncIterable<Buffer | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
  }
  return Buffer.concat(chunks);
}

@Injectable()
export class WebhookRawBodyCapture implements OnModuleInit {
  private readonly logger = new Logger(WebhookRawBodyCapture.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  onModuleInit() {
    const instance = (this.httpAdapterHost.httpAdapter as any)?.getInstance?.();
    if (!instance?.addHook) return;
    instance.addHook('preParsing', async (req: any, _reply: any, payload: any) => {
      if (!isWebhookRawBodyPath(req?.url)) return payload;
      if (!payload || typeof payload.on !== 'function') return payload;
      try {
        const buf = await collectRawBody(payload);
        req.rawBody = buf.toString('utf8');
        // Hand back byte-identical bytes so downstream parsing is unaffected.
        return Readable.from(buf);
      } catch (err) {
        this.logger.warn(`Webhook raw-body capture failed: ${(err as Error).message}`);
        return payload;
      }
    });
  }
}
