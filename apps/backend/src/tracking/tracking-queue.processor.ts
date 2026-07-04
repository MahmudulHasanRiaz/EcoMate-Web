import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MetaConversionsService } from './meta-conversions.service';
import { TikTokEventsService } from './tiktok-events.service';
import { Ga4MeasurementService } from './ga4-measurement.service';
import { GoogleAdsService } from './google-ads.service';
import { TrackingJob } from './tracking-queue.service';

@Processor('tracking')
export class TrackingQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(TrackingQueueProcessor.name);

  constructor(
    private readonly meta: MetaConversionsService,
    private readonly tiktok: TikTokEventsService,
    private readonly ga4: Ga4MeasurementService,
    private readonly googleAds: GoogleAdsService,
  ) {
    super();
  }

  async process(job: Job<TrackingJob>): Promise<void> {
    const { eventId, eventName, eventTime, userId, userData, customData } = job.data;

    this.logger.debug(`Processing tracking event: ${eventName} [${eventId}]`);

    const platformEventName = this.mapToPlatformName(eventName);
    if (!platformEventName) return;

    const payload = {
      eventName: platformEventName,
      eventId,
      eventTime,
      userId,
      userData: { ...userData },
      customData,
    };

    await Promise.allSettled([
      this.meta.sendEvent(payload).catch((e) => this.logger.error(`Meta send failed: ${e}`)),
      this.tiktok.sendEvent(payload).catch((e) => this.logger.error(`TikTok send failed: ${e}`)),
      this.ga4.sendEvent(payload).catch((e) => this.logger.error(`GA4 send failed: ${e}`)),
    ]);

    if (platformEventName === 'Purchase') {
      this.googleAds.sendConversion({
        eventName: platformEventName,
        eventId,
        conversionId: userData?.conversionId || '',
        value: customData?.value,
        currency: customData?.currency,
        email: userData?.email,
        phone: userData?.phone,
        orderId: customData?.order_id,
      }).catch((e) => this.logger.error(`Google Ads send failed: ${e}`));
    }
  }

  private mapToPlatformName(name: string): string | null {
    const map: Record<string, string> = {
      view_content: 'ViewContent',
      add_to_cart: 'AddToCart',
      add_to_wishlist: 'AddToWishlist',
      initiate_checkout: 'InitiateCheckout',
      add_payment_info: 'AddPaymentInfo',
      purchase: 'Purchase',
      search: 'Search',
      complete_registration: 'CompleteRegistration',
      page_view: 'PageView',
    };
    return map[name] || null;
  }
}
