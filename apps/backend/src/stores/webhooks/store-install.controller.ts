/**
 * Shopify app-install landing — central-commerce P9.
 *
 * After the merchant clicks Install, Shopify redirects the browser to the
 * App URL with `?hmac=&host=&shop=&timestamp=`. The global `api` prefix
 * excludes `/`, so this root controller serves that landing: it resolves
 * the shop to a connected store, verifies the HMAC server-side, and
 * renders a plain confirmation page (no secrets, no tokens, no query
 * echo beyond the already-public shop domain).
 */
import { Controller, Get, Query, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimitPolicy } from '../../common/rate-limit/rate-limit-policy.decorator';
import { StoresService } from '../stores.service';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

@Controller()
export class StoreInstallController {
  constructor(private readonly stores: StoresService) {}

  @Public()
  @RateLimitPolicy('api')
  @Get()
  async landing(
    @Query() query: Record<string, string | string[] | undefined>,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<void> {
    const { shop, storeName } =
      await this.stores.verifyInstallCallback(query);
    const safeShop = escapeHtml(shop);
    const safeName = escapeHtml(storeName);
    res
      .type('text/html; charset=utf-8')
      .send(
        `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Store connected</title></head><body style="font-family:sans-serif;max-width:560px;margin:48px auto;padding:0 16px"><h1>Store connected</h1><p><strong>${safeName || safeShop}</strong> (${safeShop}) is now linked to EcoMate.</p><p>Next step: open EcoMate → Sales Channels → Stores, select this store and run <strong>Test Connection</strong>, then configure sync.</p></body></html>`,
      );
  }
}
