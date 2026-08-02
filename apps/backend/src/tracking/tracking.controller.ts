import { Controller, Post, Body, Req, Ip, Logger } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit-policy.decorator';
import * as fastify from 'fastify';
import { TrackingCaptureService } from './tracking-capture.service';
import { TrackingContextService } from './tracking-context.service';
import { TrackingSettingsService } from './tracking-settings.service';
import { Public } from '../common/decorators/public.decorator';
import { TrackEventDto } from './dto/track-event.dto';
import { SaveContextDto } from './dto/save-context.dto';
import { PageViewDto } from './dto/page-view.dto';
import { PageViewBufferService } from './page-view-buffer.service';
import { TrackingEventType } from './tracking.constants';

@Controller('tracking')
export class TrackingController {
  private readonly logger = new Logger(TrackingController.name);

  constructor(
    private readonly trackingCapture: TrackingCaptureService,
    private readonly trackingContext: TrackingContextService,
    private readonly pageViewBuffer: PageViewBufferService,
    private readonly trackingSettings: TrackingSettingsService,
  ) {}

  @RateLimitPolicy('storefront')
  @Public()
  @Post('events')
  async trackEvent(
    @Body() body: TrackEventDto,
    @Req() req: fastify.FastifyRequest,
  ) {
    try {
      const eventType = this.mapEventType(body.eventName);
      // page_view is deliberately excluded from CAPI (Pixel/analytics only, design §5);
      // any other unmapped name is unknown/typo'd and skipped best-effort, but logged
      // so silently-dropped events are visible.
      if (eventType) {
        await this.trackingCapture.capture(
          {
            eventId: body.eventId || uuid(),
            eventType,
            orderId: undefined,
            ctxId: body.ctxId,
            eventTime: Math.floor(Date.now() / 1000),
            actionSource: 'website',
            payload: {
              value: body.customData?.value,
              currency: body.customData?.currency,
              content_ids: body.customData?.content_ids,
              content_type: body.customData?.content_type,
              content_name: body.customData?.content_name,
              content_category: body.customData?.content_category,
              contents: body.customData?.contents,
              num_items: body.customData?.num_items,
              search_string: body.customData?.search_string,
              orderId: body.customData?.order_id,
              customer: {
                email: body.userData?.email,
                phone: body.userData?.phone,
                firstName: body.userData?.firstName || body.userData?.name,
                lastName: body.userData?.lastName,
                city: body.userData?.city,
                state: body.userData?.state,
                country: body.userData?.country,
                zip: body.userData?.zip,
              },
            },
            configSnapshot: {
              // Capture-time config so the dispatcher's work set (enabledProviders)
              // is populated for browser events — without it they'd never dispatch.
              ...(await this.trackingSettings.buildConfigSnapshot()),
              source: 'browser',
              capturedAt: new Date().toISOString(),
              ip: req.ip,
              userAgent: (req.headers['user-agent'] as string) || undefined,
            },
          },
          undefined,
        );
      } else if (body.eventName !== 'page_view') {
        this.logger.warn(
          `Unknown tracking event dropped (no CAPI mapping): ${body.eventName}`,
        );
      }
    } catch {
      // Best-effort browser event: a capture failure must never 500 the storefront.
      this.logger.error(`Tracking capture failed for event: ${body.eventName}`);
    }
    return { success: true };
  }

  @Public()
  @RateLimitPolicy('storefront')
  @Post('context')
  async saveContext(
    @Body() body: SaveContextDto,
    @Req() req: fastify.FastifyRequest,
  ) {
    await this.trackingContext.upsertContext(
      body.ctxId,
      {
        identifiers: body.identifiers,
        url: body.url,
        referrer: body.referrer,
      },
      req.ip,
      (req.headers['user-agent'] as string) || '',
    );
    return { success: true };
  }

  @Public()
  @RateLimitPolicy('storefront')
  @Post('page-view')
  async trackPageView(
    @Body() body: PageViewDto,
    @Ip() ip: string,
    @Req() req: fastify.FastifyRequest,
  ) {
    const source = this.classifySource(body.referrer || null);
    this.pageViewBuffer.push({
      url: body.url,
      referrer: body.referrer || null,
      source,
      userAgent: (req.headers['user-agent'] as string) || '',
      ip,
      sessionId: body.sessionId || null,
      timestamp: new Date(),
    });
    return { ok: true };
  }

  /**
   * Browser snake_case event names → canonical CAPI event types.
   * page_view is deliberately excluded (Pixel/analytics only, design §5);
   * any other unmapped name yields undefined and is skipped.
   */
  private mapEventType(name: string): TrackingEventType | undefined {
    const map: Record<string, TrackingEventType> = {
      view_content: 'ViewContent',
      add_to_cart: 'AddToCart',
      add_to_wishlist: 'AddToWishlist',
      initiate_checkout: 'InitiateCheckout',
      add_payment_info: 'AddPaymentInfo',
      purchase: 'Purchase',
      search: 'Search',
      complete_registration: 'CompleteRegistration',
      lead: 'Lead',
    };
    return map[name];
  }

  private classifySource(referrer: string | null): string {
    if (!referrer) return 'direct';
    try {
      const hostname = new URL(referrer).hostname;
      if (/facebook|fb\.(com|me)|\.facebook\./.test(hostname))
        return 'facebook';
      if (/instagram|\.cdninstagram/.test(hostname)) return 'instagram';
      if (/google\.|goo\.gl/.test(hostname)) return 'google';
      if (/tiktok/.test(hostname)) return 'tiktok';
      return 'other';
    } catch {
      return 'other';
    }
  }
}
