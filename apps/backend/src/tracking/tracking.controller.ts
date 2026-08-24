import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  Ip,
  Logger,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { RateLimitPolicy } from '../common/rate-limit/rate-limit-policy.decorator';
import * as fastify from 'fastify';
import { TrackingCaptureService } from './tracking-capture.service';
import { TrackingContextService } from './tracking-context.service';
import { TrackingSettingsService } from './tracking-settings.service';
import { IdentityResolutionService } from './identity-resolution.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TrackEventDto } from './dto/track-event.dto';
import { SaveContextDto } from './dto/save-context.dto';
import { PageViewDto } from './dto/page-view.dto';
import { PageViewBufferService } from './page-view-buffer.service';
import { TrackingEventType } from './tracking.constants';
import { synthesizeFbc } from './context-merge';
import { sanitizeTrackingUrl } from './url-sanitize';

/** Server-side hard opt-out: mirrors the storefront `ecomate_tracking_optout` cookie. */
const OPTOUT_COOKIE = 'ecomate_tracking_optout';

@Controller('tracking')
export class TrackingController {
  private readonly logger = new Logger(TrackingController.name);

  constructor(
    private readonly trackingCapture: TrackingCaptureService,
    private readonly trackingContext: TrackingContextService,
    private readonly pageViewBuffer: PageViewBufferService,
    private readonly trackingSettings: TrackingSettingsService,
    private readonly identityResolution: IdentityResolutionService,
  ) {}

  @RateLimitPolicy('storefront')
  @Public()
  @Post('events')
  async trackEvent(
    @Body() body: TrackEventDto,
    @Req() req: fastify.FastifyRequest,
  ) {
    try {
      // Server-side opt-out guard (consent hardening): the storefront suppresses
      // client-side sends, but a stale tab / injected fetch could still POST a
      // mirror event. Honor the SAME opt-out cookie here — best-effort capture
      // skip, never a failure to the caller.
      const optedOut = req.cookies?.[OPTOUT_COOKIE] !== undefined;
      if (optedOut) return { success: true };

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
                // Wave-3 — Facebook user id for Meta CAPI (fb_login_id). Only
                // present when the storefront resolved it for an authenticated
                // FB shopper; guests never send it.
                fbLoginId:
                  typeof body.userData?.fbLoginId === 'string'
                    ? body.userData.fbLoginId
                    : undefined,
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

      // Wave-2.2 (C3/C6) + P1 fix: the mirror event is frequently the FIRST
      // write of a fresh journey (racing the async context beacon) and the only
      // place ip/ua/url/referrer/fbp/fbc reach the context when the beacon was
      // lost. Fold context on EVERY mirror event with ctxId — previously only
      // when fbp||fbc existed, so cookie-less early events kept a MISSING
      // context → empty Meta user_data → 2804050 rejections. fbc is synthesized
      // from the Meta click id (fbclid) when the _fbc cookie does not exist yet.
      // Best-effort: a context failure must never fail the event.
      if (body.ctxId) {
        const fbc =
          body.userData?.fbc ||
          (body.userData?.fbclid ? synthesizeFbc(String(body.userData.fbclid)) : undefined);
        void this.trackingContext
          .upsertContext(
            body.ctxId,
            {
              identifiers: {
                meta: {
                  fbp: body.userData?.fbp,
                  ...(fbc ? { fbc } : {}),
                },
              },
              url: typeof body.userData?.url === 'string' ? body.userData.url : undefined,
              referrer:
                typeof body.userData?.referrer === 'string'
                  ? body.userData.referrer
                  : undefined,
            },
            req.ip,
            (req.headers['user-agent'] as string) || '',
          )
          .catch(() => undefined);
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
      // Privacy P0: strip sensitive query params before long-term pageView
      // persistence (same policy as TrackingContext.url/referrer).
      url: sanitizeTrackingUrl(body.url) ?? '',
      referrer: sanitizeTrackingUrl(body.referrer) || null,
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
  /**
   * Wave-2.1 shopper identity for the browser Pixel (Candidate B). Authenticated
   * via the global auth guard (NOT @Public). Returns the customer's stable
   * external_id when `tracking_customer_external_id` is ON and the session is
   * linked to a CustomerProfile; otherwise null (browser stays parameterless).
   * The correct source is CustomerProfile via the Better Auth session — NOT
   * /auth/me (which is the admin UserProfile). Null is returned whether the flag
   * is off or the shopper has no profile, so the storefront call is always safe.
   */
  @Get('identity')
  @RateLimitPolicy('storefront')
  async identity(@CurrentUser() user: any) {
    const baUserId =
      user?.betterAuthSession?.user?.id ?? user?.betterAuthUserId ?? null;
    if (!baUserId) {
      return { externalId: null };
    }
    const [externalId, am, fbLoginId] = await Promise.all([
      this.identityResolution.resolveForShopper(baUserId),
      this.identityResolution.resolveAdvancedMatching(baUserId),
      this.identityResolution.resolveFbLoginIdForShopper(baUserId),
    ]);
    return {
      externalId,
      ...am,
      // The shopper's Facebook user id; present only when the session is
      // linked to a facebook account. Absent for guests.
      ...(fbLoginId ? { fbLoginId } : {}),
    };
  }

  /**
   * Wave-2.3: public, read-only tracking configuration the storefront needs to
   * behave correctly — whether consent is required (consent UI gating) and
   * whether Advanced Matching is armed (server flag gate). No secrets, no
   * provider ids; safe for unauthenticated exposure under the storefront
   * rate-limit policy.
   */
  @Public()
  @RateLimitPolicy('storefront')
  @Get('config')
  async trackingConfig() {
    const [consentRequired, advancedMatching, externalIdEnabled] =
      await Promise.all([
        this.trackingSettings.isEnabledOrDefault(
          'tracking_consent_required',
          false,
          'TRACKING_CONSENT_REQUIRED',
        ),
        this.trackingSettings.isEnabledOrDefault(
          'tracking_advanced_matching',
          false,
          'TRACKING_ADVANCED_MATCHING',
        ),
        this.identityResolution.isEnabled(),
      ]);
    return { consentRequired, advancedMatching, externalIdEnabled };
  }

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
