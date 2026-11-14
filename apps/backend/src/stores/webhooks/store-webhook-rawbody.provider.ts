/**
 * Route-scoped raw-body wiring — central-commerce P6 (§8.7).
 *
 * Registers the P0-proven `preParsing` capture through the same
 * `HttpAdapterHost` mechanism as the `CsvBodyParser` precedent
 * (attendance-devices.module.ts) — NO `main.ts` behaviour change for any
 * other route. Only `/api/webhooks/stores/*` is buffered (hard-capped →
 * 413); every other URL exits on the prefix check with the untouched stream.
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  registerStoreWebhookRawBodyCapture,
} from '../raw-body-capture';
import { storeWebhookMaxBodyBytes } from '../store-flags';

@Injectable()
export class StoreWebhookRawBodyProvider implements OnModuleInit {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  onModuleInit() {
    const instance = (this.httpAdapterHost.httpAdapter as any)?.getInstance?.();
    if (!instance?.addHook) return;
    registerStoreWebhookRawBodyCapture(instance, {
      maxBytes: storeWebhookMaxBodyBytes(),
    });
  }
}
